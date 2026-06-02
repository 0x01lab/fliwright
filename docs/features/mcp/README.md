---
package: "@fliwright/mcp"
version: "0.1.0"
layer: transport
status: implemented
generated: "2026-06-02"
---

# @fliwright/mcp

> MCP (Model Context Protocol) server that exposes Fliwright to AI agents: `fliwright_run`, `fliwright_get_failure`, `fliwright_generate_test`, `fliwright_record`, plus mock management tools and a `test_report` resource.

## Tools

| Tool | Description | Doc |
|------|-------------|-----|
| `fliwright_run` | Run a Fliwright test file and return pass/fail results | [fliwright-run.md](./fliwright-run.md) |
| `fliwright_get_failure` | Get detailed failure context from the most recent run | [fliwright-get-failure.md](./fliwright-get-failure.md) |
| `fliwright_generate_test` | Generate a Fliwright test from Flutter source code | [fliwright-generate-test.md](./fliwright-generate-test.md) |
| `fliwright_record` | Record interactions and return generated code | [fliwright-record.md](./fliwright-record.md) |
| `fliwright_mock_list` | List mock API endpoints and their available rules | [fliwright-mock-list.md](./fliwright-mock-list.md) |
| `fliwright_mock_switch` | Switch the active rule for a mock endpoint | [fliwright-mock-switch.md](./fliwright-mock-switch.md) |

## Resources

| URI | Description | Doc |
|-----|-------------|-----|
| `fliwright://test-report/latest` | JSON of the most recent test run result | [test-report.md](./test-report.md) |

## Dependencies

- `@fliwright/core` — workspace:*
- `@modelcontextprotocol/sdk` ^1.12
- `vitest` ^2
- `zod` ^3.25

## Usage Example

Start the MCP server (stdio transport):

```bash
npx -y @fliwright/mcp
```

Wire it into Claude Code's MCP config (`.mcp.json`):

```json
{
  "mcpServers": {
    "fliwright": { "command": "npx", "args": ["-y", "@fliwright/mcp"] }
  }
}
```

Sample `tools/call` request from an MCP client:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "fliwright_run",
    "arguments": {
      "testFile": "tests/login.test.ts",
      "vmServiceUrl": "ws://127.0.0.1:54321/abc="
    }
  }
}
```

Response:

```json
{
  "content": [
    { "type": "text", "text": "{\"passed\": true, \"totalTests\": 1, \"passedTests\": 1, \"failedTests\": 0, \"duration\": 1234, \"results\": [...]}" }
  ]
}
```
