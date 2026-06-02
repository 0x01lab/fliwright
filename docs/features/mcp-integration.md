---
feature: "MCP Integration"
packages: ["@fliwright/mcp", "@fliwright/vitest", "@fliwright/core"]
status: implemented
agent_accessible: true
generated: "2026-06-02"
---

# MCP Integration

> Exposes Fliwright testing capabilities to AI agents via the Model Context Protocol (MCP) — enabling test execution, failure diagnosis, test generation, recording, and mock rule management from any MCP-compatible AI tool.

## Architecture

1. **MCP Server** (`@fliwright/mcp`): A stdio-based MCP server that registers tools and resources. Uses `@modelcontextprotocol/sdk` to handle the MCP protocol.

2. **Server State** (`state.ts`): Shared state object that tracks the last test run result, failure entries, VM Service URL, and `MockRuleStore` across tool invocations.

3. **Vitest Integration** (`@fliwright/vitest`): When a test fails, the vitest fixture writes failure context (screenshot, widget tree, healing suggestion) to a JSON file that the MCP server reads.

4. **Failure Context Pipeline**: `AssertionError` → `FailureCollector` → `writeMcpFailureContext()` → JSON file → `runTest.ts` reads file → stored in server state → `fliwright_get_failure` returns it.

## MCP Tools

| Tool | Input | Output | Purpose |
|------|-------|--------|---------|
| `fliwright_run` | testFile, vmServiceUrl?, testName?, cwd? | RunResult | Execute test file |
| `fliwright_get_failure` | testName? | GetFailureResult | Get failure context |
| `fliwright_generate_test` | source, description?, testName? | GenerateTestResult | Generate test from source |
| `fliwright_record` | vmServiceUrl?, duration?, testName?, lang? | RecordResult | Record and generate code |
| `fliwright_mock_list` | — | Endpoint list | List mock rules |
| `fliwright_mock_switch` | mockDir?, endpoint, ruleName | Confirmation | Switch mock rule |

## MCP Resources

| Resource | URI | Description |
|----------|-----|-------------|
| `test_report` | `fliwright://test-report/latest` | Last test run results |

## Data Flow

```
AI Agent (Claude Code, etc.)
    │
    ▼ MCP Protocol (stdio)
FliwrightMcpServer
    │
    ├── fliwright_run
    │   ├── Resolve VM Service URL
    │   ├── Spawn Vitest (subprocess)
    │   │   └── @fliwright/vitest test fixture
    │   │       ├── FliwrightDriver.connect()
    │   │       ├── Test execution → Assertion.poll()
    │   │       ├── On pass: recordSuccessSnapshot()
    │   │       └── On fail: FailureCollector.collect()
    │   │                   → writeMcpFailureContext()
    │   │                   → failures.json
    │   └── Read failures.json → store in ServerState
    │
    ├── fliwright_get_failure
    │   └── ServerState.getFailuresByTestName()
    │
    ├── fliwright_generate_test
    │   └── parseFlutterSource() → generate test code
    │
    ├── fliwright_record
    │   └── RecorderController.start/stop → CodeGenerator
    │
    ├── fliwright_mock_list
    │   └── MockRuleStore.listEndpoints()
    │
    └── fliwright_mock_switch
        └── MockRuleStore.switchRule()
```

## Configuration

\```json
{
  "mcpServers": {
    "fliwright": {
      "command": "npx",
      "args": ["fliwright-mcp"]
    }
  }
}
\```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `FLIWRIGHT_VM_URL` | Default VM Service WebSocket URL |
| `FLIWRIGHT_MOCK_CONTROLLER_URL` | Mock controller URL for Flutter-side mocking |
| `FLIWRIGHT_MCP_FAILURE_CONTEXT_PATH` | Path for failure context JSON file |

## Key Files

- `packages/fliwright-mcp/src/server.ts` — MCP server setup
- `packages/fliwright-mcp/src/state.ts` — Shared server state
- `packages/fliwright-mcp/src/tools/runTest.ts` — Test execution tool
- `packages/fliwright-mcp/src/tools/getFailure.ts` — Failure retrieval tool
- `packages/fliwright-mcp/src/tools/generateTest.ts` — Test generation tool
- `packages/fliwright-mcp/src/tools/record.ts` — Recording tool
- `packages/fliwright-mcp/src/tools/mockTools.ts` — Mock management tools
- `packages/fliwright-mcp/src/resources/testReport.ts` — Test report resource
- `packages/fliwright-vitest/src/index.ts` — Vitest integration with failure context writing
