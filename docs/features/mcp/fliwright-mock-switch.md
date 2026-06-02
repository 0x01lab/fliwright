---
module: "fliwright_mock_switch"
package: "@fliwright/mcp"
source: "src/tools/mockTools.ts"
generated: "2026-06-02"
---

# `fliwright_mock_switch`

> Switch the active mock rule for a specific API endpoint. The endpoint must have been loaded from `.fliwright/mocks/` config files.

## Description

Updates the in-memory `MockRuleStore` so subsequent requests to `endpoint` return the response defined by `ruleName`. The bridge's `MockServerExtension` reads this store on each intercepted request.

## Input Schema

```typescript
{
  endpoint: string;        // required, e.g. "/v1/public/token"
  ruleName: string;        // required, e.g. "success" | "empty" | "server_error"
  mockDir?: string;        // optional, defaults to .fliwright/mocks
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `endpoint` | string | Yes | API endpoint path |
| `ruleName` | string | Yes | Name of the rule to activate |
| `mockDir` | string | No | Path to mocks directory; defaults to `.fliwright/mocks` |

## Output

```typescript
{
  endpoint: string;
  activeRule: string;     // confirms the new active rule
}
```

## Errors

- Throws if `endpoint` is not found in the loaded store.
- Throws if `ruleName` is not one of the endpoint's loaded rules.

## Example

```json
{
  "name": "fliwright_mock_switch",
  "arguments": { "endpoint": "/v1/public/token", "ruleName": "server_error" }
}
```
