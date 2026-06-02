---
package: "@fliwright/mcp"
version: "0.1.0"
layer: transport
status: implemented
generated: "2026-06-02"
---

# @fliwright/mcp

> MCP (Model Context Protocol) server that exposes Fliwright test execution, failure diagnosis, test generation, recording, and mock rule management to AI agents.

## Modules

| Module | Description | Doc |
|--------|-------------|-----|
| `fliwright_run` | Run Fliwright test files and return pass/fail results | [fliwright-run.md](./fliwright-run.md) |
| `fliwright_get_failure` | Get detailed failure context with widget tree and healing suggestions | [fliwright-get-failure.md](./fliwright-get-failure.md) |
| `fliwright_generate_test` | Generate test scripts from Flutter source code | [fliwright-generate-test.md](./fliwright-generate-test.md) |
| `fliwright_record` | Record user interactions and generate test code | [fliwright-record.md](./fliwright-record.md) |
| `fliwright_mock_list` | List mock endpoints and their active rules | [fliwright-mock-list.md](./fliwright-mock-list.md) |
| `fliwright_mock_switch` | Switch active mock rule for an endpoint | [fliwright-mock-switch.md](./fliwright-mock-switch.md) |
| `test_report` | Resource: results from most recent test run | [test-report.md](./test-report.md) |

## Dependencies

- `@fliwright/core` workspace:* — core SDK
- `@modelcontextprotocol/sdk` ^1.12.0 — MCP server SDK
- `vitest` ^2.0.0 — test runner
- `zod` ^3.25.0 — schema validation

## Usage

```bash
# Start the MCP server (stdio transport)
npx fliwright-mcp
```

Configure in Claude Code settings:
```json
{
  "mcpServers": {
    "fliwright": {
      "command": "npx",
      "args": ["fliwright-mcp"]
    }
  }
}
```
