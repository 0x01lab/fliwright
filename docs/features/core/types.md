---
module: "types"
package: "@fliwright/core"
source: "src/types.ts"
generated: "2026-06-02"
---

# Types & Interfaces

## Type Aliases

### `SendRequest`
```typescript
type SendRequest = (method: string, params?: Record<string, unknown>) => Promise<unknown>;
```
Function signature for sending VM Service JSON-RPC requests.

### `SelectorInput`
```typescript
type SelectorInput = string | { text: string; ancestor?: SelectorInput } | { key: string; ancestor?: SelectorInput } | { type: string; ancestor?: SelectorInput };
```
Selector specification — string or structured object with optional ancestor chain.

### `FormControlType`
```typescript
type FormControlType = 'textInput' | 'select' | 'radio' | 'checkbox';
```

### `SemanticType`
```typescript
type SemanticType = 'phone' | 'email' | 'idCard' | 'fullName' | 'address' | 'password' | 'captcha' | 'number' | 'text' | 'url' | 'date' | 'boolean' | 'option';
```

## Interfaces

### `ProviderInfo`
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | Yes | Provider name |
| `type` | `string` | Yes | Provider type |
| `value` | `unknown` | Yes | Current value |

### `WidgetInfo`
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | Widget ID |
| `type` | `string` | Yes | Widget type name |
| `text` | `string` | No | Visible text |
| `key` | `string` | No | Flutter Key |
| `rect` | `{ x, y, width, height }` | Yes | Render bounds |
| `properties` | `Record<string, unknown>` | Yes | Additional properties |

### `WidgetSnapshot`
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `string` | Yes | Widget type |
| `text` | `string` | No | Visible text |
| `key` | `string` | No | Flutter Key |
| `parentType` | `string` | Yes | Parent widget type |
| `adjacentText` | `string[]` | Yes | Adjacent sibling text |
| `rect` | `{ x, y, width, height }` | Yes | Render bounds |
| `callbackNames` | `string[]` | Yes | Callback handler names |
| `description` | `string` | No | Semantics description |
| `firstSeen` | `string` | No | ISO timestamp |

### `HealingResult`
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `originalSelector` | `string` | Yes | Original broken selector |
| `suggestedSelector` | `string` | Yes | Healed replacement selector |
| `confidence` | `number` | Yes | Match confidence (0-1) |
| `matchedWidget` | `WidgetInfo` | Yes | The matched widget |

### `HealingReport`
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `testName` | `string` | Yes | Test that triggered healing |
| `originalSelector` | `string` | Yes | Broken selector |
| `suggestedSelector` | `string` | Yes | Replacement selector |
| `confidence` | `number` | Yes | Match score |
| `scores` | `{ position, context, codeBinding, text, weighted }` | Yes | Per-dimension scores |
| `originalSnapshot` | `WidgetSnapshot` | Yes | Stored snapshot |
| `matchedWidget` | `WidgetInfo` | Yes | Matched widget |
| `timestamp` | `string` | Yes | ISO timestamp |

### `MockRouteConfig`
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | No | Route ID |
| `method` | `string` | No | HTTP method |
| `path` | `string` | Yes | URL path pattern |
| `response` | `MockRouteResponse` | Yes | Mock response |

### `MockResponse` / `MockRouteResponse`
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `status` | `number` | No | HTTP status code |
| `headers` | `Record<string, string>` | No | Response headers |
| `body` | `unknown` | No | Response body |
| `delay` | `number` | No | Simulated delay (ms) |

### `MockCall`
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `method` | `string` | Yes | HTTP method |
| `path` | `string` | Yes | Request path |
| `headers` | `Record<string, string>` | Yes | Request headers |
| `body` | `string` | Yes | Request body |
| `timestamp` | `string` | Yes | ISO timestamp |

### `FailureContext`
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `assertion` | `{ matcher, expected, actual, timeout }` | Yes | Assertion details |
| `screenshot` | `Buffer \| null` | Yes | Screenshot data |
| `widgetTree` | `object` | Yes | Widget tree dump |
| `source` | `{ file, line, snippet }` | Yes | Source location |
| `timestamp` | `string` | Yes | ISO timestamp |

### `RawInputEvent`
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `'pointerEvent' \| 'textInput'` | Yes | Event type |
| `kind` | `'down' \| 'move' \| 'up'` | No | Pointer event kind |
| `pointer` | `number` | No | Pointer ID |
| `position` | `{ x, y }` | No | Screen position |
| `timestamp` | `number` | Yes | Event timestamp |
| `buttons` | `number` | No | Button flags |
| `text` | `string` | No | Text input content |
| `action` | `'replace'` | No | Replace existing text |

### `RecordedOperation`
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `kind` | `'tap' \| 'longPress' \| 'drag' \| 'type'` | Yes | Operation type |
| `position` | `{ x, y }` | Yes | Screen position |
| `delta` | `{ x, y }` | No | Drag delta |
| `text` | `string` | No | Typed text |
| `action` | `'replace'` | No | Replace flag |
| `duration` | `number` | No | Long press duration |
| `timestamp` | `number` | Yes | Operation timestamp |

### `CodegenOptions`
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `testName` | `string` | No | Test name for generated code |
| `imports` | `string` | No | Import source |
| `lang` | `'ts' \| 'dart'` | No | Output language |

### `FormFieldMeta`
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | Field identifier |
| `type` | `string` | Yes | Flutter widget type |
| `controlType` | `FormControlType` | No | Input control type |
| `rect` | `{ x, y, width, height }` | Yes | Render bounds |
| `key` | `string` | No | Flutter Key |
| `ancestorKey` | `string` | No | Ancestor widget Key |
| `name` | `string` | No | Field name |
| `semanticsId` | `string` | No | Semantics node ID |
| `semanticsLabel` | `string` | No | Semantics label |
| `semanticsHint` | `string` | No | Semantics hint |
| `role` | `string` | No | ARIA-like role |
| `hintText` | `string` | No | Input hint text |
| `label` | `string` | No | Label text |
| `keyboardType` | `string` | No | Keyboard type hint |
| `maxLength` | `number` | No | Max input length |
| `obscureText` | `boolean` | Yes | Whether obscured |
| `enabled` | `boolean` | Yes | Whether interactive |
| `value` | `unknown` | No | Current value |
| `options` | `FormFieldOption[]` | No | Selectable options |
| `selector` | `string` | Yes | Wire-format selector |

### `FormFillResult`
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `filled` | `number` | Yes | Count of filled fields |
| `skipped` | `number` | Yes | Count of skipped fields |
| `errors` | `Array<{ fieldId, error }>` | Yes | Error details |
| `fields` | `Array<FieldResult>` | Yes | Per-field results |

### `FormSkill`
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | Yes | Skill name |
| `type` | `'PRESET_SKILL' \| 'REGEXP_MOCK' \| 'LLM_GENERATE'` | Yes | Skill type |
| `match` | `(field: FormFieldMeta) => boolean` | Yes | Match predicate |
| `generate` | `(field: FormFieldMeta, locale: string) => string` | Yes | Value generator |

### `FormRule`
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `match` | `Record<string, string>` | Yes | Field attribute patterns |
| `type` | `'PRESET_SKILL' \| 'REGEXP_MOCK' \| 'LLM_GENERATE'` | Yes | Rule type |
| `data` | `string[]` | No | Preset values |
| `pattern` | `string` | No | Regex pattern for REGEXP_MOCK |

### `MockRule`
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | Yes | Rule name |
| `status` | `number` | Yes | HTTP status |
| `delay` | `number` | No | Simulated delay |
| `headers` | `Record<string, string>` | No | Response headers |
| `body` | `unknown` | No | Response body |

### `MockEndpointConfig`
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | `number` | Yes | Config version |
| `name` | `string` | Yes | Endpoint name |
| `description` | `string` | No | Description |
| `method` | `string` | Yes | HTTP method |
| `endpoint` | `string` | Yes | URL path |
| `rules` | `MockRule[]` | Yes | Named rules |

### `MockIndex`
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | `number` | Yes | Index version |
| `defaultRule` | `string` | Yes | Default active rule |
| `files` | `string[]` | Yes | Config file paths |

### `StrategyWeights`
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `position` | `number` | 0.20 | Position dimension weight |
| `context` | `number` | 0.30 | Context dimension weight |
| `codeBinding` | `number` | 0.15 | Code binding dimension weight |
| `text` | `number` | 0.35 | Text similarity weight |

## Interface Types (from interfaces/*.ts)

### `FliwrightPlugin`
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | Yes | Plugin identifier |
| `onInit` | `(context: PluginContext) => Promise<void>` | No | Initialization hook |
| `onTestStart` | `(testName: string) => Promise<void>` | No | Test start hook |
| `onTestEnd` | `(testName, result: TestResult) => Promise<void>` | No | Test end hook |
| `onDispose` | `() => Promise<void>` | No | Cleanup hook |

### `StateAdapter`
| Method | Signature | Description |
|--------|-----------|-------------|
| `read` | `(key: string) => Promise<unknown>` | Read provider state |
| `write` | `(key, value) => Promise<void>` | Write provider state |
| `watch` | `(key, callback) => Promise<() => void>` | Watch for changes |
| `listProviders` | `() => Promise<ProviderInfo[]>` | List all providers |
| `override` | `(key, value) => Promise<void>` | Override provider value |

### `MockAdapter`
| Method | Signature | Description |
|--------|-----------|-------------|
| `addRoute` | `(pattern, handler) => Promise<void>` | Add mock route |
| `removeRoute` | `(pattern, method?) => Promise<void>` | Remove mock route |
| `clear` | `() => Promise<void>` | Clear all routes |

### `FinderStrategy`
| Method/Field | Signature | Description |
|--------------|-----------|-------------|
| `strategyName` | `string` | Strategy identifier |
| `find` | `(query: string) => Promise<WidgetMatch[]>` | Find widgets |
| `describe` | `(widget: WidgetInfo) => string` | Describe widget |

### `HealingStrategy`
| Method/Field | Signature | Description |
|--------------|-----------|-------------|
| `strategyName` | `string` | Strategy identifier |
| `score` | `(original, candidate) => number` | Score similarity |
| `heal` | `(original, candidates, threshold?) => HealingResult \| null` | Find best match |
