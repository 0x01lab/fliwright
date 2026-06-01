# VS Code Extension Design

**Date**: 2026-05-31  
**Status**: Draft  
**Scope**: VS Code extension MVP design only  
**Depends on**: `@fliwright/core`, `@fliwright/vitest`, `@fliwright/mcp`, Recording/Codegen, Form Helper, Self-Healing  
**UI Design**: `docs/superpowers/specs/2026-05-31-vscode-extension-ui-design.md`

---

## 1. Context

Fliwright already has the core pieces needed for an AI-era Flutter E2E workflow:

- `@fliwright/core`: VM Service connection, page/locator API, recorder, mock manager, self-healing, form helper.
- `@fliwright/vitest`: test execution integration.
- `@fliwright/mcp`: AI agent loop, including `fliwright_run`, `fliwright_get_failure`, and `fliwright_generate_test`.
- Dart bridge: Flutter-side VM Service extensions and recording hooks.

The PRD calls for a VS Code plugin with a side-panel test surface, Webview recording/trace experience, and one-click sandbox controls. This design keeps the extension as a thin client shell. It must not reimplement runner, selector, self-healing, or mock logic already owned by core packages.

---

## 2. Product Goal

Give Flutter developers a local quality-control cockpit inside VS Code:

1. Connect to a running Flutter VM Service.
2. Run Fliwright tests from a test explorer or current editor.
3. Record device interactions and insert generated `.test.ts` code.
4. Inspect failures with screenshot/widget tree/self-healing suggestions.
5. Start, stop, and inspect sandbox/mock state.
6. Trigger form-helper fill plans during manual debugging.

The extension is optimized for local development and AI-assisted coding. CI remains CLI-owned. Agent-to-tool automation remains MCP-owned.

---

## 3. Non-Goals

- No independent test runner implementation.
- No Flutter device manager replacement for the official Flutter extension.
- No bundled LLM provider or AI chat UI.
- No long-lived cloud service.
- No Electron-grade advanced dashboard in MVP.
- No production release-mode instrumentation.

---

## 4. Package Structure

New package:

```text
packages/fliwright-vscode/
├── src/
│   ├── extension.ts              # VS Code activation and command registration
│   ├── config.ts                 # Workspace settings and config resolution
│   ├── session/
│   │   ├── FliwrightSession.ts    # Driver lifecycle, VM connection state
│   │   ├── VmServiceDiscovery.ts  # URL discovery and validation
│   │   └── WorkspaceState.ts      # persisted extension state
│   ├── runner/
│   │   ├── TestRunner.ts          # interface used by UI/controllers
│   │   ├── VitestRunner.ts        # MVP runner using vitest JSON reporter
│   │   └── CliRunner.ts           # future adapter for @fliwright/cli
│   ├── recorder/
│   │   └── RecorderService.ts     # driver.recorder orchestration + file insertion
│   ├── sandbox/
│   │   └── SandboxService.ts      # mock manager and sandbox commands
│   ├── form/
│   │   └── FormHelperService.ts   # extract fields + fill generated values
│   ├── views/
│   │   ├── DevicesTreeProvider.ts
│   │   ├── TestsTreeProvider.ts
│   │   ├── RunsTreeProvider.ts
│   │   └── SandboxTreeProvider.ts
│   ├── webview/
│   │   ├── WebviewRouter.ts
│   │   ├── TraceViewerPanel.ts
│   │   ├── FailurePanel.ts
│   │   └── RecordingPanel.ts
│   └── types.ts
├── media/
│   ├── main.css
│   └── webview.js
├── package.json
├── tsconfig.json
└── README.md
```

Workspace registration:

- Add `packages/fliwright-vscode` to the existing `packages/*` workspace automatically via current `pnpm-workspace.yaml`.
- Keep `vscode` APIs in the extension package only.
- Depend on workspace packages through `workspace:*`.

---

## 5. User Experience

### 5.1 Activity Bar

Add a `Fliwright` Activity Bar container with four views:

| View | Purpose |
|------|---------|
| Devices | VM Service connection, current app/session status |
| Tests | Discovered Fliwright test files and test cases |
| Runs | Recent run results and failure context |
| Sandbox | Mock routes, state adapters, and form-helper actions |

### 5.2 Status Bar

Status item examples:

- `Fliwright: Disconnected`
- `Fliwright: ws://127.0.0.1:8181/ws`
- `Fliwright: Recording`
- `Fliwright: 12 passed, 1 failed`

Clicking the status item opens the connection quick pick.

### 5.3 Commands

| Command ID | Label | Behavior |
|------------|-------|----------|
| `fliwright.connect` | Connect to VM Service | Prompt or auto-discover VM URL, then create `FliwrightDriver` |
| `fliwright.disconnect` | Disconnect | Dispose driver and clear session |
| `fliwright.discoverVmService` | Discover VM Service | Scan known local VM Service endpoints |
| `fliwright.runCurrentTest` | Run Current Test | Run active `*.test.ts` file |
| `fliwright.runWorkspaceTests` | Run Workspace Tests | Run configured glob |
| `fliwright.openFailure` | Open Failure Context | Open failure Webview for selected failed test |
| `fliwright.startRecording` | Start Recording | Call `driver.recorder.start()` and open recording panel |
| `fliwright.stopRecording` | Stop Recording | Stop recorder and preview generated test |
| `fliwright.insertRecordedTest` | Insert Recorded Test | Insert generated code into active editor or create a test file |
| `fliwright.startSandbox` | Start Sandbox | Apply configured mock routes/state setup |
| `fliwright.stopSandbox` | Stop Sandbox | Clear routes and reset sandbox state |
| `fliwright.fillForm` | Fill Current Form | Extract form fields and inject generated values |
| `fliwright.configureMcp` | Configure MCP | Open instructions for adding Fliwright MCP to agent tools |

### 5.4 Editor CodeLens

For `*.test.ts` files importing `@fliwright/vitest`, show:

- `Run Fliwright Test`
- `Run Test With Failure Context`
- `Record After This Test`

CodeLens is a convenience layer only; all actions map to commands.

---

## 6. Architecture

```text
+-------------------------------------------------------------------+
| VS Code UI                                                        |
| - Activity Bar tree views                                         |
| - Status bar                                                      |
| - Webviews: Failure, Trace, Recording                             |
+-------------------------------------------------------------------+
                                |
                                | commands/events
                                v
+-------------------------------------------------------------------+
| Extension Host Services                                           |
| - FliwrightSession                                                |
| - TestRunner adapter                                              |
| - RecorderService                                                 |
| - SandboxService                                                  |
| - FormHelperService                                               |
+-------------------------------------------------------------------+
                                |
             +------------------+------------------+
             |                                     |
             v                                     v
+----------------------------+        +-----------------------------+
| @fliwright/core            |        | Vitest / future CLI         |
| - FliwrightDriver          |        | - run test files            |
| - RecorderController       |        | - JSON result output        |
| - MockManager              |        | - failure context file      |
| - FormHelper               |        +-----------------------------+
+----------------------------+
             |
             | Dart VM Service WebSocket
             v
+-------------------------------------------------------------------+
| Running Flutter App with fliwright_bridge extensions              |
+-------------------------------------------------------------------+
```

### 6.1 Execution Boundary

The extension owns:

- VS Code UI state.
- Workspace discovery.
- Command routing.
- Webview rendering.
- Process orchestration for test runs.

Core/MCP/Vitest own:

- VM protocol calls.
- Locator behavior.
- Recording event processing and code generation.
- Assertion, failure collection, self-healing, and mock behavior.
- Agent-facing tool contracts.

### 6.2 Runner Strategy

MVP runner:

- Use a local `VitestRunner` adapter.
- Spawn Node with `vitest run <testFile> --reporter=json`.
- Set `FLIWRIGHT_VM_URL`.
- Set `FLIWRIGHT_MCP_FAILURE_CONTEXT_PATH` so `@fliwright/vitest` can persist structured failure context.
- Parse the same result/failure shapes used by `@fliwright/mcp`.

Future runner:

- Switch default to `CliRunner` once `@fliwright/cli` lands.
- Preserve the `TestRunner` interface so UI code does not change.

```typescript
export interface TestRunner {
  run(params: RunParams): Promise<RunResult>;
}
```

---

## 7. Data Model

### 7.1 Session State

```typescript
export interface FliwrightSessionState {
  status: 'disconnected' | 'connecting' | 'connected' | 'recording' | 'running';
  vmServiceUrl: string | null;
  connectedAt?: string;
  lastError?: string;
}
```

### 7.2 Run Result

Align with `@fliwright/mcp`:

```typescript
export interface RunResult {
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

### 7.3 Failure Entry

Align with `@fliwright/mcp`:

```typescript
export interface FailureEntry {
  testName: string;
  assertion: {
    matcher: string;
    expected: string;
    actual: string;
    timeout: number;
  };
  widgetTree: unknown;
  source: {
    file: string;
    line: number;
    snippet: string;
  };
  healingSuggestion?: {
    originalSelector: string;
    suggestedSelector: string;
    confidence: number;
    scores: Record<string, number>;
  };
  screenshotPath?: string;
  timestamp: string;
}
```

### 7.4 Recording Session

```typescript
export interface RecordingSession {
  startedAt: string;
  rawEventCount: number;
  operationCount: number;
  generatedCode?: string;
  targetFile?: string;
}
```

---

## 8. Configuration

VS Code settings:

| Setting | Default | Description |
|---------|---------|-------------|
| `fliwright.vmServiceUrl` | `null` | Explicit Dart VM Service URL |
| `fliwright.autoDiscoverVmService` | `true` | Try known local VM Service ports before prompting |
| `fliwright.testGlob` | `tests/**/*.test.ts` | Workspace test discovery glob |
| `fliwright.runner` | `vitest` | `vitest` for MVP, `cli` after CLI package exists |
| `fliwright.screenshotMode` | `file` | `file`, `base64`, or `off` |
| `fliwright.failureContextDir` | `.fliwright/failures` | Failure context output directory |
| `fliwright.traceDir` | `.fliwright/traces` | Future trace output directory |
| `fliwright.mockConfig` | `fliwright.mock.json` | Sandbox route/state configuration file |

Resolution priority for VM URL:

1. Command argument / prompt value.
2. `fliwright.vmServiceUrl`.
3. `FLIWRIGHT_VM_URL`.
4. Auto-discovery.

---

## 9. Webview Design

### 9.1 Failure Panel

Purpose: explain what failed and provide actionable repair context.

Sections:

- Test name and status.
- Assertion summary.
- Screenshot, if available.
- Source location with `Open File` command.
- Widget tree JSON viewer.
- Self-healing suggestion with confidence and selector replacement.
- Copy buttons for suggested selector and failure JSON.

Messages:

```typescript
type FailureWebviewMessage =
  | { type: 'openSource'; file: string; line: number }
  | { type: 'copySelector'; selector: string }
  | { type: 'applySelector'; file: string; line: number; from: string; to: string };
```

`applySelector` is opt-in. It should open a diff preview before editing user code.

### 9.2 Recording Panel

Purpose: keep recording state visible and preview generated code.

States:

- Idle: connect first or start recording.
- Recording: event/operation counters and stop button.
- Preview: generated `.test.ts` code with insert/create actions.
- Error: VM extension not available or no active session.

Messages:

```typescript
type RecordingWebviewMessage =
  | { type: 'start' }
  | { type: 'stop' }
  | { type: 'insert'; mode: 'activeEditor' | 'newFile' };
```

### 9.3 Trace Viewer

MVP trace viewer is failure-oriented:

- Timeline of test cases.
- Failure entries.
- Screenshots and widget tree snapshots.

Full Playwright-style trace playback is V1 scope after trace artifacts are standardized.

---

## 10. Sandbox Design

MVP sandbox features:

1. Load mock config file from `fliwright.mock.json`.
2. Apply network routes through `driver.mock`.
3. Clear active routes.
4. Show active route count and last applied config path.

Example config:

```json
{
  "routes": [
    {
      "method": "GET",
      "url": "/api/me",
      "status": 200,
      "body": { "id": "user_1", "name": "Demo User" }
    }
  ]
}
```

State injection and hardware mocks should be shown as disabled tree items until their adapters are stable.

---

## 11. Form Helper Design

Command flow for `fliwright.fillForm`:

1. Ensure connected session.
2. Request current form/widget metadata from bridge.
3. Pass metadata to `FormHelper`.
4. Show a quick preview of generated values.
5. Inject values through existing page/locator/type APIs.

The form-helper service should use the same JSON rule files as TS tests. The extension only chooses when to call it.

---

## 12. Error Handling

Common user-facing errors:

| Error | Message Direction |
|-------|-------------------|
| No workspace | Ask user to open a Flutter/Fliwright workspace |
| No VM Service URL | Show connect prompt and `flutter run` hint |
| VM connection refused | Keep previous URL, offer retry/discover |
| Bridge extension missing | Explain `test_driver/fliwright_app.dart` setup requirement |
| Vitest missing | Ask user to install project dependencies |
| Test JSON parse failed | Show raw output in an OutputChannel |
| Recorder unavailable | Check bridge version and connection state |

All detailed logs go to a `Fliwright` OutputChannel. Notifications should stay short.

---

## 13. Security and Workspace Trust

- Respect VS Code Workspace Trust. Disable process spawning and file edits in untrusted workspaces.
- Never execute arbitrary command strings from config.
- Use `spawn` with argument arrays, not shell execution.
- Keep generated failure artifacts under workspace-local `.fliwright/`.
- Do not send source, screenshots, or widget trees to any network service.
- Do not auto-edit tests from self-healing suggestions without explicit user action and diff preview.

---

## 14. Implementation Order

### 14.1 Iteration VS-A: Extension Shell

User gets: extension activates, Activity Bar exists, connection state is visible.

- Scaffold `packages/fliwright-vscode`.
- Register commands and tree views.
- Add config loader and status bar.
- Add OutputChannel logging.

### 14.2 Iteration VS-B: VM Connection

User gets: connect/disconnect to running Flutter app.

- Implement `FliwrightSession`.
- Implement VM Service URL validation and discovery.
- Surface bridge-missing errors clearly.
- Add unit tests for config/discovery/session state transitions.

### 14.3 Iteration VS-C: Test Run Panel

User gets: run current test/workspace tests and inspect pass/fail results.

- Implement `TestRunner` + `VitestRunner`.
- Discover test files by glob.
- Populate Tests and Runs tree views.
- Store last failure entries.
- Open source location from failed test.

### 14.4 Iteration VS-D: Failure Webview

User gets: structured failure panel with screenshot/widget tree/healing suggestions.

- Implement `FailurePanel`.
- Render `FailureEntry`.
- Add copy/open-source/apply-selector actions.
- Gate code edits behind diff preview.

### 14.5 Iteration VS-E: Recording Codegen

User gets: start/stop recording and insert generated test code.

- Implement `RecorderService`.
- Add recording panel and status updates.
- Insert generated code into active editor or create a new test file.
- Add tests with a mocked `RecorderController`.

### 14.6 Iteration VS-F: Sandbox and Form Helper

User gets: apply/clear mock routes and fill current form.

- Implement `SandboxService`.
- Parse `fliwright.mock.json`.
- Implement `FormHelperService`.
- Add disabled placeholders for future state/hardware adapters.

---

## 15. Test Strategy

Use `@vscode/test-electron` for extension integration tests and Vitest for pure service tests.

Recommended coverage:

- Config resolution.
- VM URL discovery.
- Session state transitions.
- Runner JSON parsing.
- Failure context loading.
- Tree provider rendering.
- Webview message handling.
- Recorder insert behavior.

Manual verification:

1. Start `examples/riverpod_demo` with the Fliwright bridge entrypoint.
2. Connect from the extension.
3. Run an existing Fliwright test.
4. Force one assertion failure and inspect the failure panel.
5. Record a short tap/type flow and insert generated code.
6. Apply and clear mock routes from the Sandbox view.

---

## 16. Open Decisions

| Decision | Proposed Default |
|----------|------------------|
| Test discovery parser | Start with file glob, add AST test case discovery later |
| Runner backend | Vitest in MVP, CLI after `@fliwright/cli` exists |
| Trace artifact format | Reuse failure context first, define full trace later |
| MCP integration in extension | Documentation/config helper only; do not run MCP client inside extension |
| Selector auto-apply | Diff preview required |
| Flutter extension dependency | Recommend but do not hard-require |
