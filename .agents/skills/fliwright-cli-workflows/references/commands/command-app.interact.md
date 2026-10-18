---
command: "app.interact"
group: app
status: implemented
source: packages/fliwright-cli/src/registry
---

# fliwright app interact

Perform one tap, text entry, navigation, wait, drag or extended action.

## When to use

Use after locating a current target. This is the app mutation entry point for Skills.

## Preconditions and behavior

- A running Flutter app with fliwright_bridge; attach with vmUrl/project configuration or use a connection session.
- No persistent session required. See usage for finite/session variants.
- For tap/type/wait/targeted actions choose exactly one of ref, key, text or type. Coordinate drag may use x+y instead; global dismiss/network-idle actions need no target.
- type requires a string value; drag requires deltaX+deltaY; action requires action. pressKey needs keyboardKey; setCheckbox needs checked; selectOption needs value.
- navigate defaults to goto and needs path except resetToHome. navigationAction selects resetRouteStack/resetToHome. extra and settling/waitFor options apply to navigation.
- Navigation waitUntil defaults to settled; settleTimeout defaults to 3000 ms. A timed-out settle throws unless throwOnSettleTimeout=false.
- For durable automation prefer stable Key/text selectors. After an uncertain session response, query its operationId before retrying.

## Input

| JSON field | CLI syntax | Type / values | Required | Schema default | Meaning |
| --- | --- | --- | --- | --- | --- |
| `vmUrl` | `--vm-url` | string | no | — | Dart VM Service websocket URL. Omit to use project/environment endpoint resolution where supported. (minLength=1) |
| `ref` | `--ref` | string | no | — | Opaque live snapshot ref; reacquire after isolate restart. (minLength=1) |
| `key` | `--key` | string | no | — | Stable Flutter Key selector. (minLength=1) |
| `text` | `--text` | string | no | — | Exact text match for a snapshot query or interaction target. (minLength=1) |
| `type` | `--type` | string | no | — | Flutter widget type filter/target. (minLength=1) |
| `operation` | `positional operation` | "tap" \| "type" \| "navigate" \| "wait" \| "drag" \| "action" | yes | — | Interaction variant. Conditional target/value requirements are documented above. |
| `value` | `--value` | string \| number | no | — | Text or option value. type requires a string; selectOption accepts string/number. |
| `replace` | `--replace` | boolean | no | — | Replace existing text during type (effective default true); false appends. |
| `path` | `--path` | string | no | — | Route for goto/resetRouteStack navigation. Not required for resetToHome. (minLength=1) |
| `homeRoute` | `--home-route` | string | no | — | Home route for reset/generation; commonly /. (minLength=1) |
| `navigationAction` | `--navigation-action` | "goto" \| "resetRouteStack" \| "resetToHome" | no | — | Navigation variant; effective default goto. |
| `timeout` | `--timeout` | integer | no | — | Milliseconds for the test runner, target wait or extended action, depending on the command. (exclusiveMinimum=0) |
| `deltaX` | `--delta-x` | number | no | — | Horizontal drag displacement in logical pixels. |
| `deltaY` | `--delta-y` | number | no | — | Vertical drag displacement in logical pixels. |
| `steps` | `--steps` | integer | no | — | Number of drag interpolation steps. (exclusiveMinimum=0) |
| `x` | `--x` | number | no | — | Start x-coordinate for a coordinate drag; requires y. |
| `y` | `--y` | number | no | — | Start y-coordinate for a coordinate drag; requires x. |
| `action` | `--action` | "doubleClick" \| "tripleClick" \| "rightClick" \| "hover" \| "focus" \| "blur" \| "clear" \| "pressKey" \| "setCheckbox" \| "selectOption" \| "drag" \| "dismissModal" \| "dismissKeyboard" \| "waitForNetworkIdle" | no | — | Extended interaction or DevAssist action; allowed values are derived from the schema. |
| `keyboardKey` | `--keyboard-key` | string | no | — | Keyboard key for action=pressKey. (minLength=1) |
| `checked` | `--checked` | boolean | no | — | Desired checkbox state for action=setCheckbox. |
| `includeSnapshot` | `--include-snapshot` | boolean | no | — | Include the post-interaction snapshot when supported by the operation. |
| `quietMs` | `--quiet-ms` | integer | no | — | Required network-quiet window for waitForNetworkIdle, in milliseconds. (exclusiveMinimum=0) |
| `extra` | `--extra` | object | no | — | Structured extra route payload for navigation; use --input for nested data. |
| `waitUntil` | `--wait-until` | "none" \| "settled" | no | — | Navigation settling policy; effective default settled. |
| `settleTimeout` | `--settle-timeout` | integer | no | — | Navigation settle budget in milliseconds; effective default 3000. (exclusiveMinimum=0) |
| `stableFrames` | `--stable-frames` | integer | no | — | Number of stable frames required by navigation settling. (exclusiveMinimum=0) |
| `waitFor` | `--wait-for` | object | no | — | Structured selector to await after navigation; use --input. |
| `waitForTimeout` | `--wait-for-timeout` | integer | no | — | Post-navigation selector wait budget, milliseconds. (exclusiveMinimum=0) |
| `throwOnSettleTimeout` | `--throw-on-settle-timeout` | boolean | no | — | Fail on navigation settle timeout; effective default true. |

Requiredness/defaults above come from the input schema. Conditional requirements and effective implementation defaults are explained above; “—” means no Zod default. Every command also accepts [common options](./common.md#common-options). JSON keys use camelCase; flags use kebab-case. Positional fields are supplied positionally or in --input, not as flags.

## Examples

Examples assume a project with Fliwright installed. Replace app-specific keys, scenario/flow names and uppercase placeholders. For live examples, set VM_URL to your actual websocket endpoint; set SESSION_ID from session open where used.

### Tap a stable target

```sh
fliwright app interact 'tap' --key 'increment' --include-snapshot 'true' --session "$SESSION_ID" --json
```

### Fill a text field

```sh
fliwright app interact 'type' --key 'email' --value 'test@example.com' --replace 'true' --session "$SESSION_ID" --json
```

### Navigate and settle

```sh
fliwright app interact 'navigate' --path '/settings' --wait-until 'settled' --session "$SESSION_ID" --json
```

### Wait for UI

```sh
fliwright app interact 'wait' --text 'Saved' --timeout '5000' --session "$SESSION_ID" --json
```

### Drag a scroll area

```sh
fliwright app interact 'drag' --key 'list' --delta-x '0' --delta-y '-300' --steps '10' --session "$SESSION_ID" --json
```

### Dismiss the keyboard

```sh
fliwright app interact 'action' --action 'dismissKeyboard' --session "$SESSION_ID" --json
```

## Result

With --json, read the versioned envelope’s ok and data fields. The following describes data, not the outer envelope. “(data)” means a value returned directly, not a wrapper property.

| Data field / variant | Meaning |
| --- | --- |
| (data) | Operation-specific result: success, filled text, navigation action/path, drag/action name, or found for wait. |
| snapshot | Optional post-action snapshot when includeSnapshot=true. |

## Effects and failure handling

Registry effects: `app`. These are coarse declarations; the behavior section explains actual reads/writes.

Use [exit codes and recovery](./common.md#exit-codes-and-recovery). Retain data on nonzero exit because it can contain failure evidence or partial results. Correct input errors before retrying; for session mutations query the operation journal before retrying an uncertain response.

## Exact input schema

```json
{
  "type": "object",
  "properties": {
    "vmUrl": {
      "type": "string",
      "minLength": 1
    },
    "ref": {
      "type": "string",
      "minLength": 1
    },
    "key": {
      "type": "string",
      "minLength": 1
    },
    "text": {
      "type": "string",
      "minLength": 1
    },
    "type": {
      "type": "string",
      "minLength": 1
    },
    "operation": {
      "type": "string",
      "enum": [
        "tap",
        "type",
        "navigate",
        "wait",
        "drag",
        "action"
      ]
    },
    "value": {
      "type": [
        "string",
        "number"
      ]
    },
    "replace": {
      "type": "boolean"
    },
    "path": {
      "type": "string",
      "minLength": 1
    },
    "homeRoute": {
      "type": "string",
      "minLength": 1
    },
    "navigationAction": {
      "type": "string",
      "enum": [
        "goto",
        "resetRouteStack",
        "resetToHome"
      ]
    },
    "timeout": {
      "type": "integer",
      "exclusiveMinimum": 0
    },
    "deltaX": {
      "type": "number"
    },
    "deltaY": {
      "type": "number"
    },
    "steps": {
      "type": "integer",
      "exclusiveMinimum": 0
    },
    "x": {
      "type": "number"
    },
    "y": {
      "type": "number"
    },
    "action": {
      "type": "string",
      "enum": [
        "doubleClick",
        "tripleClick",
        "rightClick",
        "hover",
        "focus",
        "blur",
        "clear",
        "pressKey",
        "setCheckbox",
        "selectOption",
        "drag",
        "dismissModal",
        "dismissKeyboard",
        "waitForNetworkIdle"
      ]
    },
    "keyboardKey": {
      "type": "string",
      "minLength": 1
    },
    "checked": {
      "type": "boolean"
    },
    "includeSnapshot": {
      "type": "boolean"
    },
    "quietMs": {
      "type": "integer",
      "exclusiveMinimum": 0
    },
    "extra": {
      "type": "object",
      "additionalProperties": {}
    },
    "waitUntil": {
      "type": "string",
      "enum": [
        "none",
        "settled"
      ]
    },
    "settleTimeout": {
      "type": "integer",
      "exclusiveMinimum": 0
    },
    "stableFrames": {
      "type": "integer",
      "exclusiveMinimum": 0
    },
    "waitFor": {
      "type": "object",
      "additionalProperties": {}
    },
    "waitForTimeout": {
      "type": "integer",
      "exclusiveMinimum": 0
    },
    "throwOnSettleTimeout": {
      "type": "boolean"
    }
  },
  "required": [
    "operation"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

Refresh the installed contract with `fliwright schema app.interact --json`. That command describes the envelope; it does not enforce a full command-specific data schema.

## Related commands

- [app find](./command-app.find.md) — Find snapshot refs matching text, Key, semantics, role or widget type.
- [app observe](./command-app.observe.md) — List current UI candidates, optionally filtered by role.
- [app snapshot](./command-app.snapshot.md) — Capture the app’s readable widget snapshot and opaque interaction refs.
- [session status](./command-session.status.md) — Read worker state or the journal entry of one operation.
- [Command index](./index.md)
