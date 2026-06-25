# PadBot Control Notes

## What the installed app uses

The installed app is `/Applications/PadBot.app`, which is an iOS app wrapper. The useful binary is:

`/Applications/PadBot.app/Wrapper/PadBotIPhone.app/PadBotIPhone`

The app drives the robot locally with Bluetooth Low Energy, not Wi-Fi. Evidence from the bundle:

- `Info.plist` declares `NSBluetoothAlwaysUsageDescription` and `NSBluetoothPeripheralUsageDescription`.
- The binary links `CoreBluetooth.framework`.
- The app has a `BluetoothService` class with methods including:
  - `findBluetooths:isConnectLast:`
  - `findAndConnectBluetooth:serviceUUID:`
  - `writeValue:characteristicUUID:data:`
  - `notification:characteristicUUID:on:`
  - `peripheral:didDiscoverServices:`
  - `peripheral:didDiscoverCharacteristicsForService:error:`
- Robot records are modeled as `RobotVo` objects with:
  - `robotName`
  - `bluetoothUuid`
  - `serviceUuid`
  - `writeCharactUuid`
  - `notifyCharactUuid`
  - `readCharactUuid`
  - `model`
  - `robotDbm`

The app also uses Agora/Hyphenate/WebRTC-style libraries for video, chat, and remote sessions. Those are separate from direct robot driving. The local robot-control surface writes BLE commands.

## BLE discovery

The binary contains the BLE service token `0xFFF0`. The app scans nearby peripherals, identifies candidates, discovers services and characteristics, then stores the discovered service/write/notify/read UUIDs on the selected `RobotVo`.

The web app in this folder starts with service `0xfff0` and can also fall back to name filters like `PadBot`. Because the native app stores discovered characteristic UUIDs rather than relying only on hard-coded strings, the PWA discovers characteristics and chooses a writable one automatically. Manual service/write/notify UUID fields are available when a robot variant needs them.

## Write format

The native `BluetoothService writeValue:characteristicUUID:data:` method takes an NSString robot command, UTF-8 encodes it, and writes it to the BLE characteristic.

Robot movement commands are buffered by `sendRobotOrder:` and then `executeRobotOrder` writes the buffered string as-is to BLE. Speed is configured separately with the observed speed/setup commands (`W`, `E`, `D`, and `]`), not by prefixing movement tokens. A previous browser attempt sent `2X1`; that does not match the native direct-BLE path. The PWA now sends raw motion tokens such as `X1` and sends the selected speed command separately on connect or speed-button taps.

It also contains firmware-dependent framing formats:

- Raw: `COMMAND`
- Frame A: `mCOMMANDn`
- Frame B: `pCOMMANDq`

The disassembly shows wrapping selected around robot-version ranges `1802-1899` (`mCOMMANDn`) and `1902-1999` (`pCOMMANDq`). Because the exact robot in front of the browser may vary, the PWA exposes a protocol selector. `Auto` sends raw plus both framed variants for each command.

## Observed command tokens

These command strings were extracted from the robot-control methods and CFString constants:

| Command | Meaning inferred from app methods |
| --- | --- |
| `:` | Query robot info/version |
| `?` | Query charge/battery |
| `&` | Query infrared/obstacle state |
| `0` | Stop |
| `]` | Speed/robot setup command used by speed initialization |
| `W` | Speed fast on PA6208 |
| `E` | Speed middle |
| `D` | Speed low on PA6208 |
| `<` | Begin auto charge |
| `>` | End auto charge |
| `X5` | Head up |
| `XA` | Head down |

The binary also contains motion tokens and labels. The PWA currently uses this practical mapping:

| Control | Command |
| --- | --- |
| Forward | `X1` |
| Forward left | `XG` |
| Forward right | `XK` |
| Left turn | `X6` |
| Right turn | `X7` |
| Backward | `X4` |
| Back left | `XO` |
| Back right | `XS` |
| Head up | `X5` |
| Head down | `XA` |

Additional extracted labels include `forward left 10/20/30/40`, `forward right 10/20/30/40`, `backwrad left 10/20/30/40`, and `backwrad right 10/20/30/40`, with related tokens in the `XF` through `XU` range.

The PWA maps the basic drive controls to the observed `X*` family and keeps a custom command field for validation and variants. It logs all discovered characteristics and, unless a write characteristic UUID is entered manually, writes commands to every writable characteristic under the selected service to handle PadBot variants whose motor characteristic is not the first writable characteristic returned by Web Bluetooth.

## Can it drive different robots?

Yes, within the PadBot BLE family. The native app is designed to scan and store multiple robot records, not one fixed robot. It can connect to different nearby PadBot units by name/service/UUID and keeps per-robot model/config information.

The PWA should drive different PadBot robots if they expose the same BLE service/characteristic contract and accept the same command tokens. It will not drive unrelated robot brands unless they intentionally implement the same BLE protocol.

## Browser constraints

Web Bluetooth requires a secure context: HTTPS or `localhost`. It works best in Chrome/Edge. Safari support is not generally available. The app must be served from a local server, not opened as a plain `file://` page.
