const APP_VERSION = "v8-clean-ui";

const state = {
  device: null,
  server: null,
  service: null,
  writeCharacteristic: null,
  writableCharacteristics: [],
  notifyCharacteristic: null,
  connected: false,
  holdTimer: null,
  lastCommand: null,
  lastNotifyText: "",
  lastNotifyCount: 0,
  speed: 2,
};

const COMMANDS = {
  STOP: "0",
};

const els = {
  connect: document.querySelector("#connectButton"),
  disconnect: document.querySelector("#disconnectButton"),
  settingsToggle: document.querySelector("#settingsToggle"),
  settingsMenu: document.querySelector("#settingsMenu"),
  status: document.querySelector("#statusText"),
  deviceName: document.querySelector("#deviceName"),
  serviceState: document.querySelector("#serviceState"),
  writeState: document.querySelector("#writeState"),
  serviceUuid: document.querySelector("#serviceUuid"),
  writeUuid: document.querySelector("#writeUuid"),
  notifyUuid: document.querySelector("#notifyUuid"),
  protocolMode: document.querySelector("#protocolMode"),
  log: document.querySelector("#logList"),
};

function log(message) {
  const item = document.createElement("li");
  item.textContent = `${new Date().toLocaleTimeString()} ${message}`;
  els.log.prepend(item);
  while (els.log.children.length > 80) els.log.lastChild.remove();
}

function setStatus(text) {
  els.status.textContent = text;
}

function normalizeUuid(value) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^0x[0-9a-f]{4}$/i.test(trimmed)) return Number.parseInt(trimmed.slice(2), 16);
  if (/^[0-9a-f]{4}$/i.test(trimmed)) return Number.parseInt(trimmed, 16);
  return trimmed.toLowerCase();
}

function setConnectedUi(connected) {
  state.connected = connected;
  els.connect.disabled = connected;
  els.disconnect.disabled = !connected;
  els.deviceName.textContent = state.device?.name || "Unknown";
  els.serviceState.textContent = state.service ? "Ready" : "-";
  els.writeState.textContent = state.writableCharacteristics.length
    ? `${state.writableCharacteristics.length} writable`
    : "-";
}

function getWriteType(characteristic) {
  if (characteristic.properties.writeWithoutResponse) return "writeWithoutResponse";
  return "write";
}

function describeProperties(characteristic) {
  const props = characteristic.properties;
  const names = ["read", "write", "writeWithoutResponse", "notify", "indicate"];
  return names.filter((name) => props[name]).join(",") || "none";
}

function frameCommands(command) {
  const mode = els.protocolMode.value;
  if (mode === "mn") return [`m${command}n`];
  if (mode === "pq") return [`p${command}q`];
  if (mode === "auto") return [command, `m${command}n`, `p${command}q`];
  return [command];
}

async function connect() {
  if (!("bluetooth" in navigator)) {
    setStatus("Web Bluetooth is not available in this browser");
    log("Use Chrome or Edge on localhost/HTTPS.");
    return;
  }

  const serviceUuid = normalizeUuid(els.serviceUuid.value || "0xfff0");
  const writeUuid = normalizeUuid(els.writeUuid.value);
  const notifyUuid = normalizeUuid(els.notifyUuid.value);
  const optionalServices = [serviceUuid].filter(Boolean);

  setStatus("Scanning...");
  const filters = serviceUuid
    ? [{ services: [serviceUuid] }, { namePrefix: "PadBot" }, { namePrefix: "padbot" }]
    : [{ namePrefix: "PadBot" }, { namePrefix: "padbot" }];

  state.device = await navigator.bluetooth.requestDevice({
    filters,
    optionalServices,
  });

  state.device.addEventListener("gattserverdisconnected", onDisconnected);
  setStatus("Connecting...");
  state.server = await state.device.gatt.connect();
  state.service = await state.server.getPrimaryService(serviceUuid);

  const characteristics = await state.service.getCharacteristics();
  state.writableCharacteristics = writeUuid
    ? [await state.service.getCharacteristic(writeUuid)]
    : characteristics.filter((item) => item.properties.writeWithoutResponse || item.properties.write);
  state.writeCharacteristic = state.writableCharacteristics[0] || null;

  state.notifyCharacteristic = null;
  if (notifyUuid) {
    state.notifyCharacteristic = await state.service.getCharacteristic(notifyUuid);
  } else {
    state.notifyCharacteristic = characteristics.find((item) => item.properties.notify || item.properties.indicate);
  }

  if (!state.writeCharacteristic) {
    throw new Error("No writable BLE characteristic was found.");
  }

  if (state.notifyCharacteristic) {
    await state.notifyCharacteristic.startNotifications();
    state.notifyCharacteristic.addEventListener("characteristicvaluechanged", onNotification);
  }

  setConnectedUi(true);
  setStatus("Connected");
  log(`Connected to ${state.device.name || "PadBot"}`);
  characteristics.forEach((item) => log(`char ${item.uuid}: ${describeProperties(item)}`));
  log(`write target ${state.writableCharacteristics.map((item) => item.uuid).join(", ")}`);

  const activeSpeedCommand = document.querySelector(".speed-button.active")?.dataset.command;
  if (activeSpeedCommand) {
    await sendCommand(activeSpeedCommand, { label: "speed init" });
  }

  if (els.protocolMode.value === "auto") {
    await sendCommand(":", { stopAfter: false, label: "info probe" });
  }
}

function onNotification(event) {
  const bytes = new Uint8Array(event.target.value.buffer);
  const text = new TextDecoder().decode(bytes);
  const value = text || Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join(" ");
  if (value === state.lastNotifyText) {
    state.lastNotifyCount += 1;
    return;
  }
  if (state.lastNotifyCount > 1) log(`notify repeated ${state.lastNotifyCount}x`);
  state.lastNotifyText = value;
  state.lastNotifyCount = 1;
  log(`notify ${value}`);
}

function onDisconnected() {
  clearHold();
  state.server = null;
  state.service = null;
  state.writeCharacteristic = null;
  state.writableCharacteristics = [];
  state.notifyCharacteristic = null;
  setConnectedUi(false);
  setStatus("Disconnected");
  log("Disconnected");
}

async function disconnect() {
  clearHold();
  if (state.device?.gatt?.connected) {
    state.device.gatt.disconnect();
  } else {
    onDisconnected();
  }
}

async function sendCommand(command, options = {}) {
  const targets = state.writableCharacteristics.length ? state.writableCharacteristics : [state.writeCharacteristic].filter(Boolean);
  if (!targets.length) {
    log(`not connected: ${command}`);
    return;
  }

  const framedCommands = frameCommands(command);
  const written = [];
  const failures = [];
  for (const framed of framedCommands) {
    const data = new TextEncoder().encode(framed);
    for (const characteristic of targets) {
      try {
        if (characteristic.properties.writeWithoutResponse && characteristic.writeValueWithoutResponse) {
          await characteristic.writeValueWithoutResponse(data);
        } else if (characteristic.writeValueWithResponse) {
          await characteristic.writeValueWithResponse(data);
        } else {
          await characteristic.writeValue(data);
        }
        written.push(`${framed} -> ${characteristic.uuid} ${getWriteType(characteristic)}`);
      } catch (error) {
        failures.push(`${framed} -> ${characteristic.uuid}: ${error.message}`);
      }
    }
  }

  if (!written.length) {
    throw new Error(`write failed: ${failures.join("; ")}`);
  }

  state.lastCommand = command;
  log(`${options.label || "sent"} via ${written.join(", ")}`);
  failures.forEach((failure) => log(`write skipped ${failure}`));

  if (options.stopAfter) {
    window.setTimeout(() => sendCommand(COMMANDS.STOP, { label: "auto stop" }), options.stopAfter);
  }
}

function clearHold() {
  if (state.holdTimer) window.clearInterval(state.holdTimer);
  state.holdTimer = null;
  document.querySelectorAll(".pad-button.active").forEach((button) => button.classList.remove("active"));
}

async function startHold(button) {
  const command = button.dataset.command;
  clearHold();
  button.classList.add("active");
  await sendCommand(command, { label: "drive" });
  state.holdTimer = window.setInterval(() => sendCommand(command, { label: "drive" }), 220);
}

async function stopHold() {
  const hadHold = Boolean(state.holdTimer);
  clearHold();
  if (hadHold) await stopNow("stop");
}

async function stopNow(label = "stop") {
  clearHold();
  await sendCommand(COMMANDS.STOP, { label });
  window.setTimeout(() => sendCommand(COMMANDS.STOP, { label: `${label} repeat` }).catch((error) => log(error.message)), 90);
  window.setTimeout(() => sendCommand(COMMANDS.STOP, { label: `${label} repeat` }).catch((error) => log(error.message)), 180);
}

document.addEventListener("pointerdown", (event) => {
  const button = event.target.closest("[data-command]");
  if (!button) return;
  if (button.dataset.hold === "true") {
    event.preventDefault();
    button.setPointerCapture?.(event.pointerId);
    startHold(button).catch((error) => log(error.message));
  }
});

document.addEventListener("pointerup", (event) => {
  if (event.target.closest("[data-hold='true']")) {
    event.preventDefault();
    stopHold().catch((error) => log(error.message));
  }
});

document.addEventListener("pointercancel", () => {
  stopHold().catch((error) => log(error.message));
});

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-command]");
  if (!button) return;
  const command = button.dataset.command;
  if (button.dataset.hold === "true") {
    return;
  }
  if (button.classList.contains("speed-button")) {
    document.querySelectorAll(".speed-button").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    state.speed = Number(button.dataset.speed || state.speed);
  }
  if (command === COMMANDS.STOP) {
    stopNow("stop").catch((error) => log(error.message));
    return;
  }
  sendCommand(command, { label: "sent" }).catch((error) => log(error.message));
});

els.connect.addEventListener("click", () => {
  connect().catch((error) => {
    setStatus("Connection failed");
    log(error.message);
    setConnectedUi(false);
  });
});

els.disconnect.addEventListener("click", () => {
  disconnect().catch((error) => log(error.message));
});

els.settingsToggle.addEventListener("click", () => {
  const shouldOpen = els.settingsMenu.hidden;
  els.settingsMenu.hidden = !shouldOpen;
  els.settingsToggle.setAttribute("aria-expanded", String(shouldOpen));
});

document.addEventListener("click", (event) => {
  if (els.settingsMenu.hidden) return;
  if (event.target.closest("#settingsMenu, #settingsToggle")) return;
  els.settingsMenu.hidden = true;
  els.settingsToggle.setAttribute("aria-expanded", "false");
});

window.addEventListener("keydown", (event) => {
  const map = {
    ArrowUp: "X1",
    ArrowDown: "X4",
    ArrowLeft: "X6",
    ArrowRight: "X7",
    " ": "0",
  };
  if (!map[event.key] || event.repeat) return;
  event.preventDefault();
  if (map[event.key] === COMMANDS.STOP) {
    stopNow("key stop").catch((error) => log(error.message));
    return;
  }
  sendCommand(map[event.key], { label: "key" }).catch((error) => log(error.message));
});

window.addEventListener("keyup", (event) => {
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
    event.preventDefault();
    stopNow("key stop").catch((error) => log(error.message));
  }
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

setConnectedUi(false);
log(`Ready ${APP_VERSION}`);
