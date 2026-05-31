# Slice 7: MCP Loop — AI Agent Integration

**Date**: 2026-05-31
**Status**: Approved
**Depends on**: Slice 0 (Extensible Architecture), Slice 1 (Minimal Loop), Slice 2 (Assertion Loop), Slice 4 (Self-Healing), Slice 5 (Recording/Codegen)

---

## Goal

Expose Fliwright's core testing capabilities as an MCP Server so that AI coding tools (Claude Code, Cursor) can run tests, read failure context with self-healing suggestions, and generate test scripts — enabling the "code → test → failure feedback → auto-fix" closed loop.

---

## Delivery Approach: Vertical Slice Iteration

Four iterations, each delivering a demoable end-to-end capability:

| Iteration | Scope | User Gets |
|-----------|-------|-----------|
| 7-A | Package scaffold + server setup + state management | "MCP server boots, responds to ping" |
| 7-B | `fliwright_run` tool | "AI agent can trigger a test run via MCP" |
| 7-C | `fliwright_get_failure` + `fliwright_generate_test` + `test_report` resource | "Full MCP tool suite" |
| 7-D | Integration test | End-to-end MCP loop verification |

---

## 1. Package Structure

### 1.1 New Package: `packages/fliwright-mcp`

```
packages/fliwright-mcp/
├── src/
│   ├── index.ts              # Entry point, starts stdio server
│   ├── server.ts             # MCP server setup + tool/resource registration
│   ├── state.ts              # Server state management (McpServerState)
│   ├── tools/
│   │   ├── runTest.ts        # fliwright_run tool handler
│   │   ├── getFailure.ts     # fliwright_get_failure tool handler
│   │   └── generateTest.ts   # fliwright_generate_test tool handler
│   └── resources/
│       └── testReport.ts     # test_report resource handler
├── tests/
│   ├── server.test.ts
│   ├── runTest.test.ts
│   ├── getFailure.test.ts
│   ├── generateTest.test.ts
│   └── testReport.test.ts
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

### 1.2 Transport

Stdio transport via `@modelcontextprotocol/sdk`. Entry point: `npx fliwright-mcp` starts the server.

Claude Code MCP config example:
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

### 1.3 Dependencies

| Package | Purpose |
|---------|---------|
| `@modelcontextprotocol/sdk` | MCP server framework |
| `@fliwright/core` | Core SDK (workspace dependency) |

**Estimate**: 2 days

---

## 2. Server State Management

### 2.1 McpServerState

The server maintains in-memory state between tool calls:

```typescript
interface McpServerState {
  lastRunResult: RunResult | null;
  driver: FliwrightDriver | null;
  vmServiceUrl: string | null;
}

interface RunResult {
  passed: boolean;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  duration: number;
  results: Array<{
    name: string;
    passed: boolean;
    duration: number;
    error?: string;
  }>;
}
```

### 2.2 Driver Lifecycle

- The driver is created lazily on first `fliwright_run` call
- VM Service URL comes from tool parameter or `FLIWRIGHT_VM_URL` environment variable
- The driver persists across tool calls within the same server session
- Driver is disposed when the server process exits

### 2.3 Failure Data

When tests run and fail, the FailureCollector (from Slice 2) and SelfHealingEngine (from Slice 4) store their data in the driver. The `fliwright_get_failure` tool reads from these in-memory stores — no additional persistence needed.

**Estimate**: included in 7-A

---

## 3. MCP Tool: `fliwright_run`

### 3.1 Schema

```json
{
  "name": "fliwright_run",
  "description": "Run a Fliwright test file and return pass/fail results",
  "inputSchema": {
    "type": "object",
    "properties": {
      "testFile": {
        "type": "string",
        "description": "Path to the .test.ts file to run"
      },
      "vmServiceUrl": {
        "type": "string",
        "description": "Dart VM Service WebSocket URL (or set FLIWRIGHT_VM_URL env var)"
      },
      "testName": {
        "type": "string",
        "description": "Run only the test matching this name"
      }
    },
    "required": ["testFile"]
  }
}
```

### 3.2 Behavior

1. Resolve VM Service URL (parameter > env var > error)
2. Create or reuse `FliwrightDriver`, connect to VM Service
3. Import and execute the test file using Vitest's programmatic API
4. Collect results, store in `McpServerState.lastRunResult`
5. Return structured `RunResult` JSON

### 3.3 Implementation

```typescript
async function handleRunTest(params: RunTestParams): Promise<RunResult> {
  const vmUrl = params.vmServiceUrl ?? process.env.FLIWRIGHT_VM_URL;
  if (!vmUrl) throw new Error('No VM Service URL provided');

  // Connect driver
  if (!state.driver || state.vmServiceUrl !== vmUrl) {
    state.driver = new FliwrightDriver();
    await state.driver.connect(vmUrl);
    state.vmServiceUrl = vmUrl;
  }

  // Run tests via Vitest programmatically
  const result = await runVitestTests(params.testFile, params.testName);
  state.lastRunResult = result;
  return result;
}
```

**Estimate**: 2 days

---

## 4. MCP Tool: `fliwright_get_failure`

### 4.1 Schema

```json
{
  "name": "fliwright_get_failure",
  "description": "Get detailed failure context from the most recent test run, including Widget tree, source location, and self-healing suggestions",
  "inputSchema": {
    "type": "object",
    "properties": {
      "testName": {
        "type": "string",
        "description": "Filter to a specific test name (returns all failures if omitted)"
      }
    }
  }
}
```

### 4.2 Output

```json
{
  "failures": [
    {
      "testName": "logout flow",
      "assertion": {
        "matcher": "toBeVisible",
        "expected": "visible",
        "actual": "not found",
        "timeout": 5000
      },
      "widgetTree": { ... },
      "source": {
        "file": "tests/login.test.ts",
        "line": 45,
        "snippet": "await expect(locator).toBeVisible()"
      },
      "healingSuggestion": {
        "originalSelector": "text=Logout",
        "suggestedSelector": "text=Sign Out",
        "confidence": 0.92,
        "scores": {
          "position": 0.95,
          "context": 0.88,
          "text": 0.93,
          "weighted": 0.92
        }
      },
      "timestamp": "2026-05-31T10:00:00Z"
    }
  ]
}
```

### 4.3 Data Sources

- `FailureCollector` from Slice 2 — assertion context, screenshots, Widget tree
- `SelfHealingEngine` from Slice 4 — healing suggestions, confidence scores
- Both are accessible via the `FliwrightDriver` instance stored in server state

**Estimate**: 1 day

---

## 5. MCP Tool: `fliwright_generate_test`

### 5.1 Schema

```json
{
  "name": "fliwright_generate_test",
  "description": "Generate a Fliwright test script from Flutter source code or a natural language description",
  "inputSchema": {
    "type": "object",
    "properties": {
      "source": {
        "type": "string",
        "description": "Flutter/Dart source code of the page or widget to test"
      },
      "description": {
        "type": "string",
        "description": "Natural language description of what the test should verify"
      },
      "testName": {
        "type": "string",
        "description": "Name for the generated test (default: 'generated test')"
      }
    },
    "required": ["source"]
  }
}
```

### 5.2 Output

```json
{
  "testCode": "import { test, expect } from '@fliwright/vitest';\n\ntest('login flow', async ({ page }) => {\n  await page.locator({ text: '用户名' }).type('test@example.com');\n  await page.locator({ text: '密码' }).type('secret123');\n  await page.locator({ text: '登录' }).click();\n  await expect(page.locator({ text: '欢迎' })).toBeVisible();\n});",
  "testName": "login flow"
}
```

### 5.3 Generation Strategy

Parse the Flutter source code to extract:
- `Text` widgets → text selectors
- `TextField`/`TextFormField` → type operations with hintText selectors
- `ElevatedButton`/`TextButton` → click operations
- `AppBar` title → page identification

Generate operations following the pattern from Slice 5's `CodeGenerator`. If `description` is provided, use it to add assertions and filter which interactions to include.

**Estimate**: 2 days

---

## 6. MCP Resource: `test_report`

### 6.1 URI

`fliwright://test-report/latest`

### 6.2 Content

Returns the same data as `fliwright_run` output, but readable at any time after a run completes. MIME type: `application/json`.

### 6.3 Implementation

```typescript
server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    {
      uri: 'fliwright://test-report/latest',
      name: 'Latest Test Report',
      description: 'Results from the most recent test run',
      mimeType: 'application/json',
    },
  ],
}));

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  if (request.params.uri === 'fliwright://test-report/latest') {
    return {
      contents: [{
        uri: 'fliwright://test-report/latest',
        mimeType: 'application/json',
        text: JSON.stringify(state.lastRunResult ?? { message: 'No test run yet' }, null, 2),
      }],
    };
  }
  throw new Error('Unknown resource');
});
```

**Estimate**: 1 day

---

## 7. Estimates Summary

| Task | Description | Days | Iteration |
|------|-------------|------|-----------|
| 7.1 | Package scaffold + server + state | 2d | 7-A |
| 7.2 | `fliwright_run` tool | 2d | 7-B |
| 7.3 | `fliwright_get_failure` tool | 1d | 7-C |
| 7.4 | `fliwright_generate_test` tool | 2d | 7-C |
| 7.5 | `test_report` resource | 1d | 7-C |
| 7.6 | Integration test | 2d | 7-D |
| **Total** | | **10d** | |

---

## 8. Dependencies

- Slice 0: PluginRegistry, Protocol
- Slice 1: FliwrightDriver, Page, Locator
- Slice 2: Assertion engine, FailureCollector
- Slice 4: SelfHealingEngine, HealingReport
- Slice 5: CodeGenerator, RecordedOperation

### New NPM Dependencies

- `@modelcontextprotocol/sdk` — MCP server framework

---

## 9. Out of Scope

- `fliwright_mock` MCP tool (deferred)
- SSE transport (stdio only)
- Multi-session state persistence (state lives only in server process memory)
- Test file watching / auto-rerun
- MCP prompts (tools and resources only)
