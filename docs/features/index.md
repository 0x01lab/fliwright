---
purpose: "AI-agent-consumable feature index"
generated: "2026-06-01"
---

# Fliwright Feature Index

> Navigation table for AI agents. Start here to understand what is implemented and where to find details.

## By Package

| Package | Description | Overview | Detailed Docs |
|---------|-------------|----------|---------------|
| `@fliwright/core` | Core SDK — driver, page model, locators, assertions, healing, recording, mocking, forms | [core/README.md](./core/README.md) | FliwrightDriver, Page, Locator, Selector, Assertion, MockManager, SelfHealingEngine, SnapshotStore, RecorderController, CodeGenerator, DartCodeGenerator, AssertionSuggester, FormHelper, SemanticInferrer, FakerGenerator, SkillRegistry, JsonRuleLoader, SelectorResolver, PluginRegistry, Protocol, VMServiceConnector, EventAggregator, FailureCollector, MultiDimensionalHealingStrategy |
| `@fliwright/mcp` | MCP server — exposes Fliwright as tools for AI agents | [mcp/README.md](./mcp/README.md) | fliwright_run, fliwright_get_failure, fliwright_generate_test, fliwright_record, test_report |
| `@fliwright/vitest` | Vitest integration — test fixtures, expect, auto-driver lifecycle | [vitest/README.md](./vitest/README.md) | test, expect |
| `@fliwright/cli` | CLI — run tests, init project, doctor, record | [cli/README.md](./cli/README.md) | run, init, doctor, record |
| `@fliwright/plugin-riverpod` | Riverpod plugin — provider read/write/watch/override | [plugin-riverpod/README.md](./plugin-riverpod/README.md) | RiverpodStateAdapter |
| `fliwright-bridge` | Dart bridge — VM service extensions for Flutter | [bridge/README.md](./bridge/README.md) | 26 extension methods across 12 extension groups |

## By Class

| Class | Package | Description | Doc |
|-------|---------|-------------|-----|
| `FliwrightDriver` | core | Main orchestrator — connects to Flutter VM, manages lifecycle | [core/FliwrightDriver.md](./core/FliwrightDriver.md) |
| `Page` | core | Page object model — creates locators and waits for widgets | [core/Page.md](./core/Page.md) |
| `Locator` | core | Widget locator with gesture, typing, and query actions | [core/Locator.md](./core/Locator.md) |
| `Selector` | core | Selector parsing and wire-format serialization | [core/Selector.md](./core/Selector.md) |
| `Assertion` | core | Fluent assertion API with self-healing integration | [core/Assertion.md](./core/Assertion.md) |
| `AssertionError` | core | Error thrown on assertion failure | [core/Assertion.md](./core/Assertion.md) |
| `createExpect` | core | Assertion factory function | [core/Assertion.md](./core/Assertion.md) |
| `MockManager` | core | HTTP mock route management for API stubbing | [core/MockManager.md](./core/MockManager.md) |
| `SelfHealingEngine` | core | Self-healing engine that recovers from broken selectors | [core/SelfHealingEngine.md](./core/SelfHealingEngine.md) |
| `SnapshotStore` | core | Persistent file-based snapshot storage | [core/SnapshotStore.md](./core/SnapshotStore.md) |
| `RecorderController` | core | Controls interaction recording sessions | [core/RecorderController.md](./core/RecorderController.md) |
| `CodeGenerator` | core | Generates TypeScript/Vitest test code from recordings | [core/CodeGenerator.md](./core/CodeGenerator.md) |
| `DartCodeGenerator` | core | Generates Dart integration_test code from recordings | [core/DartCodeGenerator.md](./core/DartCodeGenerator.md) |
| `AssertionSuggester` | core | Suggests assertions based on recorded operations | [core/AssertionSuggester.md](./core/AssertionSuggester.md) |
| `FormHelper` | core | Auto-fills forms using semantic inference and Faker | [core/FormHelper.md](./core/FormHelper.md) |
| `SemanticInferrer` | core | Infers semantic types from form field metadata | [core/SemanticInferrer.md](./core/SemanticInferrer.md) |
| `FakerGenerator` | core | Generates realistic fake data for form fields | [core/FakerGenerator.md](./core/FakerGenerator.md) |
| `SkillRegistry` | core | Registry for custom form-filling skills | [core/SkillRegistry.md](./core/SkillRegistry.md) |
| `JsonRuleLoader` | core | Loads form-filling rules from JSON files | [core/JsonRuleLoader.md](./core/JsonRuleLoader.md) |
| `SelectorResolver` | core | Resolves widget info to selector strings with role mapping | [core/SelectorResolver.md](./core/SelectorResolver.md) |
| `resolveSelector` | core | Standalone function for selector resolution | [core/SelectorResolver.md](./core/SelectorResolver.md) |
| `PluginRegistry` | core | Plugin lifecycle management and adapter registry | [core/PluginRegistry.md](./core/PluginRegistry.md) |
| `Protocol` | core | JSON-RPC 2.0 protocol handler | [core/Protocol.md](./core/Protocol.md) |
| `VMServiceConnector` | core | WebSocket connection to Dart VM Service | [core/VMServiceConnector.md](./core/VMServiceConnector.md) |
| `EventAggregator` | core | Aggregates raw input events into semantic operations | [core/EventAggregator.md](./core/EventAggregator.md) |
| `FailureCollector` | core | Collects failure context (screenshot + widget tree + source) | [core/FailureCollector.md](./core/FailureCollector.md) |
| `MultiDimensionalHealingStrategy` | core | Multi-dimensional widget matching strategy | [core/MultiDimensionalHealingStrategy.md](./core/MultiDimensionalHealingStrategy.md) |
| `ngramSimilarity` | core | N-gram cosine similarity function | [core/MultiDimensionalHealingStrategy.md](./core/MultiDimensionalHealingStrategy.md) |
| `RiverpodStateAdapter` | plugin-riverpod | State adapter for Riverpod providers | [plugin-riverpod/RiverpodStateAdapter.md](./plugin-riverpod/RiverpodStateAdapter.md) |
| `riverpodPlugin` | plugin-riverpod | Plugin factory for Riverpod | [plugin-riverpod/README.md](./plugin-riverpod/README.md) |
| `FliwrightBridge` | bridge | Static bridge initializer | [bridge/README.md](./bridge/README.md) |
| `ExtensionRegistry` | bridge | Extension method registry | [bridge/README.md](./bridge/README.md) |

## By Feature Slice

| Feature | Packages | Doc | Agent-Accessible | Status |
|---------|----------|-----|------------------|--------|
| Self-Healing Pipeline | core, bridge | [self-healing-pipeline.md](./self-healing-pipeline.md) | via `fliwright_get_failure` | Implemented |
| Recording & Codegen Pipeline | core, bridge, mcp, cli | [recording-pipeline.md](./recording-pipeline.md) | via `fliwright_record` | Implemented |
| Form Auto-Fill Pipeline | core, bridge | [form-filling-pipeline.md](./form-filling-pipeline.md) | No direct MCP tool | Implemented |
| MCP Integration | mcp, vitest, core | [mcp-integration.md](./mcp-integration.md) | Yes — all MCP tools | Implemented |
| Gesture System | core (Locator), bridge (GestureExtension) | [core/Locator.md](./core/Locator.md) · [bridge/GestureExtension.md](./bridge/GestureExtension.md) | via test code | Implemented |
| Mock API System | core (MockManager), bridge (MockServerExtension) | [core/MockManager.md](./core/MockManager.md) · [bridge/MockServerExtension.md](./bridge/MockServerExtension.md) | via test code | Implemented |
| Riverpod State Management | plugin-riverpod, bridge (RiverpodExtension) | [plugin-riverpod/RiverpodStateAdapter.md](./plugin-riverpod/RiverpodStateAdapter.md) · [bridge/RiverpodExtension.md](./bridge/RiverpodExtension.md) | via `driver.state` | Implemented |

## MCP Tool Quick Reference

| Tool | Input | Output | Doc |
|------|-------|--------|-----|
| `fliwright_run` | `testFile`, `vmServiceUrl?`, `testName?`, `cwd?` | `RunResult` | [mcp/fliwright-run.md](./mcp/fliwright-run.md) |
| `fliwright_get_failure` | `testName?` | `GetFailureResult` (FailureEntry[]) | [mcp/fliwright-get-failure.md](./mcp/fliwright-get-failure.md) |
| `fliwright_generate_test` | `source`, `description?`, `testName?` | `GenerateTestResult` (testCode, testName) | [mcp/fliwright-generate-test.md](./mcp/fliwright-generate-test.md) |
| `fliwright_record` | `vmServiceUrl?`, `duration?`, `testName?`, `lang?` | `RecordResult` (testCode, testName, operationCount) | [mcp/fliwright-record.md](./mcp/fliwright-record.md) |

**Resource:** `fliwright://test-report/latest` — [mcp/test-report.md](./mcp/test-report.md)

## Quick Start for AI Agents

1. To **run tests**: Use `fliwright_run` with `testFile` path and `vmServiceUrl` (or set `FLIWRIGHT_VM_URL` env)
2. To **diagnose failures**: Use `fliwright_get_failure` to get widget tree, source location, and healing suggestions
3. To **generate tests**: Use `fliwright_generate_test` with Flutter source code to auto-generate test scripts
4. To **record interactions**: Use `fliwright_record` with a running Flutter app to capture user actions and generate test code
5. To **manipulate state**: Use `driver.state.read/write/override` via the Riverpod plugin (e.g., `riverpodPlugin()`)
6. To **mock APIs**: Use `driver.mock.route/addRoute` to stub HTTP responses in tests
7. To **auto-fill forms**: Use `page.formHelper.fill()` to extract, infer, and fill form fields with realistic data
