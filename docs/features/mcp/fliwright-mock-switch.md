---
module: "fliwright_mock_switch"
package: "@fliwright/mcp"
source: "src/tools/mockTools.ts"
generated: "2026-06-02"
---

# fliwright_mock_switch

> Switch the active mock rule for a specific API endpoint.

## Input Schema

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `mockDir` | `string` | No | Path to .fliwright/mocks directory |
| `endpoint` | `string` | Yes | API endpoint path (e.g. "/v1/public/token") |
| `ruleName` | `string` | Yes | Rule name to activate (e.g. "success", "error") |

## Output

Confirmation message: `Switched: METHOD /endpoint → ruleName`

## Error Handling

Returns `isError: true` if the endpoint or rule name is not found.
