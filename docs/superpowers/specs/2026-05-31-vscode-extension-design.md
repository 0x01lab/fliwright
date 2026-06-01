# VS Code Extension Design

**Date**: 2026-05-31  
**Status**: Draft, revised for Mock/Form-first MVP  
**Scope**: VS Code extension MVP design, prioritizing Mock management configuration and Form Helper workflows  
**Depends on**: `@fliwright/core`, `@fliwright/vitest`, `@fliwright/mcp`, Recording/Codegen, Form Helper, Self-Healing  
**UI Design**: `docs/superpowers/specs/2026-05-31-vscode-extension-ui-design.md`

---

## 1. Context

Fliwright already has the core pieces needed for an AI-era Flutter E2E workflow:

- `@fliwright/core`: VM Service connection, page/locator API, recorder, mock manager, self-healing, form helper.
- `@fliwright/vitest`: test execution integration.
- `@fliwright/mcp`: AI agent loop, including `fliwright_run`, `fliwright_get_failure`, and `fliwright_generate_test`.
- Dart bridge: Flutter-side VM Service extensions and recording hooks.

The PRD calls for a VS Code plugin with a side-panel test surface, Webview recording/trace experience, and one-click sandbox controls. The first implementation slice prioritizes local test setup workflows: managing `.fliwright/mocks/**/*.json` and triggering `.fliwright/forms/**/*.json` based form filling. This design keeps the extension as a thin client shell. It must not reimplement runner, selector, self-healing, form generation, or mock execution logic already owned by core packages.

---

## 2. Product Goal

Give Flutter developers a local quality-control cockpit inside VS Code. For the Mock/Form-first MVP, the highest-priority workflows are:

1. Connect to a running Flutter VM Service.
2. Scan, preview, validate, apply, and clear API Mock JSON files under `.fliwright/mocks/`.
3. Scan, preview, analyze, and apply Form Helper JSON rules under `.fliwright/forms/`.
4. Show active mock routes and form-fill results in the sidebar and OutputChannel.

The broader extension then expands into the full quality loop:

1. Run Fliwright tests from a test explorer or current editor.
2. Record device interactions and insert generated `.test.ts` code.
3. Inspect failures with screenshot/widget tree/self-healing suggestions.

The extension is optimized for local development and AI-assisted coding. CI remains CLI-owned. Agent-to-tool automation remains MCP-owned.

---

## 3. Non-Goals

- No independent test runner implementation.
- No Flutter device manager replacement for the official Flutter extension.
- No bundled LLM provider or AI chat UI.
- No long-lived cloud service.
- No Electron-grade advanced dashboard in MVP.
- No production release-mode instrumentation.
- No backward compatibility with legacy YAML mock files. API Mock configuration is JSON-only.

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
│   │   ├── MockConfigService.ts   # .fliwright/mocks JSON discovery and validation
│   │   └── SandboxService.ts      # mock manager and sandbox commands
│   ├── form/
│   │   ├── FormRuleService.ts     # .fliwright/forms JSON discovery and validation
│   │   └── FormHelperService.ts   # extract fields + fill generated values
│   ├── views/
│   │   ├── DevicesTreeProvider.ts
│   │   ├── MockApiTreeProvider.ts
│   │   ├── FormDataTreeProvider.ts
│   │   ├── TestsTreeProvider.ts
│   │   └── RunsTreeProvider.ts
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

Add one `Fliwright` Activity Bar View Container. Inside it, contribute separate native Tree Views for each data domain:

| View | Purpose |
|------|---------|
| Devices | VM Service connection, current app/session status |
| Mock APIs | API Mock endpoint/rule list from `.fliwright/mocks/api/*.json` |
| Form Data | Form rule files and generated form-fill previews from `.fliwright/forms/*.json` |
| Tests | Discovered Fliwright test files and test cases |
| Runs | Recent run results and failure context |

Mock/Form-first MVP default order:

1. Devices
2. Mock APIs
3. Form Data
4. Tests
5. Runs

This follows VS Code's workbench pattern: one Activity Bar container groups related Fliwright views, while Tree Views display structured workspace data. Webviews are reserved for detailed failure/trace/recording screens, not for the primary sidebar.

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
| `fliwright.reloadMocks` | Reload Mock Configs | Re-scan `.fliwright/mocks/**/*.json` |
| `fliwright.applyMockRule` | Apply Mock Rule | Apply a selected endpoint/rule pair through `driver.mock.route()` |
| `fliwright.applyDefaultMocks` | Apply Default Mocks | Apply default rules from `.fliwright/mocks/mock-index.json` or each endpoint's first rule |
| `fliwright.openMockConfig` | Open Mock Config | Open the selected Mock JSON file |
| `fliwright.createMockConfig` | Create Mock Config | Create a JSON endpoint mock template under `.fliwright/mocks/api/` |
| `fliwright.fillForm` | Fill Current Form | Extract form fields and inject generated values |
| `fliwright.analyzeForm` | Analyze Current Form | Extract fields and preview generated values without filling |
| `fliwright.fillFormWithRules` | Fill Form With Rules | Fill current form using the selected form rules file |
| `fliwright.reloadFormRules` | Reload Form Rules | Re-scan `.fliwright/forms/**/*.json` |
| `fliwright.openFormRules` | Open Form Rules | Open the selected form rules JSON file |
| `fliwright.createFormRules` | Create Form Rules | Create a `FormRulesFile` template under `.fliwright/forms/` |
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
| - Activity Bar View Container: Fliwright                          |
| - Tree Views: Devices, Mock APIs, Form Data, Tests, Runs          |
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

### 6.3 VS Code Contribution Points

The extension should use standard VS Code contribution points:

- `contributes.viewsContainers.activitybar`: adds the `Fliwright` Activity Bar container.
- `contributes.views`: contributes `fliwright.devices`, `fliwright.mockApis`, `fliwright.formData`, `fliwright.tests`, and `fliwright.runs`.
- `contributes.commands`: declares all command palette and tree-item commands.
- `contributes.menus.view/title`: adds per-view toolbar actions such as reload, create, apply defaults, and clear.
- `contributes.menus.view/item/context`: adds context actions for endpoint rows, mock rule rows, and form rule rows using `contextValue`.
- `contributes.configuration`: declares `fliwright.*` settings.
- `activationEvents`: activate on Fliwright commands and when the workspace contains `.fliwright`, `fliwright.config.*`, or `package.json` dependencies on Fliwright packages.

Sketch:

```json
{
  "contributes": {
    "viewsContainers": {
      "activitybar": [
        { "id": "fliwright", "title": "Fliwright", "icon": "media/fliwright.svg" }
      ]
    },
    "views": {
      "fliwright": [
        { "id": "fliwright.devices", "name": "Devices" },
        { "id": "fliwright.mockApis", "name": "Mock APIs" },
        { "id": "fliwright.formData", "name": "Form Data" },
        { "id": "fliwright.tests", "name": "Tests" },
        { "id": "fliwright.runs", "name": "Runs" }
      ]
    }
  },
  "activationEvents": [
    "onView:fliwright.mockApis",
    "onView:fliwright.formData",
    "onCommand:fliwright.connect"
  ]
}
```

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

### 7.5 Mock Config

API Mock configuration is JSON-only and lives under `.fliwright/mocks/`.

```typescript
export interface MockIndexFile {
  version: 1;
  defaultRule?: string;
  files: string[];
}

export interface MockEndpointFile {
  version: 1;
  name: string;
  description?: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
  endpoint: string;
  rules: MockRule[];
}

export interface MockRule {
  name: string;
  status: number;
  delay?: number;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface MockConfigEntry {
  file: string;
  endpoint: string;
  method: string;
  rule: MockRule;
  applied: boolean;
}
```

Rules map directly to `MockManager`:

```typescript
await driver.mock.route(endpoint, {
  method,
  status: rule.status,
  delay: rule.delay,
  headers: rule.headers,
  body: rule.body,
});
```

### 7.6 Form Rules

Form rules are JSON-only and live under `.fliwright/forms/`. They reuse the existing `FormRulesFile` schema from `@fliwright/core`.

```typescript
export interface FormRulesFile {
  version: 1;
  locale?: string;
  rules: Array<{
    match: Record<string, string>;
    type: 'PRESET_SKILL' | 'REGEXP_MOCK' | 'LLM_GENERATE';
    data?: string[];
    pattern?: string;
  }>;
}

export interface FormRuleEntry {
  file: string;
  locale?: string;
  ruleCount: number;
  valid: boolean;
  error?: string;
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
| `fliwright.mockDir` | `.fliwright/mocks` | API Mock JSON directory |
| `fliwright.mockIndex` | `.fliwright/mocks/mock-index.json` | Optional mock index file |
| `fliwright.formRulesDir` | `.fliwright/forms` | Form Helper JSON rules directory |
| `fliwright.formRulesFile` | `null` | Optional single form rules file override |
| `fliwright.formLocale` | `zh_CN` | Default locale used by Form Helper |
| `fliwright.formPreviewBeforeFill` | `true` | Analyze and preview generated values before filling |

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

Mock/Form-first MVP sandbox features:

1. Scan `.fliwright/mocks/api/*.json`.
2. Optionally load `.fliwright/mocks/mock-index.json` to define enabled files and default rule names.
3. Validate each endpoint file and show invalid files in the Sandbox tree.
4. Apply one selected endpoint/rule pair through `driver.mock.route()`.
5. Apply all indexed endpoint files using the default rule.
6. Clear active routes through `driver.mock.clear()`.
7. Show active route count, selected rule names, and last applied file path.

Endpoint file:

```json
{
  "version": 1,
  "name": "Get Token List",
  "method": "GET",
  "endpoint": "/v1/public/token",
  "rules": [
    {
      "name": "success",
      "status": 200,
      "delay": 0,
      "headers": {
        "Content-Type": "application/json"
      },
      "body": {
        "success": true,
        "data": { "rows": [] }
      }
    }
  ]
}
```

`MockConfigService` responsibilities:

- Resolve `fliwright.mockDir` relative to the workspace root.
- Discover endpoint files using VS Code workspace file APIs.
- Parse JSON with useful file/line errors.
- Validate `version`, `method`, `endpoint`, `rules[].name`, and `rules[].status`.
- Return tree-friendly `MockConfigEntry[]`.
- Create endpoint templates only after explicit user action.

`SandboxService` responsibilities:

- Require a connected `FliwrightSession`.
- Convert selected `MockRule` to `MockManager.route()` calls.
- Track applied entries in extension state.
- Call `driver.mock.listRoutes()` after apply/clear and refresh the tree.
- Write full apply/validation logs to the `Fliwright` OutputChannel.

State injection and hardware mocks should be shown as disabled tree items until their adapters are stable.

---

## 11. Form Helper Design

Command flow for `fliwright.fillForm`:

1. Ensure connected session.
2. Resolve rule source:
   - Use `fliwright.formRulesFile` when configured.
   - Otherwise use `fliwright.formRulesDir`, defaulting to `.fliwright/forms`.
3. Call `driver.page.formHelper.analyze({ rulesFile | rulesDir, locale })` or construct `FormHelper` with the session `sendRequest`.
4. Show a Quick Pick preview of fields, semantic types, and generated values.
5. If confirmed, call `fill({ rulesFile | rulesDir, locale })`.
6. Show filled/skipped/error counts in the Sandbox tree and OutputChannel.

Command flow for `fliwright.analyzeForm`:

1. Ensure connected session.
2. Call `FormHelper.analyze()`.
3. Show generated values without mutating the app.
4. Offer a follow-up action to fill the form.

`FormRuleService` responsibilities:

- Resolve `fliwright.formRulesDir` relative to the workspace root.
- Discover `.json` files under `.fliwright/forms`.
- Validate the existing `FormRulesFile` schema.
- Create a template form rule file only after explicit user action.

`FormHelperService` responsibilities:

- Require a connected `FliwrightSession`.
- Pass the selected `rulesFile` or `rulesDir` to `FormHelper`.
- Respect `fliwright.formLocale` and `fliwright.formPreviewBeforeFill`.
- Never fill obscure/password fields unless the user explicitly changes the option.
- Keep generated values local; do not send field metadata or values to network services.

---

## 12. Error Handling

Common user-facing errors:

| Error | Message Direction |
|-------|-------------------|
| No workspace | Ask user to open a Flutter/Fliwright workspace |
| No VM Service URL | Show connect prompt and `flutter run` hint |
| VM connection refused | Keep previous URL, offer retry/discover |
| Bridge extension missing | Explain `test_driver/fliwright_app.dart` setup requirement |
| Mock directory missing | Offer to create `.fliwright/mocks/api` and a JSON endpoint template |
| Mock JSON invalid | Show concise parse error in tree, full stack/details in OutputChannel |
| Mock rule invalid | Keep file visible with warning, disable Apply for that rule |
| No mock rule selected | Open Quick Pick listing endpoint/rule pairs |
| Form rules directory missing | Offer to create `.fliwright/forms` and a JSON rule template |
| Form rules invalid | Show invalid file in tree, fall back to built-in generator only after user confirmation |
| Form extraction failed | Explain bridge setup or current screen has no supported fields |
| No form fields found | Show non-error information message |
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

### 14.1 Iteration VS-A: Extension Shell + Local Asset Discovery

User gets: extension activates, Activity Bar exists, `.fliwright` Mock/Form files are visible.

- Scaffold `packages/fliwright-vscode`.
- Register commands and tree views.
- Add config loader and status bar.
- Add OutputChannel logging.
- Implement `MockConfigService` discovery/validation for `.fliwright/mocks/api/*.json`.
- Implement `FormRuleService` discovery/validation for `.fliwright/forms/*.json`.
- Add create-template commands for Mock endpoint files and Form rules.

### 14.2 Iteration VS-B: VM Connection + Mock Apply/Clear

User gets: connect/disconnect to a running Flutter app and apply/clear API Mock routes.

- Implement `FliwrightSession`.
- Implement VM Service URL validation and discovery.
- Surface bridge-missing errors clearly.
- Add unit tests for config/discovery/session state transitions.
- Implement `SandboxService.applyMockRule()`, `applyDefaultMocks()`, and `clearMocks()`.
- Populate Sandbox tree with configured endpoints, rules, active/applied markers, and validation warnings.
- Add unit tests for JSON parsing, schema validation, rule-to-`MockManager.route()` mapping, and active-state tracking.

### 14.3 Iteration VS-C: Form Analyze/Fill

User gets: inspect generated form values and fill the current Flutter screen from `.fliwright/forms`.

- Implement `FormHelperService.analyzeCurrentForm()` and `fillCurrentForm()`.
- Show preview Quick Pick when `fliwright.formPreviewBeforeFill` is enabled.
- Populate Sandbox tree with last form analyze/fill summary.
- Add tests with a mocked `FormHelper`/session sendRequest.

### 14.4 Iteration VS-D: Test Run Panel

User gets: run current test/workspace tests and inspect pass/fail results.

- Implement `TestRunner` + `VitestRunner`.
- Discover test files by glob.
- Populate Tests and Runs tree views.
- Store last failure entries.
- Open source location from failed test.

### 14.5 Iteration VS-E: Failure Webview

User gets: structured failure panel with screenshot/widget tree/healing suggestions.

- Implement `FailurePanel`.
- Render `FailureEntry`.
- Add copy/open-source/apply-selector actions.
- Gate code edits behind diff preview.

### 14.6 Iteration VS-F: Recording Codegen

User gets: start/stop recording and insert generated test code.

- Implement `RecorderService`.
- Add recording panel and status updates.
- Insert generated code into active editor or create a new test file.
- Add tests with a mocked `RecorderController`.

---

## 15. Test Strategy

Use `@vscode/test-electron` for extension integration tests and Vitest for pure service tests.

Recommended coverage:

- Config resolution.
- Mock JSON discovery and validation.
- Mock index loading and default-rule selection.
- Mock rule application mapping to `MockManager.route()`.
- Form rules discovery and validation.
- Form analyze/fill preview flow.
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
3. Create or open `.fliwright/mocks/api/get-token.example.json`.
4. Apply the `success` mock rule, verify `driver.mock.listRoutes()` shows the active route, then clear it.
5. Create or open `.fliwright/forms/form-rules.example.json`.
6. Analyze the current form, preview generated values, then fill the form.
7. Run an existing Fliwright test.
8. Force one assertion failure and inspect the failure panel.
9. Record a short tap/type flow and insert generated code.

---

## 16. Open Decisions

| Decision | Proposed Default |
|----------|------------------|
| API Mock config format | JSON only, no YAML compatibility |
| Mock config location | `.fliwright/mocks/api/*.json` plus optional `.fliwright/mocks/mock-index.json` |
| Form rules location | `.fliwright/forms/*.json` |
| First implementation slice | Mock management and Form Helper before test runner/recording |
| Test discovery parser | Start with file glob, add AST test case discovery later |
| Runner backend | Vitest in MVP, CLI after `@fliwright/cli` exists |
| Trace artifact format | Reuse failure context first, define full trace later |
| MCP integration in extension | Documentation/config helper only; do not run MCP client inside extension |
| Selector auto-apply | Diff preview required |
| Flutter extension dependency | Recommend but do not hard-require |
