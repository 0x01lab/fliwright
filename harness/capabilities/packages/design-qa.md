---
package: "fliwright_design_qa"
path: "packages/fliwright-design-qa"
source_fingerprint: "5f147ebbc4d1bce2e802a0e49ab32ee5fe5a9675ca014eb09e78bde21e89cd0a"
generated: true
---

# Design Qa Capabilities

## Responsibility

Run inside debug/profile Flutter applications, provide the optional QR pairing UI, and send clean shake-triggered screenshots to a paired Figma Design QA plugin over the Design QA protocol.

## Boundary

### May Depend On

- None

### Must Not Own

- `Figma plugin UI`
- `signaling service deployment`
- `GitLab issue creation`
- `generic VM-service automation`

## Owned Capabilities

- `Design QA capture SDK`
- `shake-triggered screenshot workflow`
- `QR pairing UI`

## Dart Library Entrypoints

- `packages/fliwright-design-qa/lib/fliwright_design_qa.dart`

## Public Dart Classes

- `DesignQaAccelerationSample`
- `DesignQaAccelerometerEventChannel`
- `DesignQaCapture`
- `DesignQaCaptureResult`
- `DesignQaCaptureSuccessIndicator`
- `DesignQaController`
- `DesignQaControllerConfig`
- `DesignQaControllerSnapshot`
- `DesignQaDeviceContext`
- `DesignQaPairingPage`
- `DesignQaPairingPayload`
- `DesignQaPeerJsMessage`
- `DesignQaPeerJsSignalingKeepAlive`
- `DesignQaPeerServerConfig`
- `DesignQaPlatformTransport`
- `DesignQaRenderViewScreenshotProvider`
- `DesignQaSdk`
- `DesignQaSdkConfig`
- `DesignQaShakeDetector`
- `DesignQaShakeTriggerBinding`
- `DesignQaWebRtcTransport`

## Source Anchors

- `packages/fliwright-design-qa/lib/fliwright_design_qa.dart`
- `packages/fliwright-design-qa/lib/src/accelerometer_event_channel.dart`
- `packages/fliwright-design-qa/lib/src/capture_success_indicator.dart`
- `packages/fliwright-design-qa/lib/src/design_qa_controller.dart`
- `packages/fliwright-design-qa/lib/src/design_qa_pairing_page.dart`
- `packages/fliwright-design-qa/lib/src/design_qa_sdk.dart`
- `packages/fliwright-design-qa/lib/src/pairing.dart`
- `packages/fliwright-design-qa/lib/src/peerjs_keep_alive.dart`
- `packages/fliwright-design-qa/lib/src/peerjs_signaling.dart`
- `packages/fliwright-design-qa/lib/src/platform_transport.dart`
- `packages/fliwright-design-qa/lib/src/protocol.dart`
- `packages/fliwright-design-qa/lib/src/render_view_screenshot_provider.dart`
- `packages/fliwright-design-qa/lib/src/shake_detector.dart`
- `packages/fliwright-design-qa/lib/src/shake_trigger.dart`
- `packages/fliwright-design-qa/lib/src/signaling_config.dart`
- `packages/fliwright-design-qa/lib/src/transport.dart`
- `packages/fliwright-design-qa/lib/src/webrtc_transport.dart`
