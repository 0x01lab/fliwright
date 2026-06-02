---
purpose: "AI-agent-consumable feature index"
generated: "2026-06-02"
---

# Fliwright Feature Index

> Navigation table for AI agents. Start here to understand what is implemented and where to find details.

## By Package

| Package | Description | Overview | Detailed Docs |
|---------|-------------|----------|---------------|
| `@fliwright/core` | Core SDK — driver, page model, locator, assertions, healing, mock, recording, form fill | [core/README.md](./core/README.md) | FliwrightDriver, Page, Locator, Selector, Assertion, MockManager, MockRuleStore, ToolMockServer, SelfHealingEngine, SnapshotStore, RecorderController, CodeGenerator, DartCodeGenerator, AssertionSuggester, FormHelper, SemanticInferrer, FakerGenerator, SkillRegistry, JsonRuleLoader, SelectorResolver, PluginRegistry, Protocol, VMServiceConnector, EventAggregator, FailureCollector, MultiDimensionalHealingStrategy, types |
| `@fliwright/mcp` | MCP Server — AI agent integration | [mcp/README.md](./mcp/README.md) | fliwright_run, fliwright_get_failure, fliwright_generate_test, fliwright_record, fliwright_mock_list, fliwright_mock_switch, test_report |
| `@fliwright/vitest` | Vitest integration — test fixture + expect | [vitest/README.md](./vitest/README.md) | test, expect |
| `@fliwright/cli` | CLI — run, init, doctor, record, mock:start | [cli/README.md](./cli/README.md) | run, init, doctor, record, mock:start |
| `@fliwright/plugin-riverpod` | Riverpod state management plugin | [plugin-riverpod/README.md](./plugin-riverpod/README.md) | RiverpodStateAdapter |
| `fliwright-bridge` | Dart bridge — Flutter VM Service extensions | [bridge/README.md](./bridge/README.md) | GestureExtension, InspectExtension, TypeExtension, ScrollExtension, SnapshotExtension, RecordingExtension, FormExtractExtension, RiverpodExtension, MockServerExtension, HttpOverrides, ScreenshotExtension, RouterNavigateExtension, DioMockExtension |

## By Class

| Class | Package | Description | Doc |
|-------|---------|-------------|-----|
| `FliwrightDriver` | core | Main orchestrator — VM connection, page/mock/healing/recorder access | [core/FliwrightDriver.md](./core/FliwrightDriver.md) |
| `Page` | core | Page object model — locators, waitFor, navigation, formHelper | [core/Page.md](./core/Page.md) |
| `Locator` | core | Widget locator with click, type, fill, drag, pinch, scroll actions | [core/Locator.md](./core/Locator.md) |
| `Selector` | core | Selector parsing — text=, key=, byType=, ancestor chains | [core/Selector.md](./core/Selector.md) |
| `Assertion` | core | Auto-wait polling assertions with .not negation and self-healing | [core/Assertion.md](./core/Assertion.md) |
| `MockManager` | core | Mock route management with local/remote modes and rule switching | [core/MockManager.md](./core/MockManager.md) |
| `MockRuleStore` | core | Loads and manages named mock rules from JSON config files | [core/MockRuleStore.md](./core/MockRuleStore.md) |
| `ToolMockServer` | core | Embedded HTTP mock server with admin API | [core/ToolMockServer.md](./core/ToolMockServer.md) |
| `SelfHealingEngine` | core | Records selector snapshots, heals broken selectors on failure | [core/SelfHealingEngine.md](./core/SelfHealingEngine.md) |
| `SnapshotStore` | core | Persists widget snapshots to .fliwright/snapshots/ | [core/SnapshotStore.md](./core/SnapshotStore.md) |
| `RecorderController` | core | Records user interactions and generates test code | [core/RecorderController.md](./core/RecorderController.md) |
| `CodeGenerator` | core | Generates TypeScript test code from recorded operations | [core/CodeGenerator.md](./core/CodeGenerator.md) |
| `DartCodeGenerator` | core | Generates Dart integration_test code from recorded operations | [core/DartCodeGenerator.md](./core/DartCodeGenerator.md) |
| `AssertionSuggester` | core | Suggests assertion placements after recording | [core/AssertionSuggester.md](./core/AssertionSuggester.md) |
| `FormHelper` | core | Auto-fills forms — extract, infer, generate, fill pipeline | [core/FormHelper.md](./core/FormHelper.md) |
| `SemanticInferrer` | core | Infers semantic types from field metadata | [core/SemanticInferrer.md](./core/SemanticInferrer.md) |
| `FakerGenerator` | core | Generates fake data by semantic type | [core/FakerGenerator.md](./core/FakerGenerator.md) |
| `SkillRegistry` | core | Registry for form-filling skills with pattern matching | [core/SkillRegistry.md](./core/SkillRegistry.md) |
| `JsonRuleLoader` | core | Loads form rules from JSON files | [core/JsonRuleLoader.md](./core/JsonRuleLoader.md) |
| `SelectorResolver` | core | Resolves WidgetInfo to selector strings with role mapping | [core/SelectorResolver.md](./core/SelectorResolver.md) |
| `PluginRegistry` | core | Plugin lifecycle management | [core/PluginRegistry.md](./core/PluginRegistry.md) |
| `Protocol` | core | JSON-RPC 2.0 message handling | [core/Protocol.md](./core/Protocol.md) |
| `VMServiceConnector` | core | WebSocket connection to Dart VM Service | [core/VMServiceConnector.md](./core/VMServiceConnector.md) |
| `EventAggregator` | core | Aggregates raw pointer/text events into operations | [core/EventAggregator.md](./core/EventAggregator.md) |
| `FailureCollector` | core | Collects screenshot + widget tree + source on failure | [core/FailureCollector.md](./core/FailureCollector.md) |
| `MultiDimensionalHealingStrategy` | core | Multi-dimensional selector healing algorithm | [core/MultiDimensionalHealingStrategy.md](./core/MultiDimensionalHealingStrategy.md) |
| `RiverpodStateAdapter` | plugin-riverpod | StateAdapter for Riverpod providers | [plugin-riverpod/RiverpodStateAdapter.md](./plugin-riverpod/RiverpodStateAdapter.md) |

## By Feature Slice

| Feature | Packages | Doc | Agent-Accessible | Status |
|---------|----------|-----|------------------|--------|
| Self-Healing Pipeline | core, bridge | [self-healing-pipeline.md](./self-healing-pipeline.md) | via MCP `fliwright_run` + `fliwright_get_failure` | Implemented |
| Recording & Code Generation | core, bridge | [recording-pipeline.md](./recording-pipeline.md) | via MCP `fliwright_record` | Implemented |
| Form Auto-Fill | core, bridge | [form-filling-pipeline.md](./form-filling-pipeline.md) | No (use `page.formHelper.fill()` in tests) | Implemented |
| MCP Integration | mcp, vitest, core | [mcp-integration.md](./mcp-integration.md) | Direct MCP tool access | Implemented |

## MCP Tool Quick Reference

| Tool | Input | Output | Doc |
|------|-------|--------|-----|
| `fliwright_run` | testFile, vmServiceUrl?, testName?, cwd? | RunResult | [mcp/fliwright-run.md](./mcp/fliwright-run.md) |
| `fliwright_get_failure` | testName? | GetFailureResult | [mcp/fliwright-get-failure.md](./mcp/fliwright-get-failure.md) |
| `fliwright_generate_test` | source, description?, testName? | GenerateTestResult | [mcp/fliwright-generate-test.md](./mcp/fliwright-generate-test.md) |
| `fliwright_record` | vmServiceUrl?, duration?, testName?, lang? | RecordResult | [mcp/fliwright-record.md](./mcp/fliwright-record.md) |
| `fliwright_mock_list` | — | Endpoint list | [mcp/fliwright-mock-list.md](./mcp/fliwright-mock-list.md) |
| `fliwright_mock_switch` | mockDir?, endpoint, ruleName | Confirmation | [mcp/fliwright-mock-switch.md](./mcp/fliwright-mock-switch.md) |

## Quick Start for AI Agents

1. To **run tests**: Use `fliwright_run` with `testFile` path. Requires a running Flutter app (pass `vmServiceUrl` or set `FLIWRIGHT_VM_URL`).
2. To **diagnose failures**: After `fliwright_run`, use `fliwright_get_failure` to get widget tree, source location, and self-healing suggestions.
3. To **generate tests**: Use `fliwright_generate_test` with Flutter source code to auto-generate a test file.
4. To **record interactions**: Use `fliwright_record` with a duration to capture user interactions and generate test code.
5. To **manipulate state**: Use `page.formHelper.fill()` in tests, or Riverpod plugin's `driver.state.read/write/override()`.
6. To **manage mocks**: Use `fliwright_mock_list` to see endpoints and `fliwright_mock_switch` to change active rules.
