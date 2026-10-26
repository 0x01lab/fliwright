# @fliwright/devices

Shared host device discovery for CLI, editor integrations and cloud Workers.
No Flutter app or VM Service connection is required.

```ts
import { DeviceDiscovery } from '@fliwright/devices';

const inventory = await new DeviceDiscovery().scan();
// inventory.devices, inventory.diagnostics, inventory.scannedAt
```

- iOS: Xcode `simctl` lists booted, stopped and unavailable iOS simulators;
  `xcdevice` lists physical iPhones/iPads, including unavailable devices known to Xcode.
  macOS, watchOS and tvOS devices are excluded. iOS detection requires macOS.
- Android: `adb devices -l` lists connected physical devices and running emulators,
  including offline and unauthorized devices. `emulator -list-avds` adds stopped AVDs.
  Running AVD names merge into the connected emulator entry. An unidentified/offline
  emulator makes unmatched AVD state `unknown`, because shutdown cannot be proven.
- `osVersion`, `model`, `avdName` and device diagnostic `detail` are optional.
  iOS unavailable devices report Xcode's detail rather than guessing authorization state.
- Android executables resolve through `ANDROID_HOME`, `ANDROID_SDK_ROOT`, the standard
  host SDK location, then PATH. Override with constructor `tools: { adb, emulator, xcrun }`.
- `scan({ platforms: ['android'], timeoutMs: 8000, signal })` limits detection.
  The default scans Android and, on macOS, iOS. Each tool command has a bounded timeout.
  Cancellation rejects; native tool failures appear in `diagnostics` and other results survive.
  An empty list with diagnostics is incomplete detection, not proof of an empty host.
- Detection does not launch apps or boot, erase, unlock or pair devices. ADB may start
  its normal host daemon while enumerating. Android OS metadata uses read-only getprop.
- A stopped AVD uses `avd:<name>` as its inventory ID; that ID cannot launch a Flutter app.
  Once running, use its native `emulator-<port>` ID. Device IDs are scoped to the host/platform.

The package owns device information, native tool execution and normalization.
Cloud inventory freshness, registration, slot leases, scheduling and reset policies
remain with the cloud package. Scanning never creates execution slots.

CLI: `fliwright devices list --json` or `fliwright devices list --platform ios --json`.


## Device change notifications

`discovery.watch(changed, { signal })` returns a disposal function. It observes
Android `adb track-devices`, iOS `xcdevice observe --both` on macOS, AVD directory
changes and CoreSimulator device state files. Notifications are coalesced for
150ms; call `scan()` to read normalized inventory. Native observers retry after
failure. Abort or dispose to release child processes and filesystem watchers.
Keep periodic scans for state transitions without complete native notifications
and to surface tool diagnostics; notifications alone do not certify readiness.
