---
purpose: "AI-agent-consumable feature index"
generated: "2026-06-02"
---

# Fliwright Feature Index

> Navigation table for AI agents. Start here to understand what is implemented and where to find details.

## By Package

| Package | Description | Overview | Detailed Docs |
|---------|-------------|----------|---------------|
| `@fliwright/core` | Core SDK — driver, page, locator, assertions, mocks, healing, recording, form-fill, plugins | [core/README.md](./core/README.md) | FliwrightDriver, Page, Locator, Selector, Assertion, MockManager, MockRuleStore, SelfHealingEngine, SnapshotStore, MultiDimensionalHealingStrategy, RecorderController, EventAggregator, CodeGenerator, DartCodeGenerator, AssertionSuggester, FailureCollector, FormHelper, SemanticInferrer, FakerGenerator, SkillRegistry, JsonRuleLoader, SelectorResolver, PluginRegistry, Protocol, VMServiceConnector, types |
| `@fliwright/mcp` | MCP server exposing tools and resources to AI agents | [mcp/README.md](./mcp/README.md) | fliwright_run, fliwright_get_failure, fliwright_generate_test, fliwright_record, fliwright_mock_list, fliwright_mock_switch, test_report |
| `@fliwright/vitest` | Vitest integration — `test()` fixture, `expect()`, reporter, setup | [vitest/README.md](./vitest/README.md) | test, expect, setup, reporter |
| `@fliwright/cli` | `fliwright` CLI — run / init / doctor / record, config, vm-discovery, reporter | [cli/README.md](./cli/README.md) | run, init, doctor, record, config, vm-discovery, reporter |
| `@fliwright/plugin-riverpod` | Riverpod state-management plugin | [plugin-riverpod/README.md](./plugin-riverpod/README.md) | RiverpodStateAdapter, plugin |
| `@fliwright/ai-plugin` | `fliwright-ai-setup` installer for Claude Code skills & Codex AGENTS.md | [ai-plugin/README.md](./ai-plugin/README.md) | setup |
| `@fliwright/vscode` | VS Code extension — commands, views, CodeLens, webviews | [vscode/README.md](./vscode/README.md) | commands, views, session, sandbox, form, recording, runner, failure, state |
| `fliwright_bridge` | Dart bridge — VM Service extensions registered inside the Flutter app | [bridge/README.md](./bridge/README.md) | GestureExtension, InspectExtension, TypeExtension, ScrollExtension, SnapshotExtension, ScreenshotExtension, RecordingExtension, FormExtractExtension, RiverpodExtension, RouterNavigateExtension, MockServerExtension, DioMockExtension, HttpOverrides |

## By Class

| Class | Package | Description | Doc |
|-------|---------|-------------|-----|
| `FliwrightDriver` | core | Main orchestrator | [core/FliwrightDriver.md](./core/FliwrightDriver.md) |
| `Page` | core | Page object — locators, navigation, form helper | [core/Page.md](./core/Page.md) |
| `Locator` | core | Widget locator with gestures / typing | [core/Locator.md](./core/Locator.md) |
| `Selector` | core | Selector parser | [core/Selector.md](./core/Selector.md) |
| `Assertion` / `AssertionError` / `createExpect` | core | Auto-waiting assertions + self-healing | [core/Assertion.md](./core/Assertion.md) |
| `MockManager` | core | Mock route lifecycle | [core/MockManager.md](./core/MockManager.md) |
| `MockRuleStore` | core | In-memory store of `.fliwright/mocks/` rules | [core/MockRuleStore.md](./core/MockRuleStore.md) |
| `SelfHealingEngine` | core | Snapshot baseline + retry on failure | [core/SelfHealingEngine.md](./core/SelfHealingEngine.md) |
| `SnapshotStore` | core | Disk-backed snapshot persistence | [core/SnapshotStore.md](./core/SnapshotStore.md) |
| `MultiDimensionalHealingStrategy` / `ngramSimilarity` | core | Position+context+codeBinding+text scoring | [core/MultiDimensionalHealingStrategy.md](./core/MultiDimensionalHealingStrategy.md) |
| `RecorderController` | core | Recording lifecycle | [core/RecorderController.md](./core/RecorderController.md) |
| `EventAggregator` | core | Raw events → operations | [core/EventAggregator.md](./core/EventAggregator.md) |
| `CodeGenerator` | core | TypeScript codegen | [core/CodeGenerator.md](./core/CodeGenerator.md) |
| `DartCodeGenerator` | core | Dart `integration_test` codegen | [core/DartCodeGenerator.md](./core/DartCodeGenerator.md) |
| `AssertionSuggester` | core | Heuristic assertion suggestions | [core/AssertionSuggester.md](./core/AssertionSuggester.md) |
| `FailureCollector` | core | Screenshot + tree + source for failures | [core/FailureCollector.md](./core/FailureCollector.md) |
| `FormHelper` | core | Discover / analyze / fill forms | [core/FormHelper.md](./core/FormHelper.md) |
| `SemanticInferrer` | core | Field → semantic type | [core/SemanticInferrer.md](./core/SemanticInferrer.md) |
| `FakerGenerator` | core | Faker-backed value generation | [core/FakerGenerator.md](./core/FakerGenerator.md) |
| `SkillRegistry` | core | Custom rule registry | [core/SkillRegistry.md](./core/SkillRegistry.md) |
| `JsonRuleLoader` | core | `.fliwright/form-rules.json` loader | [core/JsonRuleLoader.md](./core/JsonRuleLoader.md) |
| `SelectorResolver` / `resolveSelector` | core | Widget → wire selector | [core/SelectorResolver.md](./core/SelectorResolver.md) |
| `PluginRegistry` | core | Plugin lifecycle + adapter lookup | [core/PluginRegistry.md](./core/PluginRegistry.md) |
| `Protocol` | core | JSON-RPC 2.0 encoder/decoder | [core/Protocol.md](./core/Protocol.md) |
| `VMServiceConnector` | core | WebSocket client with isolate discovery | [core/VMServiceConnector.md](./core/VMServiceConnector.md) |
| `RiverpodStateAdapter` | plugin-riverpod | Riverpod `StateAdapter` | [plugin-riverpod/RiverpodStateAdapter.md](./plugin-riverpod/RiverpodStateAdapter.md) |
| `riverpodPlugin` | plugin-riverpod | Plugin factory | [plugin-riverpod/plugin.md](./plugin-riverpod/plugin.md) |

## By Feature Slice

| Feature | Packages | Doc | Agent-Accessible | Status |
|---------|----------|-----|------------------|--------|
| Self-Healing Pipeline | core, bridge | [self-healing-pipeline.md](./self-healing-pipeline.md) | via `fliwright_get_failure` MCP tool | Implemented |
| Recording & Codegen Pipeline | core, bridge, mcp, vscode | [recording-pipeline.md](./recording-pipeline.md) | via `fliwright_record` MCP tool + VS Code commands | Implemented |
| Form Auto-Fill Pipeline | core, bridge, vscode | [form-filling-pipeline.md](./form-filling-pipeline.md) | via VS Code commands (no MCP tool) | Implemented |
| MCP Agent Integration | mcp, vitest, core | [mcp-integration.md](./mcp-integration.md) | Yes — `fliwright_run`, `fliwright_get_failure`, `fliwright_generate_test`, `fliwright_record`, `fliwright_mock_list`, `fliwright_mock_switch`, `test_report` resource | Implemented |

## MCP Tool Quick Reference

| Tool | Input | Output | Doc |
|------|-------|--------|-----|
| `fliwright_run` | `testFile`, `vmServiceUrl?`, `testName?`, `cwd?` | `RunResult` | [mcp/fliwright-run.md](./mcp/fliwright-run.md) |
| `fliwright_get_failure` | `testName?` | `{ failures: FailureEntry[] }` | [mcp/fliwright-get-failure.md](./mcp/fliwright-get-failure.md) |
| `fliwright_generate_test` | `source`, `description?`, `testName?` | `{ testName, testCode, widgets }` | [mcp/fliwright-generate-test.md](./mcp/fliwright-generate-test.md) |
| `fliwright_record` | `vmServiceUrl?`, `duration?`, `testName?`, `lang?` | `{ testCode, testName, operationCount }` | [mcp/fliwright-record.md](./mcp/fliwright-record.md) |
| `fliwright_mock_list` | (none) | `{ endpoints: [...] }` | [mcp/fliwright-mock-list.md](./mcp/fliwright-mock-list.md) |
| `fliwright_mock_switch` | `endpoint`, `ruleName`, `mockDir?` | `{ endpoint, activeRule }` | [mcp/fliwright-mock-switch.md](./mcp/fliwright-mock-switch.md) |
| Resource: `test_report` | URI `fliwright://test-report/latest` | JSON `RunResult` | [mcp/test-report.md](./mcp/test-report.md) |

## Quick Start for AI Agents

1. **Run tests**: `fliwright_run` (MCP) or `npx fliwright run` (CLI). Pass `vmServiceUrl` or set `FLIWRIGHT_VM_URL`.
2. **Diagnose failures**: After a run, call `fliwright_get_failure` to get widget tree, source, and the latest healing report (with suggested selector + per-dimension scores).
3. **Generate tests**: `fliwright_generate_test` accepts Flutter source and synthesizes a Vitest test that clicks buttons, types into fields, and asserts visibility.
4. **Record interactions**: `fliwright_record` captures `duration` seconds of user input from the running app and returns generated code (`lang: 'ts' | 'dart'`).
5. **Manipulate state**: Use the Riverpod plugin — `driver.state.read('provider')`, `.write`, `.watch`. Or from VS Code, use `Fliwright: Read/Override State Provider`.
6. **Switch mocks**: `fliwright_mock_list` to see loaded endpoints, `fliwright_mock_switch` to flip a rule. Or use VS Code's Mock APIs tree view.
7. **Author tests by demonstration**: In VS Code, `Fliwright: Start Recording` → interact with the app → `Stop Recording` → `Insert Recorded Test` at the cursor.
