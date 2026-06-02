---
module: "fliwright_mock_list"
package: "@fliwright/mcp"
source: "src/tools/mockTools.ts"
generated: "2026-06-02"
---

# fliwright_mock_list

> List all mock API endpoints, their available rules, and currently active rule.

## Input Schema

No parameters required.

## Output

Plain text listing of endpoints in the format:
```
METHOD /path — [rule1, rule2 ✓, rule3]
```

Where ✓ marks the currently active rule.
