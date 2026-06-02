---
module: "MockRuleStore"
package: "@fliwright/core"
source: "src/MockRuleStore.ts"
tests: "tests/MockRuleStore.test.ts"
generated: "2026-06-02"
---

# MockRuleStore

> In-memory store of mock endpoint rules loaded from `.fliwright/mocks/`, with per-endpoint active-rule tracking.

## Overview

The store reads `mock-index.json` (which lists config files and a `defaultRule`), parses each per-endpoint config file (`{ endpoint, method, rules: [{ name, status, body, headers, delay }] }`), and tracks which rule is active per endpoint. Used by `MockManager` and the MCP mock tools.

## Constructor

```typescript
constructor()
```

No parameters. The store starts empty.

## Public Methods

### `loadFromDirectory(mockDir): Promise<void>`

Reads `<mockDir>/mock-index.json` and every file referenced in `index.files`. Validates that `files` is an array and `defaultRule` is set; otherwise logs a warning and skips. Per-file JSON errors are also warned-and-skipped.

---

### `listEndpoints(): { endpoint, method, rules, activeRule }[]`

Returns a snapshot of every loaded endpoint.

---

### `getActiveResponse(endpoint): MockRouteResponse | null`

Returns `{ status, headers, body, delay }` for the endpoint's currently active rule, or `null` if not loaded.

---

### `switchRule(endpoint, ruleName): MockRouteResponse | null`

Sets the active rule. Throws if endpoint or ruleName is unknown. Returns the now-active response.

## Properties

| Property | Type | Description |
|----------|------|-------------|
| `isLoaded` | boolean | True if any endpoint has been loaded |

## File Layout

```
.fliwright/mocks/
├── mock-index.json         # { files: [...], defaultRule: "success" }
├── login.json              # { endpoint, method, rules: [...] }
└── token.json
```

## Example

```typescript
const store = new MockRuleStore();
await store.loadFromDirectory('.fliwright/mocks');
const rules = store.listEndpoints();
await store.switchRule('/v1/login', 'server_error');
```

## Related

- **Used by:** [MockManager](./MockManager.md), `@fliwright/mcp` mock tools
- **Source:** `packages/fliwright-core/src/MockRuleStore.ts`
