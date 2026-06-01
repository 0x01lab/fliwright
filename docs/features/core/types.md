---
module: "types"
package: "@fliwright/core"
source: "src/types.ts, src/interfaces/*.ts"
generated: "2026-06-01"
---

# Types & Interfaces

## Core Types

### `SendRequest`
```typescript
type SendRequest = (method: string, params?: Record<string, unknown>) => Promise<unknown>;
```

### `SelectorInput`
```typescript
type SelectorInput =
  | string
  | { text: string; ancestor?: SelectorInput }
  | { key: string; ancestor?: SelectorInput }
  | { type: string; ancestor?: SelectorInput };
```

### `SemanticType`
```typescript
type SemanticType = 'phone' | 'email' | 'idCard' | 'fullName' | 'address' | 'password' | 'captcha' | 'number' | 'text' | 'url' | 'date';
```

## Widget Types

### `WidgetInfo`
| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Widget identifier |
| `type` | `string` | Widget type name |
| `text` | `string?` | Display text |
| `key` | `string?` | Value key |
| `rect` | `{ x, y, width, height }` | Bounding rectangle |
| `properties` | `Record<string, unknown>` | Additional properties |

### `WidgetSnapshot`
| Field | Type | Description |
|-------|------|-------------|
| `type` | `string` | Widget type |
| `text` | `string?` | Display text |
| `key` | `string?` | Value key |
| `parentType` | `string` | Parent widget type |
| `adjacentText` | `string[]` | Text of adjacent widgets |
| `rect` | `{ x, y, width, height }` | Bounding rectangle |
| `callbackNames` | `string[]` | Callback function names |
| `description` | `string?` | Semantics description |
| `firstSeen` | `string?` | First seen timestamp |

### `WidgetMatch`
| Field | Type | Description |
|-------|------|-------------|
| `widget` | `WidgetInfo` | Matched widget |
| `score` | `number` | Match score |

## Healing Types

### `HealingResult`
| Field | Type | Description |
|-------|------|-------------|
| `originalSelector` | `string` | Original broken selector |
| `suggestedSelector` | `string` | Healed selector |
| `confidence` | `number` | Match confidence |
| `matchedWidget` | `WidgetInfo` | Matched widget |

### `HealingReport`
| Field | Type | Description |
|-------|------|-------------|
| `testName` | `string` | Test name |
| `originalSelector` | `string` | Original selector |
| `suggestedSelector` | `string` | Healed selector |
| `confidence` | `number` | Confidence score |
| `scores` | `{ position, context, codeBinding, text, weighted }` | Per-dimension scores |
| `originalSnapshot` | `WidgetSnapshot` | Original snapshot |
| `matchedWidget` | `WidgetInfo` | Matched widget |
| `timestamp` | `string` | ISO timestamp |

## Mock Types

### `MockResponse` / `MockRouteResponse`
| Field | Type | Description |
|-------|------|-------------|
| `status` | `number?` | HTTP status code |
| `headers` | `Record<string, string>?` | Response headers |
| `body` | `unknown` | Response body |
| `delay` | `number?` | Delay in ms |

### `MockRouteConfig`
| Field | Type | Description |
|-------|------|-------------|
| `id` | `string?` | Route identifier |
| `method` | `string?` | HTTP method |
| `path` | `string` | URL path pattern |
| `response` | `MockRouteResponse` | Response configuration |

### `MockCall`
| Field | Type | Description |
|-------|------|-------------|
| `method` | `string` | HTTP method |
| `path` | `string` | Request path |
| `headers` | `Record<string, string>` | Request headers |
| `body` | `string` | Request body |
| `timestamp` | `string` | ISO timestamp |

## Form Types

### `FormFieldMeta`
| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Field identifier |
| `type` | `string` | Widget type |
| `rect` | `{ x, y, width, height }` | Bounding rectangle |
| `hintText` | `string?` | Hint/placeholder text |
| `label` | `string?` | Label text |
| `keyboardType` | `string?` | Flutter keyboard type |
| `maxLength` | `number?` | Max character length |
| `obscureText` | `boolean` | Whether obscured |
| `enabled` | `boolean` | Whether enabled |
| `selector` | `string` | Resolved selector |

### `FormFillResult`
| Field | Type | Description |
|-------|------|-------------|
| `filled` | `number` | Successfully filled count |
| `skipped` | `number` | Skipped count |
| `errors` | `{ fieldId, error }[]` | Error details |
| `fields` | `{ id, semanticType, generatedValue, selector, status }[]` | Per-field results |

### `FormAnalyzeResult`
| Field | Type | Description |
|-------|------|-------------|
| `fields` | `{ id, semanticType, generatedValue, selector, hintText?, label? }[]` | Analysis results |

### `FormHelperOptions`
| Field | Type | Description |
|-------|------|-------------|
| `rulesFile` | `string?` | JSON rules file path |
| `rulesDir` | `string?` | Rules directory path |
| `locale` | `string?` | Data generation locale |
| `skipObscureFields` | `boolean?` | Skip obscured fields |
| `scope` | `string?` | Scope selector |

### `FormSkill`
| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Skill name |
| `type` | `'PRESET_SKILL' \| 'REGEXP_MOCK' \| 'LLM_GENERATE'` | Skill type |
| `match` | `(field: FormFieldMeta) => boolean` | Match function |
| `generate` | `(field: FormFieldMeta, locale: string) => string` | Value generator |

### `FormRule`
| Field | Type | Description |
|-------|------|-------------|
| `match` | `Record<string, string>` | Match criteria |
| `type` | `'PRESET_SKILL' \| 'REGEXP_MOCK' \| 'LLM_GENERATE'` | Rule type |
| `data` | `string[]?` | Data for preset/regexp |
| `pattern` | `string?` | Pattern for regexp |

### `FormRulesFile`
| Field | Type | Description |
|-------|------|-------------|
| `version` | `number` | File format version |
| `locale` | `string?` | Default locale |
| `rules` | `FormRule[]` | Array of rules |

## Recording Types

### `RawInputEvent`
| Field | Type | Description |
|-------|------|-------------|
| `type` | `'pointerEvent' \| 'textInput'` | Event type |
| `kind` | `'down' \| 'move' \| 'up'?` | Pointer kind |
| `pointer` | `number?` | Pointer ID |
| `position` | `{ x, y }?` | Pointer position |
| `timestamp` | `number` | Event timestamp |
| `buttons` | `number?` | Button state |
| `text` | `string?` | Text input value |
| `action` | `'replace'?` | Text action |

### `RecordedOperation`
| Field | Type | Description |
|-------|------|-------------|
| `kind` | `'tap' \| 'longPress' \| 'drag' \| 'type'` | Operation type |
| `position` | `{ x, y }` | Screen position |
| `delta` | `{ x, y }?` | Drag delta |
| `text` | `string?` | Typed text |
| `action` | `'replace'?` | Text action |
| `duration` | `number?` | Gesture duration |
| `timestamp` | `number` | Operation timestamp |

### `CodegenOptions`
| Field | Type | Description |
|-------|------|-------------|
| `testName` | `string?` | Test name |
| `imports` | `string?` | Custom imports |
| `lang` | `'ts' \| 'dart'?` | Output language |

## Protocol Types

### `ProtocolMessage`
| Field | Type | Description |
|-------|------|-------------|
| `jsonrpc` | `'2.0'` | Protocol version |
| `id` | `string?` | Message ID |
| `method` | `string` | Method name |
| `params` | `Record<string, unknown>?` | Parameters |
| `result` | `unknown?` | Result |
| `error` | `{ code, message, data? }?` | Error |

### `VMServiceEvent`
| Field | Type | Description |
|-------|------|-------------|
| `kind` | `string` | Event kind |
| `timestamp` | `number` | Event timestamp |
| `data` | `Record<string, unknown>` | Event data |

### `TestResult`
| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Test name |
| `passed` | `boolean` | Pass/fail |
| `duration` | `number` | Duration in ms |
| `error` | `string?` | Error message |

### `FailureContext`
| Field | Type | Description |
|-------|------|-------------|
| `assertion` | `{ matcher, expected, actual, timeout }` | Assertion details |
| `screenshot` | `Buffer \| null` | PNG screenshot |
| `widgetTree` | `object` | Widget tree |
| `source` | `{ file, line, snippet }` | Source location |
| `timestamp` | `string` | ISO timestamp |

### `ProviderInfo`
| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Provider name |
| `type` | `string` | Provider type |
| `value` | `unknown` | Current value |

## Interface Types

### `FliwrightPlugin`
| Member | Signature | Description |
|--------|-----------|-------------|
| `name` | `readonly string` | Plugin identifier |
| `onInit` | `(context: PluginContext) => Promise<void>?` | Initialization hook |
| `onTestStart` | `(testName: string) => Promise<void>?` | Test start hook |
| `onTestEnd` | `(testName: string, result: TestResult) => Promise<void>?` | Test end hook |
| `onDispose` | `() => Promise<void>?` | Cleanup hook |

### `PluginContext`
| Method | Signature | Description |
|--------|-----------|-------------|
| `sendRequest` | `(method, params?) => Promise<unknown>` | JSON-RPC sender |
| `registerStateAdapter` | `(name, adapter) => void` | Register state adapter |
| `registerMockAdapter` | `(name, adapter) => void` | Register mock adapter |
| `registerFinderStrategy` | `(name, strategy) => void` | Register finder strategy |
| `registerHealingStrategy` | `(name, strategy) => void` | Register healing strategy |
| `onEvent` | `(callback) => () => void` | Subscribe to events |

### `StateAdapter`
| Method | Signature | Description |
|--------|-----------|-------------|
| `read` | `(key: string) => Promise<unknown>` | Read state value |
| `write` | `(key: string, value: unknown) => Promise<void>` | Write state value |
| `watch` | `(key, callback) => Promise<() => void>` | Watch state changes |
| `listProviders` | `() => Promise<ProviderInfo[]>` | List all providers |
| `override` | `(key, value) => Promise<void>` | Override provider value |

### `MockAdapter`
| Method | Signature | Description |
|--------|-----------|-------------|
| `addRoute` | `(pattern, handler) => Promise<void>` | Add mock route |
| `removeRoute` | `(pattern) => Promise<void>` | Remove route |
| `clear` | `() => Promise<void>` | Clear all routes |

### `FinderStrategy`
| Member | Signature | Description |
|--------|-----------|-------------|
| `strategyName` | `readonly string` | Strategy identifier |
| `find` | `(query) => Promise<WidgetMatch[]>` | Find widgets |
| `describe` | `(widget) => string` | Describe widget |

### `HealingStrategy`
| Member | Signature | Description |
|--------|-----------|-------------|
| `strategyName` | `readonly string` | Strategy identifier |
| `score` | `(original, candidate) => number` | Score similarity |
| `heal` | `(original, candidates, threshold?) => HealingResult \| null` | Find healing match |
