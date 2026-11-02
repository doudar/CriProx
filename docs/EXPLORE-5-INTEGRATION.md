# Explore 5 integration investigation

Status: October 31, 2026. Local sticker preparation, native discovery, and an experimental
BLE/USB connection probe are implemented. A physical Explore 5 answered a BLE firmware query
with **4.8.2**. An explicitly authorized USB session subsequently established encryption, read
firmware, and completed an SDK homing operation with the blade removed. The user confirmed physical
movement. A subsequent one-pass 80 g square cut was confirmed cleanly. Both workspaces now submit generated sheet jobs with native registration scanning, pressure/passes, and pause/resume/cancel. Optical acquisition and full-sheet alignment still need hardware validation.

## What was inspected

The local Windows installation has a `version` marker of 43.2.0. This is **not the Design Space
application version**: after its automatic startup update, the app and its archive metadata report
10.8.81 while that marker remains unchanged. Its `resources/app.asar`
contains an Electron main process, renderer bundles, and a preload bridge. The installation also
contains separate native processes, including `CricutDeviceIO.exe` and `CricutDevice.exe`.
Skarix did not modify installed application files; Design Space updated itself when launched.
The discovery probe starts its own native process,
enumerates adapters/devices, and shuts that process down. No proprietary source, WASM, or native
executables are distributed with Skarix. The research loader reads four hash-verified components
from the user's installation into a temporary directory, runs the isolated engine wrapper, and
removes that directory.

The installed renderer explicitly identifies **Gandalf as Explore 5**, machine type/family **24**,
using **Bifrost**, with USB and Bluetooth support. The original runtime reports **35.1.0** and
the 10.8.81 runtime reports **36.0.0**. Both return serial prefix `GDF`. The user's physical BLE
descriptor was classified as `gandalf`, and its firmware response was 4.8.2.

The offline probe actually instantiates `GandalfDevice` over an in-memory connection and requests
version information. The engine emits bytes, times out because no device answers, reports an
unencrypted connection, and disconnects. This verifies runtime invocation, not hardware control.

## Run the repeatable investigation

From the source checkout on Windows with the inspected Design Space installation:

```sh
npm run cutter:probe
npm run cutter:probe -- --usb
npm run cutter:probe -- --usb --bluetooth
```

The first command is entirely offline. The other commands add USB enumeration and, optionally, a
1.5-second Bluetooth discovery scan. They never create a device transport, connect to a cutter,
pair, activate, load, move, cut, or update firmware. Output includes recognized cutter types and
counts, without unrelated device names, serial numbers, or addresses. Runtime diagnostics can
appear on stderr; the report is JSON on stdout.

`scripts/lib/cricut-runtime.cjs` pins four component hashes for each inspected runtime, including
the 10.8.81 update. Unknown components fail before their code runs; the installation's version
marker alone is insufficient. The research probe uses this loader; the packaged controller has a separately bounded loader in electron/cutter/runtime.cjs. The research CLI remains outside the packaged
Electron application. The installed engine is used locally and is not a new redistributable driver.

### Physical connection probe

With exactly one powered-on Explore 5 available, run:

```sh
node scripts/cutter-connect.cjs
node scripts/cutter-connect.cjs --usb
```

The default performs a five-second BLE scan and enumerates before stopping the scan. The USB
option uses the native composite interface defaults found in Design Space. Both classify the
device before connecting, read firmware and the engine's encryption state, then disconnect and
destroy their own transport/adapter/process. Bifrost also starts its normal heartbeat and UX
monitoring tasks. Neither probe requests active mode, material loading, motion, registration scans,
cutting, or firmware updates **when invoked with the commands above**. Programmatic callers may
provide a separately authorized `keyProvider` and an `onAuthenticated` research callback. That
callback runs only after a completed handshake, an encrypted-state check, and a successful firmware
query. Session credentials and motion tests are not enabled by a CLI flag or packaged desktop IPC.
The JSON result goes to stdout and runtime diagnostics to stderr. Errors produce a nonzero exit.
`connected: true` means the transport opened; a firmware error still means the device query failed.

Observed on October 31 (local time):

- BLE found `Cricut-C22E`, classified it as Explore 5, opened its transport, and read firmware
  **4.8.2** using runtime 35.1.0. The engine reported `encrypted: false`.
- Launching installed Design Space automatically updated it to 10.8.81. The research loader was
  adapted to its independently checked components; its offline runtime probe passed.
- Two subsequent BLE scans found no Explore 5, including one after closing the idle Design Space
  window. The cause is unresolved; the first successful connection is not evidence of reliability.
- Initial USB queries failed with negative acknowledgments, including `0224080400` and global
  NACKs. Both original and updated runtimes were affected. The probe now uses the installed
  `ConnectionConfig` for the transport, including the normal USB three-second timeout and three retries.
- The normal machine-settings route returned HTTP 401 without authentication. With the user's
  explicit authorization, a local research helper read only Design Space's Auth0 cache and used its
  current access token at `https://apis.cricut.com/machine/v2/Machines/settings/24`. The response key
  was decoded using the normal client/user hash and passed to `establishEncryption`. Token and key
  values stayed in memory; they were not saved, printed, or included in the repository.
- After the user power-cycled the cutter and kept Design Space closed, USB encryption succeeded
  with runtime 36.0.0 and firmware 4.8.2. Subsequent authenticated inspection and homing sessions
  also succeeded. The exact cause of the earlier NACKs is not established.
- With the blade removed and motion explicitly authorized, the probe verified an idle carriage,
  entered the SDK active state, called `homeAxesSkill.homeAxes(true, true)`, awaited
  `waitUntilHomeFinished()`, verified **idle / zero queued moves**, and returned to idle state before
  disconnecting. The user confirmed seeing movement. No cut, material feed, optical scan, or firmware
  update was requested. This proves a homing command, not arbitrary-position or production cut accuracy.
- Runtime warnings remain: stale encrypted notifications before a new handshake and a failure to
  set default communication timeouts (`Persistent memory error: invalid argument`). These did not
  prevent the observed handshake/homing, but need investigation before a production controller.

Transport tests cover exact creation fields, UUID bytes, serialized writes, asynchronous data/state
notifications, rejection of replies for other adapters/transports, timeouts, and child-process cleanup.
The reusable research homing helper is `scripts/lib/cricut-home-test.cjs`; it has no side effects on
import and requires an authenticated, operator-authorized caller. Its tests reject busy/queued
states, propagate failures, and require completion followed by idle status. Returning the SDK UX
state to idle is not a verified emergency-stop mechanism. The Windows desktop controller now includes a bounded, read-only session provider behind explicit
user consent. It requests the Explore 5 key only from the official fixed machine-settings endpoint.
Credentials stay in the isolated worker memory and are neither persisted nor sent to the renderer.

## Native discovery protocol verified

`CricutDeviceIO.exe` starts with **no arguments**, hidden, with piped standard input/output. Each
message is a **4-byte unsigned little-endian byte length**, followed by a protobuf `Message`.
The observed schema has no general request ID: responses are matched by response field and,
for adapter messages, adapter ID. Skarix serializes requests and abandons the session after a timeout.

| Envelope | Field | Payload / meaning |
| --- | ---: | --- |
| Message | 1 | Log notification; does not complete a pending operation |
| Message | 3 | Adapter message |
| Message | 30 / 31 | Create Bluetooth LE serial adapter / response |
| Message | 40 / 41 | Create USB serial adapter / response |
| Adapter message | 1 | Adapter descriptor containing uint32 ID at field 1 |
| Adapter message | 10 / 11 | Destroy adapter / destroyed notification |
| Adapter message | 12 / 13 | Start scan / response |
| Adapter message | 14 / 15 | Stop scan / response |
| Adapter message | 31 / 32 | Enumerate BLE devices / response |
| Adapter message | 35 / 36 | BLE ready-state query / response |
| Adapter message | 51 / 52 | Enumerate USB devices / response |

Create responses contain adapter field 1 or error field 2. Scan responses contain an optional error
at field 1; an error's description is field 1. Enumeration responses repeat descriptors at field 1.
USB descriptor fields are vendor ID (1), product ID (2), revision (3), serial string (4), and OS ID
string (5). BLE descriptors expose high/low device ID (1/2), local name (3), manufacturer bytes (4),
and repeated service UUID bytes (5).

Small captured exchange, excluding USB descriptors and their local identifiers:

```text
Create USB adapter, including length: 03 00 00 00 c2 02 00
Create response body, adapter ID 1:   ca 02 04 0a 02 08 01
Enumerate request body:              1a 07 0a 02 08 01 9a 03 00
Destroy request body:                1a 06 0a 02 08 01 52 00
Destroyed response body:             1a 06 0a 02 08 01 5a 00
```

USB enumeration includes non-Cricut peripherals. The probe uses the installed engine's
`DeviceType.fromUsbSerialDescriptor` / `fromBluetoothLeDescriptor` for classification; a USB device
count is never presented as a cutter count. The real no-hardware run returned 13 USB descriptors,
zero recognized cutters, Bluetooth ready, and zero BLE descriptors. Every owned adapter was destroyed
and the child process exited. No existing Design Space process was controlled.

`electron/cutter/wire.cjs` and `discovery.cjs` independently implement this discovery subset with
bounded framing, response routing, request deadlines, and child cleanup. There is no raw-byte IPC
endpoint to the renderer and no device-connect/write command in the discovery implementation.

## Explore 5 engine and authenticated connection

The renderer creates a `GenericPhysicalConnection` with connect, disconnect, and write callbacks,
plus connection timeout/retry parameters. It feeds received bytes into that connection and passes it
to `GandalfDevice.createDevice`. The transport layer and the engine's device protocol are separate:
the protobuf framing above belongs to the local bridge, not directly to the cutter.

The installed runtime returns BLE characteristic UUIDs:

- RX: `49535343-1E4D-4BD9-BA61-23C647249616`
- TX: `49535343-8841-43F4-A8D4-ECBE34729BB3`

The fake transport captured `02010101021a0100` during engine startup/version interrogation. It is
retained as an observation, not a command to replay: no corresponding device response was captured,
and the factory also starts background UX/heartbeat tasks.

Design Space fetches machine settings through `getMachineTypesSettingsByIdV2`, whose route is
`/v2/Machines/settings/{machineTypeId}` under the machines service. It decodes the returned key using
the current account ID, application name, and application version, then supplies the result to
`handshakeSkill.establishEncryption`. It checks `isConnectionEncrypted` and registers an encryption
state callback to repeat the handshake after reconnection. The normal flow is therefore dependent
on session/service information, not just having the executable installed. The October 31 test
used an explicitly authorized existing Cricut session to obtain the key in memory. The desktop
session provider and subsequent protected-key storage are described below. No account token or machine key is stored in source
or distributed with Skarix.

## FreeKnife comparison

Inspected [OddPig/FreeKnife](https://github.com/OddPig/FreeKnife) at commit
`3dd2bc62041800d2300c32805bc48a63c5d8e1a2`. Its README states that only Explore Air 2 was tested.
The source was read without installing dependencies or running its device controller.

Its [device implementation](https://github.com/OddPig/FreeKnife/blob/3dd2bc62041800d2300c32805bc48a63c5d8e1a2/src/main/UnofficialCricutDevice/index.js#L410)
distinguishes a user-supplied long-term key from a device-supplied session key. It sends the older
pre-handshake/random-seed/error-clear/new-AES requests, decrypts the setup response with AES-256-ECB,
then extracts 32 session-key bytes at an offset identified by the first decrypted byte. Subsequent
commands use that session key, block padding, and an additive checksum. This is useful evidence for
the older protocol, not proof that Explore 5 uses the same commands or key.

The [welcome screen](https://github.com/OddPig/FreeKnife/blob/3dd2bc62041800d2300c32805bc48a63c5d8e1a2/src/renderer/page-welcome/index.js#L39)
expects externally obtained keys. It supplies a prefix and character-sum hint and mentions
`aes-finder`; it does not provide the complete required key. Its character-sum check is not
cryptographic validation and does not uniquely identify a key. The inspected controller has no
registration-mark scan or Print Then Cut implementation.

This refines the Explore 5 investigation: the settings-service key passed to `establishEncryption`
is handshake input, not assumed to be the final session traffic key. It was accepted by Explore 5's
installed engine in the October 31 USB test. Its lifetime and relationship to FreeKnife's older key
remain unverified.

An additional **offline-only** Bifrost probe used non-hex text and all-zero synthetic inputs of
16, 32, and 64 bytes. Every attempt emitted `02010101025a0100` and timed out waiting for a response
from the in-memory transport. Thus the engine starts an exchange before this test can determine
whether the supplied key is valid; none of these inputs was accepted or rejected as a real key.
No physical device, real key, account token, or remote authentication service was involved.

## Cut job and registration contract traced

| Task | Installed engine interface |
| --- | --- |
| Enter/exit active machine state | `uxStateMachineSkill.enterActiveState` / `exitActiveState` |
| Start a job | `plotJob.start(config)` with `PressureMachinesPlotJobConfig` |
| Observe job | `plotJob.registerEventsCallback`, `getProgress`, `getLastEvent` |
| Pause / resume | `plotJob.pause` / `resume` |
| Cancel with connected device | `plotJob.cancel` or `cancelAndWaitForFinish` |
| Abort after connection loss | `plotJob.abort` or `abortAndWaitForFinish` |
| Additional pass | `plotJob.doOneMorePass` |
| Optical scan | `printThenCutSkill.scanFiducials` |

The renderer distinguishes **cancel** from **abort**. On a connected device it requests cancellation;
on connection loss it disposes the transport and aborts the local job. Killing DeviceIO is not an
acknowledged physical stop.

The job config needs a pressure plot builder, material geometry/margins, tool descriptions, initial
tools, measurement length/movement settings, blade alignment pressure/movement, and optional PTC
configuration. Paths are transformed into their final coordinate system before being converted from
**points** to `PathMeasurement`. Tool settings supply pressure/pass count, speed, acceleration, and
blade/path offsets. These values cannot be inferred from sticker width and height alone.

For PTC, Design Space constructs `FiducialScanInputData` from the mark line width, fiducial padding,
top-left mark location, outer frame size, and material size, using **inches**. Outer frame width and
height are the image dimensions plus `2 × (padding + lineWidth)`. It wraps this in
`PressureMachinesPlotJobPTCConfig`, with a scan length whose renderer fallback is 0.4 inches and a
debug-data mode. This is an observed fallback, not a calibrated value for the user's machine.

Job events cover material loading/measurement/alignment, waiting for Go, fiducial scan
start/progress/pause/resume/completion, plot building, cutting progress/pause/resume, tool changes,
unloading, aborting, and completion. The probe reports the full installed event list. Finding those
interfaces does not establish their physical behavior or error recovery.

The runtime also exposes `PrintThenCutInkFrameSheetConfig.defaultGandalfConfig` and an SVG generator.
The renderer uses it for **calibration sheets**. It is not evidence that an arbitrary sticker layout
can reuse those marks as a production cut job.

## Generated registration geometry

The installed 10.8.81 machine-family configuration was inspected locally. Explore 5 (family 24), Explore,
Maker, and Joy Xtra share these print geometry values in PDF points: arm length 72, thickness 4.25197,
material-edge inset 36, inner clearance 18, and bleed radius 2. The upper-left mark has two shortened
bars and a small directional triangle. No session tokens or machine keys are needed for this geometry.

Skarix independently constructs those shapes in millimeters, sharing them between canvas guides,
vector PDF marks, and saved cut-job metadata. It uses its own page-relative frame, fixed at
12.7 mm from each paper edge. The former dense-layout adjustment could reduce the inset to 1 mm
(about 3.85 mm for eight cards on Letter); it was removed on October 31, 2026. Inspection of
`_calculateTightFiducialRectangle` in the installed composition code confirms that Design Space
clamps its frame against the material-edge boundary rather than expanding it beyond that boundary
to fit artwork. Generated geometry now identifies its placement as `skarix-page-frame-v2`.
Overlapping artwork is rejected without scaling; eight cards can use A4 instead. This does not duplicate Design Space's
artwork-dependent frame placement. PDF pixel checks verify marks, arrow gaps, physical page sizes,
54-label positions, card backs, and multi-page output. Sensor acquisition and cut alignment still
need hardware validation. Generated cut-job JSON is declarative geometry, not executable device commands.

## Working integration boundary

### Native pressure and passes

`electron/cutter/pressure-test.cjs` now converts the shared project settings to actual
`Tesseract.PressurePassSettings`/`PressureValueSettings.Pressure` instances. The installed renderer's
`_getAdjustedPressure` adds the material's `deltaAdjustment[0]` or `[2]` for Less/More. The inspected
Explore 5 fine-point profiles give white sticker paper 80 g with ±4 g, and medium cardstock 180 g
with ±9 g. Each selected pass is a separate native pass using that adjusted value.

The bounded test-square command constructs a real pressure plot, validates its compiled pass count
and grams, resolves initial tools, and runs `plotJob.start(config)`. It exposes native cancellation,
Load/Go/Unload messages, completion/error checks, and an idle-carriage check. It accepts only two
known material identifiers, three preset identifiers, 1–10 passes, and explicit scrap/blade readiness.
It does not accept arbitrary paths, raw grams, or movement settings from the renderer. A disconnected
transport aborts the local job; abort is not an acknowledged physical stop.

The event callback must return a Promise: a synchronous callback crashes the native Promise
bridge on the first event. `WaitingForMaterialMeasurement` also requires `plotJob.resume()` after
mat loading; the physical Go button does not release that barrier. Skarix resumes measurement
automatically. `WaitingForPlotStart` requires a second resume from the app's **Cut test square**
command; a physical Go press alone did not advance this step in the hardware test. That command is
accepted only once per test and only after measurement has reached the waiting-for-start state.

`node scripts/cutter-pressure-probe.cjs` builds 24 combinations and exercises native asynchronous
events and failure handling on a permanently disconnected transport, without connecting hardware.
The current app replaces the test-square controls with registered-sheet execution. The historical square test is not proof of optical registration accuracy.

On October 31, the Explore 5 (firmware 4.8.2) completed the requested 12.7 mm square over USB at
80 g and one pass. The user confirmed a clean square, and the native job confirmed completion and
idle before disconnection. No multi-pass physical cut was attempted. A small slit was reported
during the earlier measurement/alignment stage; the square itself started only after the app-side
resume command. Native cancellation of a prior waiting job was also acknowledged.

- Native Electron IPC exposes a fixed allowlist: connection state, authorized USB/BLE connect,
  disconnect, blade-confirmed homing, validated registered-sheet jobs, pause/resume, and cancellation. An isolated background worker owns the hash-pinned
  installed runtime, native process, and in-memory credentials. Concurrent commands are rejected;
  operations are bounded and disconnect/crash loses the authenticated state. Renderer-supplied paths,
  raw packets, script execution, and arbitrary motion commands are not accepted.
- The app uses an explicit session-consent checkbox. A read-only cache parser selects one current
  Cricut-audience session and matching identity. It sends the token only to the fixed official
  machine-settings endpoint and rejects redirects. Login tokens are never saved or logged. The
  subsequent protected-key feature saves only a successfully authenticated machine key through
  Electron safeStorage in the main process, using Windows account protection. The worker accesses
  that fixed store over private IPC; credentials never reach the renderer. A saved key is scoped to
  Explore 5 and the inspected application version, tried before session lookup, and removed on a
  failed handshake before one fresh-key retry. Disconnect and **Forget saved key** removes it.
  A fresh app-service USB test authenticated, read firmware 4.8.2 and idle status, then disconnected.
- Portable sticker projects embed artwork, the ordered sheet items, layout settings, and optional
  original captured PDF bytes. Capture geometry is checked again when reopening the file.
- Sticker exports contain PNG artwork, matching SVG cut references, and a coordinate CSV. Design
  Space remains responsible for making and executing the cut job.
- Reusable registered PDFs use captured marks with per-slot artwork replacement. Geometry checks
  are plausibility checks, not authentication or physical sensor validation.

## Work still required for direct control

1. Make connection and recovery reliable over BLE and USB. Investigate earlier NACKs, stale
   notifications, the default-timeout warning, and the later BLE discovery failures.
2. Extend the explicit session flow to handle future inspected Design Space builds and session refresh.
   Retain runtime/build checks and never bundle account credentials or machine keys.
3. Validate the implemented scan configuration and inner-frame path transform against actual sensor acquisition, including both Letter and A4 placement.
4. Validate full-sheet cancellation, pause/resume, and recovery on hardware; these controls now use the native job API. Keep hardware evidence separate from mocked state-machine and offline builder checks.
5. Validate load, scan, cut, pause/resume, cancel, and unload on the actual machine, then measure
   a plain-paper test before sticker stock. Retain protocol fixtures without private credentials.

The [official Explore 5 workflow](https://help.cricut.com/hc/en-us/articles/38613592650903-How-to-Print-Then-Cut-with-Cricut-Explore-5)
documents the directional arrow, landscape A4 mat placement, material selection, and physical Go
button. These requirements were used to write the handoff instructions; they do not provide a
public direct-control protocol.

## Generated sheet execution and direct printing

The app's square-test command and UI have been removed. A strict sheet-job validator accepts only the generated v1 contour schema, Explore 5, Letter/A4, and the current canonical page frame. It rejects invalid dimensions, mark/paper collisions, unsupported material settings, and arbitrary path/packet input. It rebuilds rounded contours itself and selects one sheet; duplex backs never become cutter jobs.

The independently inspected Design Space contract supplies the outer registration frame and paper size to FiducialScanInputData, with 1.5 mm stroke thickness, 6.35 mm clearance plus 2 pt bleed padding, and a 0.4 inch scan length. Path coordinates subtract the frame origin plus stroke and padding before the native registration transform. A single shared geometry module now serves the preview, PDF, and native validator.

Cut sheet snapshots the prepared geometry and cut settings, resumes measurement and WaitingForPlotStart once, and requires a successful PrintThenCutFiducialScanCompleted result as well as plot completion and an idle carriage. Scan failure/retry requests cancel the job. Pause/resume and cancellation use native APIs; no raw motion bypass is offered. A 30-minute deadline requests cancellation. Hardware testing of the complete optical sequence is pending.

The offline runtime probe builds a 54-contour registered sheet, checks native path counts and PTC configuration, and tests 24 material/pressure/pass combinations without enumerating hardware. Unit tests cover mismatched frames, invalid contours, selected sheets, scan failures, duplicate start events, pause/resume, and cancellation.

Direct printing rasterizes the prepared PDF at 300 DPI, streams validated PNG pages to a temporary directory, and opens the system printer dialog. Temporary data is removed on completion or cancellation. Exact page dimensions, zero requested margins, scale, and duplex binding are passed explicitly. The original-resolution PDF export remains available. The PDF preview rerenders for actual display pixels and zoom instead of enlarging a fixed low-resolution canvas.

## First successful registered sheet — October 31, 2026

The user printed the generated marked sheet from Skarix and ran the Explore 5 scan-and-cut workflow. They reported that it worked on the first try and produced usable stickers. The active job used Letter, white sticker paper, fine-point blade, Medium / 80 g, and one pass over authenticated USB. This confirms that complete workflow on this setup; it does not establish A4 placement, other materials/forces, multi-pass results, pause/resume, or repeatability.

## macOS BLE handoff — November 2, 2026

Anthony supplied Mac investigation evidence: Apple Silicon arm64, macOS 26.6.2, enabled Apple N1 controller, Cricut-C22E identified as Gandalf / Explore 5, firmware 4.8.2, Design Space 10.8.81 and Bifrost 36.0.0. The installed signed universal DeviceIO executable and all four updated-runtime hashes matched. BLE connection, encryption, firmware query and SDK homeAxes(true,true) succeeded; Anthony confirmed physical movement. The probe returned to idle with zero queued moves, disconnected and cleaned up. This evidence is from the separate Mac investigation, not a new hardware test during this implementation.

Production integration resolves the Mac app bundle, archive and bridge paths, uses the home directory for session lookup, polls adapter readiness every 250 ms for up to five seconds, permits cancellation, and uses Keychain-backed safeStorage. Explore 5 BLE cutting is enabled, including registration scanning and job controls. Anthony subsequently confirmed successful physical cutting on macOS on November 2, 2026. This removes the experimental macOS cutting designation; the report does not separately establish pause/resume, cancellation or sustained reliability. Saved-key persistence and permission/signing behavior remain unverified in the packaged Mac app.

The investigation observed request 920d00 returning an invalid response and a default-communication-timeout persistent-memory invalid-argument warning. Authentication and homing nevertheless succeeded. This warning remains unresolved. Existing worker diagnostic suppression predates this work; no new suppression or claimed fix is introduced. Follow-up needs a bounded diagnostic investigation that avoids exposing account or device secrets. The temporary harness /private/tmp/skarix-mac-ble-investigation.cjs exists only on the research Mac and was not available to this Windows implementation.

Remaining Mac acceptance checks: disabled/denied Bluetooth, connection ownership by Design Space, repeated connections and power cycles, worker cleanup, changed/missing runtime components, expired sign-in and handshake retry, and real Keychain save/reload/delete/denial across app updates. Automated fixtures cover delayed readiness, cancellation, file discovery and storage failure behavior; Windows tests remain required.
