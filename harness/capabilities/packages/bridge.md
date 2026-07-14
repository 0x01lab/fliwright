---
package: "fliwright_bridge"
path: "packages/fliwright-bridge"
source_fingerprint: "311a6b5cf3dfcd62a4a7cdcbed59e6e73d44a95f036a10b53ae844ef5648bc34"
generated: true
---

# Bridge Capabilities

## Responsibility

Run inside Flutter applications and expose ext.fliwright.* VM-service methods for inspection, control, capture, recording, and mocks.

## Boundary

### May Depend On

- None

### Must Not Own

- `TypeScript orchestration`
- `CLI or MCP transport`
- `editor UX`

## Owned Capabilities

- `Flutter app instrumentation`
- `VM service extensions`

## VM Service Methods

- `ext.fliwright.action`
- `ext.fliwright.app.capabilities`
- `ext.fliwright.app.info`
- `ext.fliwright.app.invoke`
- `ext.fliwright.app.snapshot`
- `ext.fliwright.captureFrame`
- `ext.fliwright.click`
- `ext.fliwright.context`
- `ext.fliwright.currentRoute`
- `ext.fliwright.dragFrom`
- `ext.fliwright.extractForm`
- `ext.fliwright.gesture`
- `ext.fliwright.goBack`
- `ext.fliwright.hitTest`
- `ext.fliwright.hover`
- `ext.fliwright.inspect`
- `ext.fliwright.mock.addRoute`
- `ext.fliwright.mock.clearCalls`
- `ext.fliwright.mock.clearForeignRoutes`
- `ext.fliwright.mock.clearRoutes`
- `ext.fliwright.mock.debugState`
- `ext.fliwright.mock.getCalls`
- `ext.fliwright.mock.listRoutes`
- `ext.fliwright.mock.removeRoute`
- `ext.fliwright.mock.setPassthrough`
- `ext.fliwright.mock.testRequest`
- `ext.fliwright.navigate`
- `ext.fliwright.query`
- `ext.fliwright.resetRouteStack`
- `ext.fliwright.resolve`
- `ext.fliwright.riverpod.list`
- `ext.fliwright.riverpod.override`
- `ext.fliwright.riverpod.read`
- `ext.fliwright.riverpod.status`
- `ext.fliwright.riverpod.unwatch`
- `ext.fliwright.riverpod.watch`
- `ext.fliwright.screenshot`
- `ext.fliwright.scrollIntoView`
- `ext.fliwright.settle`
- `ext.fliwright.snap`
- `ext.fliwright.snapshot`
- `ext.fliwright.sourceMap`
- `ext.fliwright.startRecording`
- `ext.fliwright.stopRecording`
- `ext.fliwright.storage.reset`
- `ext.fliwright.type`

## Bridge Extension Modules

- `app_instance`
- `capture_frame`
- `context`
- `diagnostics`
- `dio_mock_extension`
- `dio_mock_interceptor`
- `form_extract`
- `gesture`
- `hive_mock_rule_storage`
- `http_overrides`
- `inspect`
- `mock_extension_helpers`
- `mock_rule_store`
- `mock_server`
- `query`
- `recording`
- `riverpod`
- `router_navigate`
- `screenshot`
- `scroll_extension`
- `settle_extension`
- `snap`
- `snapshot`
- `source_map`
- `storage_reset`
- `type_extension`

## Dart Library Entrypoints

- `packages/fliwright-bridge/lib/fliwright_bridge.dart`

## Public Dart Classes

- `ActionabilityException`
- `CaptureFrameExtension`
- `ClickIndicator`
- `ContextExtension`
- `DebugValueEncoder`
- `DioMockExtension`
- `ExtensionRegistry`
- `ExtractedSemantics`
- `FliwrightAppCapability`
- `FliwrightAppInstance`
- `FliwrightAuthCapability`
- `FliwrightBridge`
- `FliwrightDioMockInterceptor`
- `FliwrightFormControl`
- `FliwrightFormOption`
- `FliwrightHttpOverrides`
- `FormExtractExtension`
- `GestureExtension`
- `HiveMockRuleStorage`
- `InspectExtension`
- `MockCallRecord`
- `MockRoute`
- `MockRuleStore`
- `MockServerExtension`
- `ObservedRiverpodProvider`
- `ParsedSelector`
- `ParsedSelectorAst`
- `QueryExtension`
- `QueryRef`
- `RecordingExtension`
- `RefEntry`
- `RefRegistry`
- `RiverpodExtension`
- `RouterNavigateExtension`
- `ScreenshotExtension`
- `ScrollExtension`
- `SemanticsCompat`
- `SettleExtension`
- `SnapExtension`
- `SnapshotExtension`
- `SourceMapExtension`
- `StorageResetExtension`
- `TypeExtension`

## Source Anchors

- `packages/fliwright-bridge/lib/fliwright_bridge.dart`
- `packages/fliwright-bridge/lib/src/actionability_gate.dart`
- `packages/fliwright-bridge/lib/src/bridge.dart`
- `packages/fliwright-bridge/lib/src/click_indicator.dart`
- `packages/fliwright-bridge/lib/src/debug_value_encoder.dart`
- `packages/fliwright-bridge/lib/src/extension_registry.dart`
- `packages/fliwright-bridge/lib/src/extensions/app_instance.dart`
- `packages/fliwright-bridge/lib/src/extensions/capture_frame.dart`
- `packages/fliwright-bridge/lib/src/extensions/context.dart`
- `packages/fliwright-bridge/lib/src/extensions/diagnostics.dart`
- `packages/fliwright-bridge/lib/src/extensions/dio_mock_extension.dart`
- `packages/fliwright-bridge/lib/src/extensions/dio_mock_interceptor.dart`
- `packages/fliwright-bridge/lib/src/extensions/form_extract.dart`
- `packages/fliwright-bridge/lib/src/extensions/gesture.dart`
- `packages/fliwright-bridge/lib/src/extensions/hive_mock_rule_storage.dart`
- `packages/fliwright-bridge/lib/src/extensions/http_overrides.dart`
- `packages/fliwright-bridge/lib/src/extensions/inspect.dart`
- `packages/fliwright-bridge/lib/src/extensions/mock_extension_helpers.dart`
- `packages/fliwright-bridge/lib/src/extensions/mock_rule_store.dart`
- `packages/fliwright-bridge/lib/src/extensions/mock_server.dart`
- `packages/fliwright-bridge/lib/src/extensions/query.dart`
- `packages/fliwright-bridge/lib/src/extensions/recording.dart`
- `packages/fliwright-bridge/lib/src/extensions/riverpod.dart`
- `packages/fliwright-bridge/lib/src/extensions/router_navigate.dart`
- `packages/fliwright-bridge/lib/src/extensions/screenshot.dart`
- `packages/fliwright-bridge/lib/src/extensions/scroll_extension.dart`
- `packages/fliwright-bridge/lib/src/extensions/settle_extension.dart`
- `packages/fliwright-bridge/lib/src/extensions/snap.dart`
- `packages/fliwright-bridge/lib/src/extensions/snapshot.dart`
- `packages/fliwright-bridge/lib/src/extensions/source_map.dart`
- `packages/fliwright-bridge/lib/src/extensions/storage_reset.dart`
- `packages/fliwright-bridge/lib/src/extensions/type_extension.dart`
- `packages/fliwright-bridge/lib/src/form_control.dart`
- `packages/fliwright-bridge/lib/src/ref_registry.dart`
- `packages/fliwright-bridge/lib/src/semantics_compat.dart`
