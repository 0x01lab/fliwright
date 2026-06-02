---
package: "@fliwright/core"
version: "0.1.0"
layer: core
status: implemented
generated: "2026-06-02"
---

# @fliwright/core

> Core SDK for Fliwright — provides the driver, page model, locator, assertions, self-healing, mock management, form auto-fill, recording, and code generation.

## Modules

| Module | Description | Doc |
|--------|-------------|-----|
| `FliwrightDriver` | Main orchestrator — connects to Flutter VM, exposes page/mock/healing/recorder | [FliwrightDriver.md](./FliwrightDriver.md) |
| `Page` | Page object model — locators, waitFor, navigation, formHelper | [Page.md](./Page.md) |
| `Locator` | Widget locator with click, type, fill, drag, pinch, scroll actions | [Locator.md](./Locator.md) |
| `Selector` | Selector parsing — text=, key=, byType=, ancestor selectors | [Selector.md](./Selector.md) |
| `Assertion` | Auto-wait polling assertions with .not negation and self-healing | [Assertion.md](./Assertion.md) |
| `MockManager` | Mock route management — route, removeRoute, clear, rule switching | [MockManager.md](./MockManager.md) |
| `MockRuleStore` | Loads mock endpoint configs from .fliwright/mocks/ JSON files | [MockRuleStore.md](./MockRuleStore.md) |
| `ToolMockServer` | HTTP mock server for tool-side request interception | [ToolMockServer.md](./ToolMockServer.md) |
| `SelfHealingEngine` | Records successful selectors, tries healing on assertion failure | [SelfHealingEngine.md](./SelfHealingEngine.md) |
| `SnapshotStore` | Persists widget snapshots to .fliwright/snapshots/ | [SnapshotStore.md](./SnapshotStore.md) |
| `RecorderController` | Records user interactions and generates test code | [RecorderController.md](./RecorderController.md) |
| `CodeGenerator` | Generates TypeScript test code from recorded operations | [CodeGenerator.md](./CodeGenerator.md) |
| `DartCodeGenerator` | Generates Dart integration_test code from recorded operations | [DartCodeGenerator.md](./DartCodeGenerator.md) |
| `AssertionSuggester` | Suggests assertion placements after recording | [AssertionSuggester.md](./AssertionSuggester.md) |
| `FormHelper` | Auto-fills forms — extract, analyze, fill pipeline | [FormHelper.md](./FormHelper.md) |
| `SemanticInferrer` | Infers semantic types (phone, email, etc.) from field metadata | [SemanticInferrer.md](./SemanticInferrer.md) |
| `FakerGenerator` | Generates fake data by semantic type using @faker-js/faker | [FakerGenerator.md](./FakerGenerator.md) |
| `SkillRegistry` | Registry for form-filling skills with pattern matching | [SkillRegistry.md](./SkillRegistry.md) |
| `JsonRuleLoader` | Loads form rules from JSON files (PRESET_SKILL, REGEXP_MOCK, LLM_GENERATE) | [JsonRuleLoader.md](./JsonRuleLoader.md) |
| `SelectorResolver` | Resolves WidgetInfo to selector strings with role mapping | [SelectorResolver.md](./SelectorResolver.md) |
| `PluginRegistry` | Plugin lifecycle management — register, initAll, test hooks | [PluginRegistry.md](./PluginRegistry.md) |
| `Protocol` | JSON-RPC 2.0 message creation and response parsing | [Protocol.md](./Protocol.md) |
| `VMServiceConnector` | WebSocket connection to Dart VM Service | [VMServiceConnector.md](./VMServiceConnector.md) |
| `EventAggregator` | Aggregates raw pointer/text events into semantic operations | [EventAggregator.md](./EventAggregator.md) |
| `FailureCollector` | Collects screenshot + widget tree + source on assertion failure | [FailureCollector.md](./FailureCollector.md) |
| `MultiDimensionalHealingStrategy` | Heals broken selectors via position, context, codeBinding, text dimensions | [MultiDimensionalHealingStrategy.md](./MultiDimensionalHealingStrategy.md) |
| `types` | All exported types and interfaces | [types.md](./types.md) |

## Dependencies

- `@faker-js/faker` ^10.4.0 — fake data generation
- `randexp` ^0.5.3 — regex-based random string generation
- `ws` ^8.17.0 — WebSocket client for VM Service

## Usage Example

```typescript
import { FliwrightDriver, createExpect } from '@fliwright/core';

const driver = new FliwrightDriver();
await driver.connect('ws://127.0.0.1:8181/ws');

const page = driver.page;
const button = page.locator({ text: 'Submit' });
await button.click();

const result = page.locator('text=Success');
await createExpect(result).toBeVisible();

await driver.dispose();
```
