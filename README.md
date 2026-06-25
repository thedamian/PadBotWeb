# PadBotWeb

PadBotWeb is a small PWA for driving a PadBot robot from the browser.

The project started by inspecting the installed macOS/iOS-wrapper app at `/Applications/PadBot.app` to find how it controls the robot. The useful path is direct Bluetooth Low Energy control: the native app scans nearby PadBot BLE peripherals, discovers their service and characteristic UUIDs, and writes UTF-8 robot command strings to a writable BLE characteristic.

## What This App Does

- Connects to a PadBot-compatible BLE device from Chrome or Edge.
- Starts with the observed BLE service `0xfff0`.
- Auto-discovers a writable characteristic when possible.
- Provides drive buttons for forward, backward, left, right, diagonals, stop, and head up/down.
- Keeps battery, infrared, info, dock, and undock in a compact settings menu.
- Sends raw native movement/head tokens such as `X1`, with speed configured separately through `W`, `E`, or `D`.
- Uses automatic protocol framing for raw commands and the observed wrapped formats `m...n` and `p...q`.
- Uses the PadBot command map refined against a PA6208 physical test.
- Installs as a PWA and works from `localhost` with a service worker.

## Running Locally

```bash
python3 -m http.server 5173
```

Open:

```text
http://localhost:5173/
```

Web Bluetooth requires a secure context, and `localhost` qualifies. Use Chrome or Edge; Safari generally will not work for this.

## Robot Compatibility

The original PadBot app is not hard-coded to one robot. It stores multiple `RobotVo` records with fields like `robotName`, `serviceUuid`, `writeCharactUuid`, `notifyCharactUuid`, `readCharactUuid`, `model`, and RSSI.

This PWA should be able to drive different PadBot units if they expose the same BLE service/characteristic behavior and accept the same command tokens. It is not expected to drive unrelated robot brands.

## Research Notes

Detailed reverse-engineering notes and the observed command table are in:

[documentation.md](./documentation.md)

Key findings:

- Direct robot driving uses Bluetooth Low Energy, not Wi-Fi.
- The app links `CoreBluetooth.framework`.
- The app contains `BluetoothService` methods for scanning, connecting, discovering characteristics, enabling notifications, and writing commands.
- The native write path UTF-8 encodes command strings before BLE writes.

## Current Status

This is a practical browser implementation based on static analysis of the installed app and PA6208 testing. The app now defaults to automatic framing because the exact firmware framing can vary by robot.
