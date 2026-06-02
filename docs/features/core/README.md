---
package: "@fliwright/core"
version: "0.1.0"
layer: core
status: implemented
generated: "2026-06-02"
---

# @fliwright/core

> The shared SDK that powers Fliwright — driver, page-object model, locator, assertions, mocks, self-healing, recording, form auto-fill, and plugin registry.

## Modules

| Module | Description | Doc |
|--------|-------------|-----|
| `FliwrightDriver` | Top-level orchestrator that connects to a Flutter VM Service and exposes every subsystem | [FliwrightDriver.md](./FliwrightDriver.md) |
| `Page` | Page-object entry — creates locators, waits for widgets, navigates, exposes FormHelper | [Page.md](./Page.md) |
| `Locator` | Widget locator with click / longPress / drag / pinch / type / fill / scrollIntoView / count / isVisible | [Locator.md](./Locator.md) |
| `Selector` | Selector parser — supports `text=`, `key=`, `byType=` and ancestor chains | [Selector.md](./Selector.md) |
| `Assertion` | Auto-waiting, healing-aware assertion wrapper plus `AssertionError` and `createExpect` | [Assertion.md](./Assertion.md) |
| `MockManager` | Mock route registration / removal / passthrough / call inspection | [MockManager.md](./MockManager.md) |
| `MockRuleStore` | In-memory store of mock endpoint rules loaded from `.fliwright/mocks/*.json` | [MockRuleStore.md](./MockRuleStore.md) |
| `SelfHealingEngine` | Records successful locators, retries with multi-dimensional scoring on failure | [SelfHealingEngine.md](./SelfHealingEngine.md) |
| `SnapshotStore` | Disk-backed key/value store for baseline widget snapshots | [SnapshotStore.md](./SnapshotStore.md) |
| `MultiDimensionalHealingStrategy` | Weighted position/context/codeBinding/text scoring + `ngramSimilarity` | [MultiDimensionalHealingStrategy.md](./MultiDimensionalHealingStrategy.md) |
| `RecorderController` | Start/stop recording, aggregate events, resolve selectors, emit code | [RecorderController.md](./RecorderController.md) |
| `EventAggregator` | Raw pointer + text events → semantic tap/longPress/drag/type operations | [EventAggregator.md](./EventAggregator.md) |
| `CodeGenerator` | TypeScript/Vitest codegen for recorded operations | [CodeGenerator.md](./CodeGenerator.md) |
| `DartCodeGenerator` | Dart `integration_test` codegen for recorded operations | [DartCodeGenerator.md](./DartCodeGenerator.md) |
| `AssertionSuggester` | Heuristics that propose follow-up `expect()` calls after recorded ops | [AssertionSuggester.md](./AssertionSuggester.md) |
| `FailureCollector` | Collects screenshot + widget tree + source context for a failed assertion | [FailureCollector.md](./FailureCollector.md) |
| `FormHelper` | Discover, analyze, and auto-fill form fields | [FormHelper.md](./FormHelper.md) |
| `SemanticInferrer` | Regex/keyboard-type → semantic field type | [SemanticInferrer.md](./SemanticInferrer.md) |
| `FakerGenerator` | Localized, length-bounded Faker-backed value generation | [FakerGenerator.md](./FakerGenerator.md) |
| `SkillRegistry` | Custom rule registration and matching | [SkillRegistry.md](./SkillRegistry.md) |
| `JsonRuleLoader` | Loads `.fliwright/form-rules.json` and directory scans for rule files | [JsonRuleLoader.md](./JsonRuleLoader.md) |
| `SelectorResolver` | Converts a matched `WidgetInfo` into a stable selector | [SelectorResolver.md](./SelectorResolver.md) |
| `PluginRegistry` | Plugin lifecycle hooks and adapter lookup | [PluginRegistry.md](./PluginRegistry.md) |
| `Protocol` | JSON-RPC 2.0 message encoder/decoder | [Protocol.md](./Protocol.md) |
| `VMServiceConnector` | WebSocket client to the Dart VM Service with isolate management | [VMServiceConnector.md](./VMServiceConnector.md) |
| `types` | All exported type aliases and interfaces | [types.md](./types.md) |

## Dependencies

- `@faker-js/faker` ^10.4
- `randexp` ^0.5.3
- `ws` ^8.17
- `typedoc` (dev only)

## Usage Example

```typescript
import { FliwrightDriver, createExpect } from '@fliwright/core';

const driver = new FliwrightDriver();
await driver.connect('ws://127.0.0.1:54321/abc=');

const page = driver.page;
const loginButton = page.locator({ text: 'Login' });
await loginButton.click();

const title = page.locator({ key: 'home-title' });
const expect = createExpect(title, { healing: driver.healing, testName: 'login' });
await expect.toBeVisible();

// Auto-fill forms
const result = await page.formHelper.fill({ locale: 'zh_CN' });
console.log(`Filled ${result.filled} fields`);

// Mock an HTTP endpoint
await driver.mock.route('/v1/login', { status: 200, body: { token: 'test' } });

await driver.dispose();
```
