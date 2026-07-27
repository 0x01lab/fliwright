# fliwright_design_qa

Debug/profile-only Design QA capture SDK for sending clean Flutter screenshots
to the Design QA Hub Figma plugin.

The default interaction is shake-to-capture. The SDK intentionally does not
render a floating button or any screenshot-time overlay, so captured evidence
does not include debug UI. Once a clean screenshot has been captured, its
thumbnail shrinks to the bottom of the screen while the transfer is in flight;
Figma confirmation adds a checkmark, then the feedback fades away. The overlay
never handles touch events.

## Current Surface

This package currently provides the protocol-safe core:

- Figma QR payload parsing.
- HMAC-SHA-256 pairing proof generation.
- Design QA DataChannel control-frame rendering and mobile-side handling for
  Figma `hello`, `ready`, `ping`, `capture-accept`, and `capture-complete`
  frames.
- PNG chunking with the 16 KiB / 2 MB protocol limits.
- Shake detection with debounce.
- `DesignQaSdk` facade with injectable transport and screenshot provider.
- `DesignQaRenderViewScreenshotProvider` for clean RenderView screenshots
  without any screenshot-time overlay.
- `DesignQaShakeTriggerBinding` for wiring any accelerometer sample stream into
  the SDK.
- `DesignQaController` for host apps that want one lifecycle object for pairing,
  shake listening, capture status, and shutdown.
- `DesignQaPairingPage`, an optional camera QR scanner that closes itself once
  the active Figma session is paired.
- `DesignQaPeerServerConfig` for validating the PeerServer host/path/secure
  settings derived from the Figma QR payload.
- `DesignQaAccelerometerEventChannel` for consuming host-provided accelerometer
  samples over a Fliwright-owned platform channel.
- `DesignQaWebRtcTransport` for PeerJS signaling and reliable, ordered WebRTC
  DataChannel transport.

The package owns the required runtime dependencies inside Fliwright: its plugin
provides the iOS/Android accelerometer source with CoreMotion and SensorManager,
while `flutter_webrtc` provides the WebRTC engine. Exio only depends on
`fliwright_bridge`; it does not import or configure these dependencies itself.
The default controller factory uses Fliwright's accelerometer channel and the
direct PeerJS/WebRTC transport. Host apps can still inject their own transport,
accelerometer stream, or screenshot provider.

## Example

```dart
final sdk = DesignQaSdk(
  transport: webRtcTransport,
  screenshotProvider: const DesignQaRenderViewScreenshotProvider(
    deviceModel: 'debug-device',
    appVersionBuild: '1.0.0+debug',
  ),
);

await sdk.pairFromQrPayload(scannedQrPayload);

final shakeBinding = DesignQaShakeTriggerBinding(
  sdk: sdk,
  samples: accelerometerSamples,
);
shakeBinding.start();
```

Host apps can use the lifecycle controller instead:

```dart
final controller = DesignQaController.withPlatformAdapters(
  config: const DesignQaControllerConfig(
    screenshotProvider: DesignQaRenderViewScreenshotProvider(
      deviceModel: 'debug-device',
      appVersionBuild: '1.0.0+debug',
    ),
  ),
);

await controller.pairFromQrPayload(scannedQrPayload);

// Pairing starts shake listening by default. Call startShakeCapture() only
// after an explicit stop or when autoStartShake is disabled.

// Optional debug action for validating the capture path before wiring sensors.
await controller.captureNow();
```

For apps that already expose accelerometer samples from native code or another
sensor package, use the injectable constructor:

```dart
final controller = DesignQaController(
  transport: DesignQaPlatformTransport(),
  accelerationSamples: customAccelerationSamples,
);
```

Apps that already use `fliwright_bridge` can register VM-service methods from
a debug startup task. `FliwrightDesignQaExtension` is exported by
`fliwright_bridge`, so host apps do not need to import this package directly:

```dart
final controller = FliwrightDesignQaExtension.registerDefault(
  FliwrightBridge.registry,
);
```

Use `FliwrightDesignQaExtension(controller: controller).register(...)` when the
host app needs a custom controller or transport.

For the Exio debug entry point, keep the app dependency on `fliwright_bridge`
only, then register after `FliwrightBridge.initForDioMock(...)` in
`apps/exio_app/lib/startup/fliwright_bridge_startup_task.dart`:

```dart
final designQaController = FliwrightDesignQaExtension.registerDefault(
  FliwrightBridge.registry,
);
debugPrint(
  '[FliwrightBridge] Design QA state: '
  '${designQaController.snapshot.state.name}',
);
```

This exposes:

- `ext.fliwright.designQa.status`
- `ext.fliwright.designQa.diagnostics` with optional `qrPayload`
- `ext.fliwright.designQa.pair` with `qrPayload`
- `ext.fliwright.designQa.capture`
- `ext.fliwright.designQa.startShake`
- `ext.fliwright.designQa.stopShake`
- `ext.fliwright.designQa.openPairing`, which opens the in-app QR scanner
- `ext.fliwright.designQa.close`

## Exio Smoke Test

1. Start the Design QA Figma plugin and open **Pair device**. Click **Start
   pairing** and leave its QR code visible.
2. Start the Exio Fliwright debug entry point on a real device. Restart the app
   after adding this package so the Dart VM-service extensions are loaded.
3. Open the Fliwright-owned scanner page:

   ```sh
   pnpm --filter @fliwright/e2e-tests test:design-qa:auto -- \
     --vm-url "$VM_SERVICE_URL" \
     --open-pairing
   ```

   Scan the Figma QR code. The page automatically closes after pairing, leaving
   the controller in `listening` state on the underlying Exio page.

4. For non-interactive smoke tests, Fliwright can still pair from the copied
   payload:

   ```ts
   await driver.designQa.pair(qrPayload);
   const status = await driver.designQa.status();
   console.log(status.designQa.state); // listening
   ```

   The packaged smoke command accepts the same VM Service URL and QR payload:

   ```sh
   FLIWRIGHT_VM_SERVICE_URL="ws://127.0.0.1:54321/xxxx=/ws" \
   FLIWRIGHT_DESIGN_QA_QR_PAYLOAD="$QR_PAYLOAD" \
   pnpm --filter @fliwright/e2e-tests test:design-qa:auto -- --vm-url "$VM_SERVICE_URL"
   ```

   The command accepts either Flutter's printed DDS URL or the final VM
   WebSocket URL. It resolves the DDS redirect and injects the normalized
   address into the smoke test. Add `--capture` to exercise the manual capture
   branch on a simulator; QR payloads are never printed by the runner.

5. Shake the device. The SDK captures the Flutter RenderView without any
   floating button or screenshot-time overlay and sends the PNG over the Design
   QA WebRTC DataChannel.
6. Confirm the screenshot lands in Figma and does not contain Design QA UI.

`driver.designQa.capture()` remains available for validating the transport on
simulators or when sensors are unavailable, but the intended QA interaction is
shake-to-capture.

## Custom Accelerometer EventChannel

`DesignQaController.withPlatformAdapters()` uses
`DesignQaAccelerometerEventChannel` by default. Native code or another
Fliwright-owned package can provide samples on this channel without making the
business app depend on `sensors_plus`.

On iOS and Android, `fliwright_design_qa` provides this channel itself. A host
only needs to provide an alternate stream when it intentionally replaces the
default sensor source.

The default accelerometer channel is:

```text
fliwright_design_qa/accelerometer
```

Native or host-side code can emit either maps:

```json
{"x": 1.2, "y": -3.4, "z": 20.0, "timestampMs": 1784160000123}
```

or lists:

```json
[1.2, -3.4, 20.0, 1784160000123]
```

## Platform Transport

`DesignQaPlatformTransport` remains available for a host that deliberately
provides its own transport. The default controller uses
`DesignQaWebRtcTransport`, which registers a temporary mobile PeerJS id, dials
the Figma room and uses a reliable, ordered WebRTC DataChannel.

The default transport channels are:

```text
MethodChannel: fliwright_design_qa/transport
EventChannel:  fliwright_design_qa/transport_control
```

The host transport should implement:

- `connect({version, signalingUrl, roomId, iceConfigId, peerServer})`
- `sendControl({message})`
- `sendBinary(Uint8List bytes)`
- `close()`

Inbound DataChannel control frames from Figma are handled directly by
`DesignQaWebRtcTransport`; the EventChannel is only for custom host transports.

The `signalingUrl` should use `wss://` or `https://`, matching the Figma plugin
PeerJS configuration.

`peerServer` contains the parsed PeerJS host/path/secure/key fields for custom
transport implementations that do not want to re-parse the QR payload URL.

The `connect` payload intentionally does not include `pairingSecret`; the Dart
SDK keeps it in memory and only sends the derived proof over the DataChannel.
