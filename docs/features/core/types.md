---
module: "types"
package: "@fliwright/core"
source: "src/types.ts"
generated: "2026-06-02"
---

# Types & Interfaces

All public types and interfaces exported from `@fliwright/core`'s `types.ts` and `interfaces/*.ts`.

## Type Aliases

### `SendRequest`
```typescript
type SendRequest = (method: string, params?: Record<string, unknown>) => Promise<unknown>;
```
Standard RPC channel signature used throughout the codebase.

### `SelectorInput`
```typescript
type SelectorInput =
  | string
  | { text: string; ancestor?: SelectorInput }
  | { key: string; ancestor?: SelectorInput }
  | { type: string; ancestor?: SelectorInput };
```
Input accepted by `Page.locator(...)` and `Locator`'s constructor.

### `SemanticType`
```typescript
type SemanticType =
  | 'phone' | 'email' | 'idCard' | 'fullName' | 'address'
  | 'password' | 'captcha' | 'number' | 'text' | 'url' | 'date';
```
Result of `SemanticInferrer.infer(field)`.

## Interfaces

### `WidgetInfo`
| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Bridge-assigned widget id |
| `type` | string | Widget runtime type (e.g. `ElevatedButton`) |
| `text` | string? | Visible text |
| `key` | string? | Value key |
| `rect` | `{x,y,width,height}` | Render bounds in px |
| `properties` | `Record<string, unknown>` | Catch-all bag |

### `WidgetSnapshot`
| Field | Type | Description |
|-------|------|-------------|
| `type` | string | Widget runtime type |
| `text`, `key` | string? | Identifiers |
| `parentType` | string | Immediate parent's runtime type |
| `adjacentText` | string[] | Sibling widget text labels |
| `rect` | `{x,y,width,height}` | Render bounds |
| `callbackNames` | string[] | Names of bound callbacks (healing code-binding signal) |
| `description` | string? | Human-readable description (healing text signal) |
| `firstSeen` | string? | ISO timestamp |

### `HealingResult`
| Field | Type | Description |
|-------|------|-------------|
| `originalSelector` | string | Original (failed) selector |
| `suggestedSelector` | string | New selector to use |
| `confidence` | number | Score 0..1 |
| `matchedWidget` | `WidgetInfo` | Best candidate widget |

### `HealingReport`
| Field | Type | Description |
|-------|------|-------------|
| `testName` | string | Test that triggered the heal |
| `originalSelector`, `suggestedSelector` | string | Selectors |
| `confidence` | number | Best-candidate score |
| `scores` | `{ position, context, codeBinding, text, weighted }` | Per-dimension breakdown |
| `originalSnapshot` | `WidgetSnapshot` | Baseline snapshot |
| `matchedWidget` | `WidgetInfo` | Live match |
| `timestamp` | string | ISO |

### `MockResponse`, `MockRouteResponse`
| Field | Type | Description |
|-------|------|-------------|
| `status?` | number | HTTP status |
| `headers?` | `Record<string, string>` | Response headers |
| `body?` | unknown | Body |
| `delay?` | number | Optional response delay (ms) |

### `MockRouteConfig`
| Field | Type | Description |
|-------|------|-------------|
| `id?`, `method?` | string | Method filter / route id |
| `path` | string | URL path |
| `response` | `MockRouteResponse` | Canned response |

### `MockCall`
| Field | Type | Description |
|-------|------|-------------|
| `method`, `path` | string | Request line |
| `headers` | `Record<string, string>` | Request headers |
| `body` | string | Request body |
| `timestamp` | string | ISO |

### `MockRule`, `MockEndpointConfig`, `MockIndex`, `MockRuleEntry`
See [MockRuleStore](./MockRuleStore.md) — these describe the `.fliwright/mocks/` file format.

### `RawInputEvent`
| Field | Type | Description |
|-------|------|-------------|
| `type` | `'pointerEvent' \| 'textInput'` | Event source |
| `kind?` | `'down' \| 'move' \| 'up'` | For pointer events |
| `pointer?` | number | Pointer id |
| `position?` | `{x, y}` | Pointer position |
| `timestamp` | number | ms since epoch |
| `text?`, `action?` | string, `'replace'?` | For text events |

### `RecordedOperation`
| Field | Type | Description |
|-------|------|-------------|
| `kind` | `'tap' \| 'longPress' \| 'drag' \| 'type'` | Aggregated op |
| `position` | `{x, y}` | Location |
| `delta?` | `{x, y}` | For drag |
| `text?`, `action?` | string, `'replace'?` | For type |
| `duration?` | number | For longPress |
| `timestamp` | number | ms since epoch |

### `CodegenOptions`
| Field | Type | Description |
|-------|------|-------------|
| `testName?` | string | Test name (default `'recorded test'`) |
| `imports?` | string | TS import source (default `@fliwright/vitest`) |
| `lang?` | `'ts' \| 'dart'` | Output language |

### `FormFieldMeta`
| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Stable per-field id |
| `type` | string | Widget runtime type |
| `rect` | `{x,y,width,height}` | Render bounds |
| `key?`, `ancestorKey?`, `name?` | string? | Identifiers |
| `semanticsId?`, `semanticsLabel?`, `semanticsHint?` | string? | Semantics node info |
| `role?` | string? | ARIA-style role |
| `hintText?`, `label?`, `keyboardType?` | string? | Input hints |
| `maxLength?` | number? | Max input length |
| `obscureText`, `enabled` | boolean | Field state |
| `selector` | string | Wire-format selector |

### `FormFillResult`, `FormAnalyzeResult`, `FormHelperOptions`, `FormSkill`, `FormRule`, `FormRulesFile`
See [FormHelper](./FormHelper.md), [JsonRuleLoader](./JsonRuleLoader.md).

### `FailureContext`
| Field | Type | Description |
|-------|------|-------------|
| `assertion` | `{ matcher, expected, actual, timeout }` | What failed |
| `screenshot` | `Buffer \| null` | Captured screenshot |
| `widgetTree` | object | Live tree |
| `source` | `{ file, line, snippet }` | Stack-trace origin |
| `timestamp` | string | ISO |

### `ProtocolMessage`
| Field | Type | Description |
|-------|------|-------------|
| `jsonrpc` | `'2.0'` | — |
| `id?` | string | Correlation id |
| `method` | string | RPC method |
| `params?`, `result?` | unknown | Payload |
| `error?` | `{ code, message, data? }` | Error |

### `VMServiceEvent`
| Field | Type | Description |
|-------|------|-------------|
| `kind` | string | Event kind (e.g. `'FliwrightRecording'`, `'riverpod.stateChanged'`) |
| `timestamp` | number | ms since epoch |
| `data` | `Record<string, unknown>` | Event payload |

### `ProviderInfo`
| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Provider key |
| `type` | string | Provider type description |
| `value` | unknown | Current value |

### `WidgetMatch`, `TestResult`
Self-explanatory; see source.

## Interfaces from `src/interfaces/`

### `FliwrightPlugin`
| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Unique plugin name |
| `onInit?` | `(ctx: PluginContext) => Promise<void>` | Setup hook |
| `onTestStart?`, `onTestEnd?` | `(name, result?) => Promise<void>` | Per-test hooks |
| `onDispose?` | `() => Promise<void>` | Cleanup |

### `PluginContext`
| Field | Type | Description |
|-------|------|-------------|
| `sendRequest` | `SendRequest` | RPC channel |
| `registerStateAdapter` | `(name, adapter) => void` | — |
| `registerMockAdapter` | `(name, adapter) => void` | — |
| `registerFinderStrategy` | `(name, strategy) => void` | — |
| `registerHealingStrategy` | `(name, strategy) => void` | — |
| `onEvent` | `(cb) => () => void` | Subscribe to bridge events |

### `StateAdapter`
| Method | Returns | Description |
|--------|---------|-------------|
| `read(key)` | `Promise<unknown>` | Read current value |
| `write(key, value)` | `Promise<void>` | Override value |
| `watch(key, cb)` | `Promise<() => void>` | Subscribe |
| `listProviders?()` | `Promise<ProviderInfo[]>` | Optional introspection |

### `MockAdapter`, `FinderStrategy`, `HealingStrategy`
See source — minimal contracts for adapters/strategies that plugins can register.

## Related

- **Source:** `packages/fliwright-core/src/types.ts`, `packages/fliwright-core/src/interfaces/*.ts`
