---
package: "fliwright-vscode"
path: "packages/fliwright-vscode"
source_fingerprint: "98316766d9902b8d6c2176539ba9161c47f8f8cbc1769eded0bc9da9efcd65ba"
generated: true
---

# Vscode Capabilities

## Responsibility

Own VS Code commands, views, webviews, and project workflows that consume public package capabilities.

## Boundary

### May Depend On

- `@fliwright/core`
- `@fliwright/cli`
- `@fliwright/plugin-riverpod`
- `@fliwright/tdd`

### Must Not Own

- `automation primitives`
- `MCP tool contracts`
- `Flutter instrumentation`

## Owned Capabilities

- `VS Code integration`
- `editor and webview UX`

## Package Entrypoints

- `.`

## VS Code Commands

- `fliwright.addAnalyzedFieldToFormRules`
- `fliwright.analyzeForm`
- `fliwright.appendLastAnalyzeToFormRules`
- `fliwright.applyDefaultMocks`
- `fliwright.applyMockRule`
- `fliwright.cleanFlowFile`
- `fliwright.configureMcp`
- `fliwright.connect`
- `fliwright.copyMockEndpoint`
- `fliwright.copyMockRuleJson`
- `fliwright.copyStateProviderValue`
- `fliwright.createFlow`
- `fliwright.createFlowReviewBundle`
- `fliwright.createFlowReviewPlan`
- `fliwright.createFormRules`
- `fliwright.createFormRulesFromLastAnalyze`
- `fliwright.createMockConfig`
- `fliwright.disconnect`
- `fliwright.discoverVmService`
- `fliwright.fillForm`
- `fliwright.fillFormWithRules`
- `fliwright.generateFlowTest`
- `fliwright.insertFormFieldSelector`
- `fliwright.insertRecordedTest`
- `fliwright.openFailure`
- `fliwright.openFlow`
- `fliwright.openFlowJson`
- `fliwright.openFormRules`
- `fliwright.openMockConfig`
- `fliwright.openRecording`
- `fliwright.openRiverpodSetupHelp`
- `fliwright.openRunViewer`
- `fliwright.openScript`
- `fliwright.openTddLoop`
- `fliwright.openTraceViewer`
- `fliwright.openVisualEditor`
- `fliwright.overrideStateProvider`
- `fliwright.readStateProvider`
- `fliwright.refreshFlows`
- `fliwright.refreshStateProviders`
- `fliwright.refreshTddLoop`
- `fliwright.refreshTestFile`
- `fliwright.refreshTests`
- `fliwright.reloadFormRules`
- `fliwright.reloadMocks`
- `fliwright.reloadScripts`
- `fliwright.runCurrentTest`
- `fliwright.runScript`
- `fliwright.runWorkspaceTests`
- `fliwright.showLastRun`
- `fliwright.showLastTrace`
- `fliwright.startRecording`
- `fliwright.stopMockRule`
- `fliwright.stopRecording`
- `fliwright.stopSandbox`
- `fliwright.stopTests`
- `fliwright.takeScreenshot`
- `fliwright.tddTakeOver`
- `fliwright.unwatchStateProvider`
- `fliwright.viewScriptRun`
- `fliwright.viewTestRun`
- `fliwright.watchStateProvider`

## VS Code Views

- `fliwright.devices`
- `fliwright.flows`
- `fliwright.formData`
- `fliwright.mockApis`
- `fliwright.scripts`
- `fliwright.state`
- `fliwright.tests`

## Source Anchors

- `packages/fliwright-vscode/src/config.ts`
- `packages/fliwright-vscode/src/editor/AnnotationParser.ts`
- `packages/fliwright-vscode/src/editor/AnnotationWriter.ts`
- `packages/fliwright-vscode/src/editor/EditorBridge.ts`
- `packages/fliwright-vscode/src/editor/TestEditorPanel.ts`
- `packages/fliwright-vscode/src/editor/TestEditorProvider.ts`
- `packages/fliwright-vscode/src/editor/getHtml.ts`
- `packages/fliwright-vscode/src/editor/types.ts`
- `packages/fliwright-vscode/src/extension.ts`
- `packages/fliwright-vscode/src/failure/FailureContextStore.ts`
- `packages/fliwright-vscode/src/flows/FlowFileService.ts`
- `packages/fliwright-vscode/src/form/FormHelperService.ts`
- `packages/fliwright-vscode/src/form/FormRuleService.ts`
- `packages/fliwright-vscode/src/json.ts`
- `packages/fliwright-vscode/src/recording/RecorderService.ts`
- `packages/fliwright-vscode/src/recording/RecordingPersistenceService.ts`
- `packages/fliwright-vscode/src/runner/FliwrightCodeLensProvider.ts`
- `packages/fliwright-vscode/src/runner/TestDiscoveryService.ts`
- `packages/fliwright-vscode/src/runner/TestRunner.ts`
- `packages/fliwright-vscode/src/runner/VitestRunner.ts`
- `packages/fliwright-vscode/src/runviewer/RunViewerService.ts`
- `packages/fliwright-vscode/src/sandbox/MockConfigService.ts`
- `packages/fliwright-vscode/src/sandbox/SandboxService.ts`
- `packages/fliwright-vscode/src/screenshot/ScreenshotService.ts`
- `packages/fliwright-vscode/src/scripts/ScriptDiscoveryService.ts`
- `packages/fliwright-vscode/src/scripts/ScriptRunner.ts`
- `packages/fliwright-vscode/src/scripts/VitestScriptConfig.ts`
- `packages/fliwright-vscode/src/session/FliwrightSession.ts`
- `packages/fliwright-vscode/src/session/VmServiceDiscovery.ts`
- `packages/fliwright-vscode/src/state/StateInjectionService.ts`
- `packages/fliwright-vscode/src/state/StateProviderDocumentProvider.ts`
- `packages/fliwright-vscode/src/status/StatusBarService.ts`
- `packages/fliwright-vscode/src/tddloop/TddLoopController.ts`
- `packages/fliwright-vscode/src/tddloop/TddLoopPanel.ts`
- `packages/fliwright-vscode/src/tddloop/TddLoopStatusSource.ts`
- `packages/fliwright-vscode/src/tddloop/TddLoopViewModel.ts`
- `packages/fliwright-vscode/src/tddloop/index.ts`
- `packages/fliwright-vscode/src/testing/ProjectRunsRoot.ts`
- `packages/fliwright-vscode/src/testing/RunArtifactStore.ts`
- `packages/fliwright-vscode/src/testing/TestStatusStore.ts`
- `packages/fliwright-vscode/src/testing/TestTreeBuilder.ts`
- `packages/fliwright-vscode/src/testing/relPath.ts`
- `packages/fliwright-vscode/src/testing/types.ts`
- `packages/fliwright-vscode/src/types.ts`
- `packages/fliwright-vscode/src/viewer/ViewerPanel.ts`
- `packages/fliwright-vscode/src/viewer/timelineConstants.ts`
- `packages/fliwright-vscode/src/views/DevicesTreeProvider.ts`
- `packages/fliwright-vscode/src/views/FlowsTreeProvider.ts`
- `packages/fliwright-vscode/src/views/FormDataTreeProvider.ts`
- `packages/fliwright-vscode/src/views/MockApiTreeProvider.ts`
- `packages/fliwright-vscode/src/views/ScriptsTreeProvider.ts`
- `packages/fliwright-vscode/src/views/StateTreeProvider.ts`
- `packages/fliwright-vscode/src/views/TestsTreeProvider.ts`
- `packages/fliwright-vscode/src/webview/FailurePanel.ts`
- `packages/fliwright-vscode/src/webview/RecordingPanel.ts`
- `packages/fliwright-vscode/src/webview/components/ui/badge.tsx`
- `packages/fliwright-vscode/src/webview/components/ui/button.tsx`
- `packages/fliwright-vscode/src/webview/components/ui/input.tsx`
- `packages/fliwright-vscode/src/webview/components/ui/resizable.tsx`
- `packages/fliwright-vscode/src/webview/components/ui/scroll-area.tsx`
- `packages/fliwright-vscode/src/webview/components/ui/separator.tsx`
- `packages/fliwright-vscode/src/webview/components/ui/tabs.tsx`
- `packages/fliwright-vscode/src/webview/components/ui/tooltip.tsx`
- `packages/fliwright-vscode/src/webview/lib/utils.ts`
- `packages/fliwright-vscode/src/webview/recording-canvas/app.tsx`
- `packages/fliwright-vscode/src/webview/recording-canvas/assets.d.ts`
- `packages/fliwright-vscode/src/webview/recording-canvas/marker-utils.ts`
- `packages/fliwright-vscode/src/webview/recording-canvas/types.ts`
- `packages/fliwright-vscode/src/webview/viewer/app.tsx`
- `packages/fliwright-vscode/src/webview/viewer/artifacts.ts`
- `packages/fliwright-vscode/src/webview/viewer/assets.d.ts`
- `packages/fliwright-vscode/src/webview/viewer/components/DetailTabs.tsx`
- `packages/fliwright-vscode/src/webview/viewer/components/DetailsTab.tsx`
- `packages/fliwright-vscode/src/webview/viewer/components/ErrorTab.tsx`
- `packages/fliwright-vscode/src/webview/viewer/components/JsonTree.tsx`
- `packages/fliwright-vscode/src/webview/viewer/components/LogsTab.tsx`
- `packages/fliwright-vscode/src/webview/viewer/components/RunStatusBar.tsx`
- `packages/fliwright-vscode/src/webview/viewer/components/StepsPane.tsx`
- `packages/fliwright-vscode/src/webview/viewer/components/Viewport.tsx`
- `packages/fliwright-vscode/src/webview/viewer/components/WidgetTreeTab.tsx`
- `packages/fliwright-vscode/src/webview/viewer/fitScale.ts`
- `packages/fliwright-vscode/src/webview/viewer/format.ts`
- `packages/fliwright-vscode/src/webview/viewer/host.ts`
- `packages/fliwright-vscode/src/webview/viewer/treeFlatten.ts`
- `packages/fliwright-vscode/src/webview/viewer/types.ts`
