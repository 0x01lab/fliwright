---
package: "@fliwright/core"
version: "0.1.0"
layer: core
status: implemented
generated: "2026-06-01"
---

# @fliwright/core

> Core SDK for Fliwright — provides the driver, page model, locators, assertions, self-healing, recording, mock management, form auto-fill, and plugin system for Flutter test automation.

## Modules

| Module | Description | Doc |
|--------|-------------|-----|
| `FliwrightDriver` | Main orchestrator — connects to Flutter VM, manages lifecycle | [FliwrightDriver.md](./FliwrightDriver.md) |
| `Page` | Page object model — creates locators and waits for widgets | [Page.md](./Page.md) |
| `Locator` | Widget locator with gesture, typing, and query actions | [Locator.md](./Locator.md) |
| `Selector` | Selector parsing and wire-format serialization | [Selector.md](./Selector.md) |
| `Assertion` | Fluent assertion API with self-healing integration | [Assertion.md](./Assertion.md) |
| `MockManager` | HTTP mock route management for API stubbing | [MockManager.md](./MockManager.md) |
| `SelfHealingEngine` | Self-healing engine that recovers from broken selectors | [SelfHealingEngine.md](./SelfHealingEngine.md) |
| `SnapshotStore` | Persistent snapshot storage for widget states | [SnapshotStore.md](./SnapshotStore.md) |
| `RecorderController` | Controls interaction recording sessions | [RecorderController.md](./RecorderController.md) |
| `CodeGenerator` | Generates TypeScript/Vitest test code from recordings | [CodeGenerator.md](./CodeGenerator.md) |
| `DartCodeGenerator` | Generates Dart integration_test code from recordings | [DartCodeGenerator.md](./DartCodeGenerator.md) |
| `AssertionSuggester` | Suggests assertions based on recorded operations | [AssertionSuggester.md](./AssertionSuggester.md) |
| `FormHelper` | Auto-fills forms using semantic inference and Faker | [FormHelper.md](./FormHelper.md) |
| `SemanticInferrer` | Infers semantic types from form field metadata | [SemanticInferrer.md](./SemanticInferrer.md) |
| `FakerGenerator` | Generates realistic fake data for form fields | [FakerGenerator.md](./FakerGenerator.md) |
| `SkillRegistry` | Registry for custom form-filling skills | [SkillRegistry.md](./SkillRegistry.md) |
| `JsonRuleLoader` | Loads form-filling rules from JSON files | [JsonRuleLoader.md](./JsonRuleLoader.md) |
| `SelectorResolver` | Resolves widget info to selector strings with role mapping | [SelectorResolver.md](./SelectorResolver.md) |
| `PluginRegistry` | Plugin lifecycle management and adapter registry | [PluginRegistry.md](./PluginRegistry.md) |
| `Protocol` | JSON-RPC 2.0 protocol handler | [Protocol.md](./Protocol.md) |
| `VMServiceConnector` | WebSocket connection to Dart VM Service | [VMServiceConnector.md](./VMServiceConnector.md) |
| `EventAggregator` | Aggregates raw input events into semantic operations | [EventAggregator.md](./EventAggregator.md) |
| `FailureCollector` | Collects failure context (screenshot + widget tree + source) | [FailureCollector.md](./FailureCollector.md) |
| `MultiDimensionalHealingStrategy` | Multi-dimensional widget matching strategy | [MultiDimensionalHealingStrategy.md](./MultiDimensionalHealingStrategy.md) |
| `types` | All exported types and interfaces | [types.md](./types.md) |

## Dependencies

- `@faker-js/faker` — ^10.4.0
- `randexp` — ^0.5.3
- `ws` — ^8.17.0

## Usage Example

```typescript
import { FliwrightDriver } from '@fliwright/core';

const driver = new FliwrightDriver();
await driver.connect('ws://localhost:12345/ws');

const page = driver.page;
const button = page.locator({ text: 'Submit' });
await button.click();

await driver.dispose();
```
