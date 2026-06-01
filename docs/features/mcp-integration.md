---
feature: "MCP Integration"
packages: ["@fliwright/mcp", "@fliwright/vitest", "@fliwright/core"]
status: implemented
agent_accessible: true
generated: "2026-06-01"
---

# MCP Integration

> Model Context Protocol integration that exposes Fliwright as tools for AI coding agents.

## Architecture

1. **createFliwrightServer()** (`server.ts`): Creates MCP server with stdio transport.
2. **ServerState** (`state.ts`): Mutable state holding last run results and failures.
3. **Tool Registration** (`tools/*.ts`): Registers 4 tools with input schemas via Zod.
4. **Resource Registration** (`resources/testReport.ts`): Registers test report resource.
5. **Vitest Integration** (`@fliwright/vitest`): Writes failure context to temp file during test runs.

## Agent Integration

AI agents (Claude, Cursor, etc.) interact with Fliwright exclusively through MCP tools:

| Tool | Purpose |
|------|---------|
| `fliwright_run` | Execute tests and get pass/fail results |
| `fliwright_get_failure` | Get detailed failure context with healing suggestions |
| `fliwright_generate_test` | Generate test code from Flutter source |
| `fliwright_record` | Record interactions and generate test code |

## Data Flow

```
AI Agent (Claude, Cursor, etc.)
    │
    ▼ MCP Protocol (stdio)
fliwright-mcp server
    │
    ├── fliwright_run → spawn Vitest → parse JSON output
    │   │
    │   ├── @fliwright/vitest → FliwrightDriver → bridge
    │   │   │
    │   │   └── On failure: write MCP failure context to temp file
    │   │
    │   └── Read failure context → store in ServerState
    │
    ├── fliwright_get_failure → read from ServerState
    │
    ├── fliwright_generate_test → parse source → generate code
    │
    └── fliwright_record → RecorderController → bridge → codegen
    │
    ▼
Resource: fliwright://test-report/latest → last RunResult
```

## Key Files

- `packages/fliwright-mcp/src/server.ts` — Server factory
- `packages/fliwright-mcp/src/state.ts` — Server state management
- `packages/fliwright-mcp/src/tools/runTest.ts` — Test runner tool
- `packages/fliwright-mcp/src/tools/getFailure.ts` — Failure retrieval tool
- `packages/fliwright-mcp/src/tools/generateTest.ts` — Test generation tool
- `packages/fliwright-mcp/src/tools/record.ts` — Recording tool
- `packages/fliwright-mcp/src/resources/testReport.ts` — Test report resource
- `packages/fliwright-vitest/src/index.ts` — Vitest integration (writes failure context)
