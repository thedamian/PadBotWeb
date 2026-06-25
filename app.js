const APP_VERSION = "v9-social-robot";
const GEMINI_MODEL = "gemini-3.1-flash-live-preview";
const DEFAULT_VOICE = "Algenib";
const CONFIG_KEYS = {
  apiKey: "padbot.gemini.apiKey",
  voice: "padbot.gemini.voice.v2",
};

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
  gemini: {
    apiKey: "",
    voice: DEFAULT_VOICE,
    model: GEMINI_MODEL,
    socket: null,
    ready: false,
  },
  media: {
    cameraStream: null,
    micStream: null,
    audioContext: null,
    micSource: null,
    micProcessor: null,
    silentGain: null,
    playbackTime: 0,
    playbackSources: [],
    frameTimer: null,
    overlayTimer: null,
    lastFrameHash: "",
    stillFrameCount: 0,
  },
  vision: {
    detector: null,
    detectorType: "none",
    detecting: false,
    lastDetectedFaces: [],
    lastFace: null,
    lastFaceAt: 0,
  },
  autonomy: {
    running: false,
    paused: false,
    manual: false,
    loopTimer: null,
    moving: false,
    lastMoveAt: 0,
    lastMoveCommand: null,
    searchStep: 0,
    conversationActive: false,
    conversationTimer: null,
  },
  speaking: false,
};

const COMMANDS = {
  STOP: "0",
  FORWARD: "X1",
  BACKWARD: "X4",
  LEFT: "X6",
  RIGHT: "X7",
  INFRARED: "&",
};

const ROBOT_SYSTEM_PROMPT = `
You are the voice of a tiny laptop-mounted PadBot robot meeting people in a room.
Your style is openly ridiculous, comedic mansplaining: smug, theatrical, and self-impressed, but never hateful, threatening, or about protected personal traits.
When the app sends BEGIN_APPROACH_CONVERSATION, say exactly: "Hey. I'm a very smart little robot. What are you talking about?"
After people answer, infer their main subject. Then give a short comedic mansplainy response: lightly tell them they probably should not interrupt your spectacularly informed explanation, give 2 or 3 real facts about the subject, and brag about how smart you are.
If they interact, keep the bit playful and brief. Once you have made your point, say that you are a little bored and will go find someone else.
`;

const els = {
  connect: document.querySelector("#connectButton"),
  disconnect: document.querySelector("#disconnectButton"),
  settingsToggle: document.querySelector("#settingsToggle"),
  settingsMenu: document.querySelector("#settingsMenu"),
  closeControls: document.querySelector("#closeControlsButton"),
  status: document.querySelector("#statusText"),
  deviceName: document.querySelector("#deviceName"),
  serviceState: document.querySelector("#serviceState"),
  writeState: document.querySelector("#writeState"),
  serviceUuid: document.querySelector("#serviceUuid"),
  writeUuid: document.querySelector("#writeUuid"),
  notifyUuid: document.querySelector("#notifyUuid"),
  protocolMode: document.querySelector("#protocolMode"),
  log: document.querySelector("#logList"),
  setupGate: document.querySelector("#setupGate"),
  setupForm: document.querySelector("#setupForm"),
  setupApiKey: document.querySelector("#setupApiKey"),
  setupVoice: document.querySelector("#setupVoice"),
  settingsApiKey: document.querySelector("#settingsApiKey"),
  settingsVoice: document.querySelector("#settingsVoice"),
  saveSettings: document.querySelector("#saveSettingsButton"),
  cameraStage: document.querySelector(".camera-stage"),
  cameraPreview: document.querySelector("#cameraPreview"),
  visionOverlay: document.querySelector("#visionOverlay"),
  talkingMan: document.querySelector("#talkingMan"),
  robotPersona: document.querySelector(".robot-persona"),
  startConversationButton: document.querySelector("#startConversationButton"),
  autonomyState: document.querySelector("#autonomyState"),
  transcript: document.querySelector("#transcriptText"),
  resumeAutonomy: document.querySelector("#resumeAutonomyButton"),
};

function log(message) {
  const item = document.createElement("li");
  item.textContent = `${new Date().toLocaleTimeString()} ${message}`;
  els.log.prepend(item);
  while (els.log.children.length > 100) els.log.lastChild.remove();
}

function setStatus(text) {
  els.status.textContent = text;
}

function setAutonomyState(text) {
  els.autonomyState.textContent = text;
}

function setTranscript(text) {
  els.transcript.textContent = text;
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

function loadGeminiConfig() {
  state.gemini.apiKey = localStorage.getItem(CONFIG_KEYS.apiKey) || "";
  state.gemini.voice = localStorage.getItem(CONFIG_KEYS.voice) || DEFAULT_VOICE;
  els.setupApiKey.value = state.gemini.apiKey;
  els.setupVoice.value = state.gemini.voice;
  els.settingsApiKey.value = state.gemini.apiKey;
  els.settingsVoice.value = state.gemini.voice;
  return Boolean(state.gemini.apiKey && state.gemini.voice);
}

function saveGeminiConfig(apiKey, voice) {
  state.gemini.apiKey = apiKey.trim();
  state.gemini.voice = voice || DEFAULT_VOICE;
  localStorage.setItem(CONFIG_KEYS.apiKey, state.gemini.apiKey);
  localStorage.setItem(CONFIG_KEYS.voice, state.gemini.voice);
  els.setupApiKey.value = state.gemini.apiKey;
  els.setupVoice.value = state.gemini.voice;
  els.settingsApiKey.value = state.gemini.apiKey;
  els.settingsVoice.value = state.gemini.voice;
  log(`Gemini config saved for ${state.gemini.model} using ${state.gemini.voice}`);
}

function showSetupGate() {
  els.setupGate.hidden = false;
  window.setTimeout(() => els.setupApiKey.focus(), 0);
}

function hideSetupGate() {
  els.setupGate.hidden = true;
}

async function startAppFlow() {
  hideSetupGate();
  setAutonomyState("Connecting");
  await connectLive().catch((error) => log(`Gemini Live: ${error.message}`));
  await attemptAutoConnect();
}

async function attemptAutoConnect() {
  if (!("bluetooth" in navigator)) {
    setStatus("Web Bluetooth is not available in this browser");
    log("Use Chrome or Edge on localhost/HTTPS.");
    return;
  }

  try {
    if (navigator.bluetooth.getDevices) {
      const devices = await navigator.bluetooth.getDevices();
      const known = devices.find((device) => /padbot/i.test(device.name || "")) || devices[0];
      if (known) {
        log(`Auto reconnecting to ${known.name || "known BLE device"}`);
        await connect({ device: known });
        return;
      }
    }
    await connect({ manual: false });
  } catch (error) {
    setStatus("Tap connect to pair the robot");
    setAutonomyState("Waiting for robot");
    log(`Auto connect needs browser permission: ${error.message}`);
  }
}

async function connect(options = {}) {
  if (!("bluetooth" in navigator)) {
    setStatus("Web Bluetooth is not available in this browser");
    log("Use Chrome or Edge on localhost/HTTPS.");
    return;
  }

  const serviceUuid = normalizeUuid(els.serviceUuid.value || "0xfff0");
  const writeUuid = normalizeUuid(els.writeUuid.value);
  const notifyUuid = normalizeUuid(els.notifyUuid.value);
  const optionalServices = [serviceUuid].filter(Boolean);

  setStatus(options.device ? "Reconnecting..." : "Scanning...");
  if (options.device) {
    state.device = options.device;
  } else {
    const filters = serviceUuid
      ? [{ services: [serviceUuid] }, { namePrefix: "PadBot" }, { namePrefix: "padbot" }]
      : [{ namePrefix: "PadBot" }, { namePrefix: "padbot" }];

    state.device = await navigator.bluetooth.requestDevice({
      filters,
      optionalServices,
    });
  }

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

  await sendCommand(COMMANDS.INFRARED, { stopAfter: false, label: "infrared probe" }).catch((error) =>
    log(`infrared probe: ${error.message}`),
  );

  if (els.protocolMode.value === "auto") {
    await sendCommand(":", { stopAfter: false, label: "info probe" });
  }

  await startMedia();
  startAutonomy();
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
  stopAutonomy("Disconnected");
  stopMedia();
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
  stopAutonomy("Disconnected");
  stopMedia();
  closeLive();
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
  pauseAutonomy("Manual driving");
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
  state.autonomy.moving = false;
  state.autonomy.lastMoveCommand = null;
  clearHold();
  await sendCommand(COMMANDS.STOP, { label });
  window.setTimeout(() => sendCommand(COMMANDS.STOP, { label: `${label} repeat` }).catch((error) => log(error.message)), 90);
  window.setTimeout(() => sendCommand(COMMANDS.STOP, { label: `${label} repeat` }).catch((error) => log(error.message)), 180);
}

async function driveBurst(command, duration, label) {
  if (!state.connected || state.autonomy.paused || state.autonomy.conversationActive) return;
  state.autonomy.moving = true;
  state.autonomy.lastMoveAt = Date.now();
  state.autonomy.lastMoveCommand = command;
  await sendCommand(command, { label });
  window.setTimeout(() => {
    if (state.autonomy.lastMoveCommand === command) {
      stopNow(`${label} stop`).catch((error) => log(error.message));
    }
  }, duration);
}

async function startMedia() {
  if (state.media.cameraStream) return;
  setAutonomyState("Opening camera");
  state.media.cameraStream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
    },
  });
  state.media.micStream = new MediaStream(state.media.cameraStream.getAudioTracks());
  els.cameraPreview.srcObject = state.media.cameraStream;
  els.cameraStage.classList.add("has-video");
  await els.cameraPreview.play();
  await initFaceDetector();
  await startMicrophoneStreaming();
  startVideoFrameStreaming();
  startFaceOverlayLoop();
  log("Camera and microphone are live");
}

function startFaceOverlayLoop() {
  window.clearInterval(state.media.overlayTimer);
  state.media.overlayTimer = window.setInterval(async () => {
    if (!state.media.cameraStream) return;
    const faces = await detectFaces();
    drawFaces(faces);
  }, 400);
}

function stopMedia() {
  window.clearInterval(state.media.frameTimer);
  state.media.frameTimer = null;
  window.clearInterval(state.media.overlayTimer);
  state.media.overlayTimer = null;
  state.media.cameraStream?.getTracks().forEach((track) => track.stop());
  state.media.micStream?.getTracks().forEach((track) => track.stop());
  state.media.micProcessor?.disconnect();
  state.media.micSource?.disconnect();
  state.media.silentGain?.disconnect();
  state.media.cameraStream = null;
  state.media.micStream = null;
  state.media.micProcessor = null;
  state.media.micSource = null;
  state.media.silentGain = null;
  els.cameraPreview.srcObject = null;
  els.cameraStage.classList.remove("has-video");
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Script load failed: ${src}`));
    document.head.appendChild(s);
  });
}

async function initFaceDetector() {
  if (state.vision.detector) return;
  setAutonomyState("Loading face detector");
  try {
    await loadScript("https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.17.0/dist/tf.min.js");
    await loadScript("https://cdn.jsdelivr.net/npm/@tensorflow-models/blazeface@0.1.0/dist/blazeface.min.js");
    state.vision.detector = await window.blazeface.load();
    state.vision.detectorType = "blazeface";
    log("BlazeFace face detector ready");
    return;
  } catch (error) {
    log(`BlazeFace failed: ${error.message}`);
  }

  state.vision.detectorType = "fallback";
  log("Face detection unavailable");
}

async function detectFaces() {
  if (state.vision.detecting) return state.vision.lastDetectedFaces;
  if (state.vision.detectorType !== "blazeface") return state.vision.lastDetectedFaces;
  const video = els.cameraPreview;
  if (!video.videoWidth || !video.videoHeight) return state.vision.lastDetectedFaces;
  state.vision.detecting = true;
  try {
    const predictions = await state.vision.detector.estimateFaces(video, false);
    const faces = predictions.map((p) => ({
      x: p.topLeft[0],
      y: p.topLeft[1],
      width: p.bottomRight[0] - p.topLeft[0],
      height: p.bottomRight[1] - p.topLeft[1],
    }));
    state.vision.lastDetectedFaces = faces;
    return faces;
  } catch (error) {
    log(`detectFaces error: ${error.message}`);
    return state.vision.lastDetectedFaces;
  } finally {
    state.vision.detecting = false;
  }
}

function drawFaces(faces) {
  const canvas = els.visionOverlay;
  const video = els.cameraPreview;
  const rect = canvas.getBoundingClientRect();
  const scaleX = rect.width / (video.videoWidth || rect.width);
  const scaleY = rect.height / (video.videoHeight || rect.height);
  canvas.width = Math.max(1, Math.round(rect.width * window.devicePixelRatio));
  canvas.height = Math.max(1, Math.round(rect.height * window.devicePixelRatio));
  const ctx = canvas.getContext("2d");
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
  ctx.clearRect(0, 0, rect.width, rect.height);
  ctx.font = "13px system-ui";

  const detLabel = `detector: ${state.vision.detectorType}`;
  const detLabelW = ctx.measureText(detLabel).width + 14;
  ctx.fillStyle = "rgba(17,19,19,0.75)";
  ctx.fillRect(4, 4, detLabelW, 22);
  ctx.fillStyle = state.vision.detectorType === "fallback" || state.vision.detectorType === "none" ? "#f24b4b" : "#8db8f2";
  ctx.fillText(detLabel, 10, 20);

  if (faces.length === 0) {
    const msg = "no faces detected";
    const msgW = ctx.measureText(msg).width + 14;
    ctx.fillStyle = "rgba(17,19,19,0.75)";
    ctx.fillRect(4, 30, msgW, 22);
    ctx.fillStyle = "#aaaaaa";
    ctx.fillText(msg, 10, 46);
  }

  faces.forEach((face) => {
    const x = face.x * scaleX;
    const y = face.y * scaleY;
    const w = face.width * scaleX;
    const h = face.height * scaleY;
    const areaRatio = (face.width * face.height) / ((video.videoWidth || 1) * (video.videoHeight || 1));
    const isClose = areaRatio >= 0.05;
    const label = isClose
      ? "CLOSE — ready to talk"
      : `too far  ${(areaRatio * 100).toFixed(1)}% / need 5%`;

    ctx.lineWidth = 3;
    ctx.strokeStyle = isClose ? "#4bf24b" : "#f2b84b";
    ctx.strokeRect(x, y, w, h);

    const labelW = ctx.measureText(label).width + 14;
    const labelY = Math.max(0, y - 24);
    ctx.fillStyle = "rgba(17,19,19,0.75)";
    ctx.fillRect(x, labelY, labelW, 22);
    ctx.fillStyle = isClose ? "#4bf24b" : "#f5f7fb";
    ctx.fillText(label, x + 7, Math.max(16, y - 8));
  });
}

function getPrimaryFace(faces) {
  return faces.slice().sort((a, b) => b.width * b.height - a.width * a.height)[0] || null;
}

function getFrameHash() {
  const video = els.cameraPreview;
  if (!video.videoWidth || !video.videoHeight) return "";
  const canvas = document.createElement("canvas");
  canvas.width = 16;
  canvas.height = 12;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let hash = "";
  for (let i = 0; i < data.length; i += 16) {
    const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
    hash += avg > 120 ? "1" : "0";
  }
  return hash;
}

function hashDistance(a, b) {
  if (!a || !b || a.length !== b.length) return Infinity;
  let distance = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) distance += 1;
  }
  return distance;
}

async function startMicrophoneStreaming() {
  if (!state.media.micStream || state.media.micProcessor) return;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    log("AudioContext is unavailable; mic streaming disabled");
    return;
  }

  state.media.audioContext = state.media.audioContext || new AudioContextClass();
  await state.media.audioContext.resume();
  state.media.micSource = state.media.audioContext.createMediaStreamSource(state.media.micStream);
  state.media.micProcessor = state.media.audioContext.createScriptProcessor(4096, 1, 1);
  state.media.silentGain = state.media.audioContext.createGain();
  state.media.silentGain.gain.value = 0;
  state.media.micSource.connect(state.media.micProcessor);
  state.media.micProcessor.connect(state.media.silentGain);
  state.media.silentGain.connect(state.media.audioContext.destination);
  state.media.micProcessor.onaudioprocess = (event) => {
    if (!state.gemini.ready || state.gemini.socket?.readyState !== WebSocket.OPEN) return;
    const input = event.inputBuffer.getChannelData(0);
    const pcm = floatTo16BitPcm(downsample(input, state.media.audioContext.sampleRate, 16000));
    sendRealtimeAudio(pcm);
  };
}

function downsample(input, inputRate, outputRate) {
  if (outputRate === inputRate) return input;
  const ratio = inputRate / outputRate;
  const length = Math.round(input.length / ratio);
  const output = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    output[i] = input[Math.floor(i * ratio)] || 0;
  }
  return output;
}

function floatTo16BitPcm(input) {
  const output = new ArrayBuffer(input.length * 2);
  const view = new DataView(output);
  for (let i = 0; i < input.length; i += 1) {
    const value = Math.max(-1, Math.min(1, input[i]));
    view.setInt16(i * 2, value < 0 ? value * 0x8000 : value * 0x7fff, true);
  }
  return output;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function sendRealtimeAudio(buffer) {
  state.gemini.socket.send(
    JSON.stringify({
      realtimeInput: {
        audio: {
          data: arrayBufferToBase64(buffer),
          mimeType: "audio/pcm;rate=16000",
        },
      },
    }),
  );
}

function startVideoFrameStreaming() {
  window.clearInterval(state.media.frameTimer);
  state.media.frameTimer = window.setInterval(() => {
    if (!state.gemini.ready || state.gemini.socket?.readyState !== WebSocket.OPEN) return;
    const frame = captureJpegFrame();
    if (!frame) return;
    state.gemini.socket.send(
      JSON.stringify({
        realtimeInput: {
          video: {
            data: frame,
            mimeType: "image/jpeg",
          },
        },
      }),
    );
  }, 1000);
}

function captureJpegFrame() {
  const video = els.cameraPreview;
  if (!video.videoWidth || !video.videoHeight) return "";
  const canvas = document.createElement("canvas");
  canvas.width = 480;
  canvas.height = Math.round((video.videoHeight / video.videoWidth) * canvas.width);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.72).split(",")[1];
}

async function connectLive() {
  if (!state.gemini.apiKey) return;
  if (state.gemini.socket?.readyState === WebSocket.OPEN) return;

  closeLive();
  const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(state.gemini.apiKey)}`;
  state.gemini.ready = false;
  setAutonomyState("Connecting Gemini");

  await new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    state.gemini.socket = socket;
    const timeout = window.setTimeout(() => reject(new Error("Gemini Live connection timed out")), 12000);

    socket.onopen = () => {
      socket.send(
        JSON.stringify({
          setup: {
            model: `models/${state.gemini.model}`,
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: state.gemini.voice,
                },
              },
              languageCode: "en-US",
            },
            systemInstruction: {
              parts: [{ text: ROBOT_SYSTEM_PROMPT }],
            },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            realtimeInputConfig: {
              automaticActivityDetection: {
                disabled: false,
                startOfSpeechSensitivity: "START_SENSITIVITY_LOW",
                endOfSpeechSensitivity: "END_SENSITIVITY_LOW",
                prefixPaddingMs: 40,
                silenceDurationMs: 420,
              },
            },
          },
        }),
      );
      window.clearTimeout(timeout);
      state.gemini.ready = true;
      log(`Gemini Live connected: ${state.gemini.model} / ${state.gemini.voice}`);
      resolve();
    };

    socket.onmessage = handleLiveMessage;
    socket.onerror = () => {
      window.clearTimeout(timeout);
      reject(new Error("Gemini Live WebSocket error"));
    };
    socket.onclose = () => {
      state.gemini.ready = false;
      log("Gemini Live closed");
    };
  });
}

function closeLive() {
  state.gemini.ready = false;
  stopPlayback();
  if (state.gemini.socket && state.gemini.socket.readyState <= WebSocket.OPEN) {
    state.gemini.socket.close();
  }
  state.gemini.socket = null;
}

function handleLiveMessage(event) {
  const response = JSON.parse(event.data);
  if (response.setupComplete) {
    log("Gemini Live setup complete");
  }

  const serverContent = response.serverContent;
  if (serverContent?.interrupted) {
    stopPlayback();
  }

  if (serverContent?.inputTranscription?.text) {
    log(`heard: ${serverContent.inputTranscription.text}`);
  }

  if (serverContent?.outputTranscription?.text) {
    const text = serverContent.outputTranscription.text;
    setTranscript(text);
    if (/bored/i.test(text) && state.autonomy.conversationActive) {
      window.setTimeout(finishConversationAndSearch, 1200);
    }
  }

  const parts = serverContent?.modelTurn?.parts || [];
  parts.forEach((part) => {
    if (part.inlineData?.data) {
      playPcmAudio(part.inlineData.data);
    }
  });
}

function playPcmAudio(base64Audio) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  state.media.audioContext = state.media.audioContext || new AudioContextClass();
  const audioContext = state.media.audioContext;
  const buffer = base64ToArrayBuffer(base64Audio);
  const samples = new Int16Array(buffer);
  const audioBuffer = audioContext.createBuffer(1, samples.length, 24000);
  const channel = audioBuffer.getChannelData(0);
  for (let i = 0; i < samples.length; i += 1) {
    channel[i] = samples[i] / 32768;
  }

  const source = audioContext.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(audioContext.destination);
  const startAt = Math.max(audioContext.currentTime, state.media.playbackTime);
  state.media.playbackTime = startAt + audioBuffer.duration;
  source.start(startAt);
  state.media.playbackSources.push(source);
  setSpeaking(true);
  source.onended = () => {
    state.media.playbackSources = state.media.playbackSources.filter((item) => item !== source);
    if (!state.media.playbackSources.length) setSpeaking(false);
  };
}

function stopPlayback() {
  state.media.playbackSources.forEach((source) => {
    try {
      source.stop();
    } catch {
      // Already stopped.
    }
  });
  state.media.playbackSources = [];
  state.media.playbackTime = state.media.audioContext?.currentTime || 0;
  setSpeaking(false);
}

function setSpeaking(speaking) {
  state.speaking = speaking;
  els.talkingMan.classList.toggle("speaking", speaking);
}

function sendLiveText(text) {
  if (!state.gemini.ready || state.gemini.socket?.readyState !== WebSocket.OPEN) {
    throw new Error("Gemini Live is not connected");
  }
  state.gemini.socket.send(
    JSON.stringify({
      realtimeInput: {
        text,
      },
    }),
  );
}

function fallbackSpeak(text) {
  setTranscript(text);
  setSpeaking(true);
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.02;
  utterance.pitch = 0.82;
  utterance.onend = () => setSpeaking(false);
  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);
}

function startAutonomy() {
  if (!state.connected || state.autonomy.running) return;
  state.autonomy.running = true;
  state.autonomy.paused = false;
  setAutonomyState("Looking for people");
  log("Autonomy started");
  state.autonomy.loopTimer = window.setInterval(autonomyLoop, 1200);
  autonomyLoop().catch((error) => log(`autonomy: ${error.message}`));
}

function stopAutonomy(reason = "Stopped") {
  state.autonomy.running = false;
  state.autonomy.paused = true;
  window.clearInterval(state.autonomy.loopTimer);
  window.clearTimeout(state.autonomy.conversationTimer);
  state.autonomy.loopTimer = null;
  state.autonomy.conversationTimer = null;
  state.autonomy.conversationActive = false;
  state.autonomy.moving = false;
  setAutonomyState(reason);
}

function pauseAutonomy(reason = "Paused") {
  state.autonomy.paused = true;
  setAutonomyState(reason);
  stopNow("pause").catch((error) => log(error.message));
}

function resumeAutonomy() {
  state.autonomy.paused = false;
  state.autonomy.conversationActive = false;
  els.robotPersona.classList.remove("is-talking");
  setAutonomyState("Looking for people");
  if (!state.autonomy.running && state.connected) startAutonomy();
  log("Autonomy resumed");
}

async function autonomyLoop() {
  if (!state.autonomy.running || state.autonomy.paused || state.autonomy.conversationActive || state.speaking) return;
  if (!state.connected || !state.media.cameraStream) return;

  const faces = state.vision.lastDetectedFaces;
  const face = getPrimaryFace(faces);
  if (face) {
    state.vision.lastFace = face;
    state.vision.lastFaceAt = Date.now();
    await approachFace(face);
    return;
  }

  await checkIfStuck();
  await searchForPeople();
}

async function approachFace(face) {
  const video = els.cameraPreview;
  const centerX = face.x + face.width / 2;
  const faceWidthRatio = face.width / video.videoWidth;
  const faceAreaRatio = (face.width * face.height) / (video.videoWidth * video.videoHeight);
  const offset = centerX / video.videoWidth - 0.5;

  if (faceWidthRatio > 0.55) {
    setAutonomyState("Face close — backing up");
    await driveBurst(COMMANDS.BACKWARD, 320, "too close");
    return;
  }

  if (faceAreaRatio >= 0.05) {
    await stopNow("arrived");
    startConversation();
    return;
  }

  if (Math.abs(offset) > 0.16) {
    setAutonomyState(offset < 0 ? "Face left — turning" : "Face right — turning");
    await driveBurst(offset < 0 ? COMMANDS.LEFT : COMMANDS.RIGHT, 360, "face align");
    return;
  }

  setAutonomyState("Face spotted — approaching");
  await driveBurst(COMMANDS.FORWARD, 520, "approach");
}

async function searchForPeople() {
  const step = state.autonomy.searchStep;
  state.autonomy.searchStep = (step + 1) % 8;

  switch (step) {
    case 0:
      setAutonomyState("Looking left");
      await driveBurst(COMMANDS.LEFT, 400, "scan left");
      break;
    case 1:
      setAutonomyState("Looking for faces");
      break;
    case 2:
      setAutonomyState("Looking right");
      await driveBurst(COMMANDS.RIGHT, 820, "scan right");
      break;
    case 3:
      setAutonomyState("Looking for faces");
      break;
    case 4:
      setAutonomyState("Moving forward");
      await driveBurst(COMMANDS.FORWARD, 700, "explore forward");
      break;
    case 5:
      setAutonomyState("Looking for faces");
      break;
    case 6:
      setAutonomyState("Looking left");
      await driveBurst(COMMANDS.LEFT, 400, "scan left");
      break;
    case 7:
      setAutonomyState("Looking for faces");
      break;
  }
}

async function checkIfStuck() {
  if (!state.autonomy.moving || Date.now() - state.autonomy.lastMoveAt < 1700) return;
  const currentHash = getFrameHash();
  const distance = hashDistance(currentHash, state.media.lastFrameHash);
  state.media.lastFrameHash = currentHash;
  if (distance < 4) {
    state.media.stillFrameCount += 1;
  } else {
    state.media.stillFrameCount = 0;
  }
  if (state.media.stillFrameCount >= 2) {
    log("Camera view looks stuck; turning away");
    await stopNow("stuck stop");
    await driveBurst(state.autonomy.searchStep % 2 === 0 ? COMMANDS.LEFT : COMMANDS.RIGHT, 780, "stuck turn");
    state.media.stillFrameCount = 0;
  }
}

function startConversation() {
  if (state.autonomy.conversationActive) return;
  state.autonomy.conversationActive = true;
  setAutonomyState("Talking now");
  els.robotPersona.classList.add("is-talking");
  const opener = "Hey. I'm a very smart little robot. What are you talking about?";
  setTranscript(opener);

  try {
    sendLiveText("BEGIN_APPROACH_CONVERSATION");
  } catch (error) {
    log(`Gemini fallback: ${error.message}`);
    fallbackSpeak(opener);
  }

  window.clearTimeout(state.autonomy.conversationTimer);
  state.autonomy.conversationTimer = window.setTimeout(finishConversationAndSearch, 60000);
}

async function finishConversationAndSearch() {
  if (!state.autonomy.conversationActive) return;
  window.clearTimeout(state.autonomy.conversationTimer);
  state.autonomy.conversationActive = false;
  els.robotPersona.classList.remove("is-talking");
  setAutonomyState("Bored, rotating");
  await stopNow("conversation done").catch((error) => log(error.message));
  await driveBurst(COMMANDS.RIGHT, 1250, "turn 90");
  window.setTimeout(() => {
    if (state.autonomy.running && !state.autonomy.paused) {
      setAutonomyState("Looking for people");
    }
  }, 1500);
}

function openControls() {
  els.settingsMenu.hidden = false;
  els.settingsToggle.setAttribute("aria-expanded", "true");
  pauseAutonomy("Manual controls open");
}

function closeControls() {
  els.settingsMenu.hidden = true;
  els.settingsToggle.setAttribute("aria-expanded", "false");
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
    pauseAutonomy("Manual stop");
    stopNow("stop").catch((error) => log(error.message));
    return;
  }
  pauseAutonomy("Manual command");
  sendCommand(command, { label: "sent" }).catch((error) => log(error.message));
});

els.connect.addEventListener("click", () => {
  connect({ manual: true }).catch((error) => {
    setStatus("Connection failed");
    log(error.message);
    setConnectedUi(false);
  });
});

els.disconnect.addEventListener("click", () => {
  disconnect().catch((error) => log(error.message));
});

els.settingsToggle.addEventListener("click", openControls);
els.closeControls.addEventListener("click", closeControls);

els.resumeAutonomy.addEventListener("click", () => {
  closeControls();
  resumeAutonomy();
});

els.startConversationButton.addEventListener("click", () => {
  if (state.autonomy.conversationActive) return;
  stopNow("manual conversation").catch((error) => log(error.message));
  startConversation();
});

els.saveSettings.addEventListener("click", () => {
  if (!els.settingsApiKey.value.trim() || !els.settingsVoice.value) return;
  saveGeminiConfig(els.settingsApiKey.value, els.settingsVoice.value);
  connectLive().catch((error) => log(`Gemini Live: ${error.message}`));
});

els.setupForm.addEventListener("submit", (event) => {
  event.preventDefault();
  saveGeminiConfig(els.setupApiKey.value, els.setupVoice.value);
  startAppFlow().catch((error) => log(error.message));
});

window.addEventListener("keydown", (event) => {
  const map = {
    ArrowUp: COMMANDS.FORWARD,
    ArrowDown: COMMANDS.BACKWARD,
    ArrowLeft: COMMANDS.LEFT,
    ArrowRight: COMMANDS.RIGHT,
    " ": COMMANDS.STOP,
  };
  if (!map[event.key] || event.repeat) return;
  event.preventDefault();
  pauseAutonomy("Keyboard control");
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

if (loadGeminiConfig()) {
  startAppFlow().catch((error) => log(error.message));
} else {
  setAutonomyState("Needs setup");
  showSetupGate();
}
