---
module: "fliwright_mock_list"
package: "@fliwright/mcp"
source: "src/tools/mockTools.ts"
generated: "2026-06-02"
---

# `fliwright_mock_list`

> List all mock API endpoints loaded from `.fliwright/mocks/`, their available rules, and the currently active rule for each endpoint.

## Description

Reads the shared `MockRuleStore` from `ServerState`. The store is populated by `MockRuleStore` reading `.fliwright/mocks/*.json` files at init or on `fliwright_mock_switch`.

## Input Schema

```typescript
{}  // no parameters
```

## Output

```typescript
{
  endpoints: Array<{
    endpoint: string;            // e.g. "/v1/public/token"
    rules: Array<{ name: string; status?: number; body?: unknown }>;
    activeRule?: string;         // name of currently active rule
  }>;
}
```

## Example

```json
{ "name": "fliwright_mock_list", "arguments": {} }
```
