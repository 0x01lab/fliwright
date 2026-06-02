---
feature: "MCP Agent Integration"
packages: ["@fliwright/mcp", "@fliwright/vitest", "@fliwright/core"]
status: implemented
agent_accessible: true
generated: "2026-06-02"
---

# MCP Agent Integration

> Expose Fliwright's run / failure-diagnosis / test-generation / recording / mock-management capabilities to any MCP-compatible AI agent (Claude Code, Claude Agent SDK, custom MCP clients) through a single `fliwright` MCP server.

## Architecture

1. **Server entry** (`@fliwright/mcp` `createFliwrightServer`): instantiates an MCP server named `fliwright` at version 0.1.0 with a shared `state` object.
2. **State sharing** (`createServerState`): holds the last `RunResult`, collected failure contexts, mock rule store, and recording session handle so tools/resources can read each other's output.
3. **Tool registration** (`tools/*.ts`): each `register*Tool(server, state)` function adds one tool with a zod input schema and a handler that calls into `@fliwright/core` or `@fliwright/vitest`.
4. **Resource registration** (`resources/testReport.ts`): exposes a `test://report` resource an agent can `read` to fetch the latest test report JSON.
5. **Transport**: the `fliwright-mcp` bin speaks stdio MCP transport by default; the VS Code extension's `fliwright.configureMcp` command writes the proper `claude.code.mcp.json` entry to enable Claude Code to launch it.
6. **Vitest reporter bridge** (`@fliwright/vitest` reporter): when a Vitest run executes through the CLI or VS Code, the reporter writes a structured failure context file that `fliwright_get_failure` later reads.

## Tools

| Tool | Purpose |
|------|---------|
| `fliwright_run` (runTest) | Run a Vitest test file, optionally a single test by name, with a specific VM service URL. Returns `RunResult`. |
| `fliwright_get_failure` (getFailure) | Return the latest `FailureContext` (screenshot, widget tree, source snippet, healing report). |
| `fliwright_generate_test` (generateTest) | Generate a new test file from a description + a target widget / page identifier. |
| `fliwright_record` (record) | Start/stop recording and return the generated code. |
| `fliwright_mock_list` (mockList) | List available mock rule files in the workspace. |
| `fliwright_mock_switch` (mockSwitch) | Activate a specific mock rule set for the next run. |

## Resources

| Resource | URI | Description |
|----------|-----|-------------|
| `test_report` | `test://report` | Latest test run summary: passed/failed counts, durations, failure entries. |

## Agent Integration

- **Claude Code**: run `fliwright: Configure MCP` in VS Code, or add the server to `.mcp.json` manually:
  ```json
  { "mcpServers": { "fliwright": { "command": "npx", "args": ["-y", "@fliwright/mcp"] } } }
  ```
- **Claude Agent SDK**: pass the same command to the SDK's MCP launcher.
- **Custom clients**: connect via stdio; the server uses the official `@modelcontextprotocol/sdk`.

## Data Flow

```
Agent (Claude Code / SDK / custom MCP client)
        │ JSON-RPC over stdio
        ▼
McpServer "fliwright"  (@fliwright/mcp/server.ts)
        │
        ├── tools/runTest.ts        ──> @fliwright/vitest reporter ──> state.lastRun
        ├── tools/getFailure.ts     ──> state.failures + healing report
        ├── tools/generateTest.ts   ──> @fliwright/core CodeGenerator
        ├── tools/record.ts         ──> RecorderController + bridge
        ├── tools/mockTools.ts      ──> MockRuleStore
        └── resources/testReport.ts ──> state.lastRun (read-only)
```

## Key Files

- `packages/fliwright-mcp/src/server.ts` — server factory.
- `packages/fliwright-mcp/src/state.ts` — shared state container.
- `packages/fliwright-mcp/src/tools/` — tool registrations.
- `packages/fliwright-mcp/src/resources/testReport.ts` — test report resource.
- `packages/fliwright-vitest/src/reporter.ts` — Vitest reporter that feeds the state.
- `packages/fliwright-cli/src/index.ts` — CLI alternative for non-MCP runs.
