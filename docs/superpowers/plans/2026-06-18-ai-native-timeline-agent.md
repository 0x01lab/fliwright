# AI Native Timeline Agent Implementation Plan

> **For agentic workers:** implement this plan task-by-task. Keep each slice small, add regression tests for every public runtime/tool behavior, and update `docs/features/` after stable source changes. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade Fliwright from a Flutter automation runtime with AI helpers into an **AI-native Flutter automation and E2E testing tool** whose scripts/tests are executable, visualizable timelines. Scripts should be organized by page/frame/step/branch instead of flat imperative code, E2E tests should have first-class assertions, and AI should participate through both explicit script calls and passive, agent-readable runtime failures.

**Core idea:** Timeline is the structural backbone; AI Agent is the runtime collaborator. Every test run should produce a structured timeline that an editor, MCP client, or external AI agent can inspect, discuss, retry, and repair from.

**Architecture:** Add a `FlowRuntime`, `MockRuntime`, `AssertRuntime`, and `TimelineRecorder` in `@fliwright/core`, expose `{ flow, mock, agent, assert }` fixtures from `@fliwright/vitest`, emit `timeline.json` and artifacts under `.fliwright/runs/<runId>/`, and enrich failures as `FliwrightAgentError` / `agentVisibleFailures`. MockRuntime is a timeline-aware facade over the existing `driver.mock`, `MockManager`, `MockRuleStore`, Flutter mock store, Dio mock, and tool-side fallback server. Active AI calls (`agent.generate`, `agent.verify`, `agent.ask`) are explicit script/test steps. Assertions produce timeline nodes and structured failures. Passive AI v0 does not call a model; it structures runtime errors so external agents can read logs and artifacts. Later passive AI phases add framework-side diagnosis and controlled runtime repair.

**Tech Stack:** TypeScript ESM, Node16 module resolution, Vitest, existing `AiRuntime`, `TraceCollector`, `FailureCollector`, `RecorderController`, `page.snapshot()`, screenshots, CLI runner, MCP tools.

**Motivating example:** `exio_app/.fliwright/scripts/auto-register-fill.mjs` is currently a 595-line imperative script that mixes data generation, validation, navigation fallbacks, form filling, screenshots, and runtime config. The target model should represent this as a timeline:

```text
Script: auto register fill
  Step: Generate register data
  Page: Register
    Branch: route navigation failed -> fallback UI navigation
    Frame: Register form visible
    Step: Fill credentials
    Step: Fill optional referral
    Step: Toggle marketing opt-in
    Frame: Register form filled
    Optional Step: Submit
```

---

## Target User API

Fliwright must support two first-class modes on the same timeline/agent foundation:

1. **Automation Script Mode**: used for operating an app, filling forms, collecting data, preparing state, smoke-driving workflows, or doing arbitrary runtime tasks. Assertions are optional. A script may pass if it completes the requested automation.
2. **E2E Test Framework Mode**: used for verification. Assertions are required to express expected UI, state, network/mock, semantic, or AI-visual outcomes. A test passes only when its actions and assertions pass.

Both modes should produce the same timeline format. The difference is the pass/fail contract: automation primarily validates task completion; E2E validates explicit assertions.

### Automation Script Mode

Automation scripts should be small and readable:

```typescript
script('auto register fill', async ({ flow, page, mock, agent }) => {
  const user = await flow.step('Generate register data', async () => {
    return agent.generate('Generate register payload', {
      schema: registerDataSchema,
      fallback: fallbackRegisterData(),
    });
  });

  await flow.page('Register', { route: '/register' }, async () => {
    await mock.rules('Use successful registration API', async () => {
      await mock.loadRules('.fliwright/mocks');
      await mock.switchRule('/api/register', 'success', 'POST');
    });

    await flow.step('Navigate to register', async () => {
      await page.goto('/register', {
        waitFor: { key: 'usernameField' },
        throwOnSettleTimeout: true,
      });
    });

    await flow.frame('Register form visible', { screenshot: true, snapshot: true });

    await flow.step('Fill credentials', async () => {
      await page.getByKey('usernameField').fill(user.username);
      await page.getByKey('emailField').fill(user.email);
      await page.getByKey('passwordField').fill(user.password);
      await page.getByKey('passwordConfirmField').fill(user.passwordConfirm);
    });

    await flow.frame('Filled form', { screenshot: true, snapshot: true });

    await flow.optional('Submit', { when: process.env.REGISTER_SUBMIT === 'true' }, async () => {
      await page.getByText(/Next|下一步/i).click();
    });
  });
});
```

### E2E Test Framework Mode

E2E tests use the same structure, but add first-class assertions:

```typescript
test('register enables next after valid credentials', async ({ flow, page, mock, agent, assert }) => {
  const user = await flow.step('Generate register data', async () => {
    return agent.generate('Generate register payload', {
      schema: registerDataSchema,
      fallback: fallbackRegisterData(),
    });
  });

  await flow.page('Register', { route: '/register' }, async () => {
    await mock.rules('Use successful registration API', async () => {
      await mock.loadRules('.fliwright/mocks');
      await mock.switchRule('/api/register', 'success', 'POST');
    });

    await flow.step('Fill credentials', async () => {
      await page.getByKey('usernameField').fill(user.username);
      await page.getByKey('emailField').fill(user.email);
      await page.getByKey('passwordField').fill(user.password);
      await page.getByKey('passwordConfirmField').fill(user.passwordConfirm);
    });

    await assert.visible('Next button is visible', page.getByText(/Next|下一步/i));
    await assert.enabled('Next button is enabled', page.getByText(/Next|下一步/i));
    await assert.request('Register API was called', {
      path: '/api/register',
      method: 'POST',
    });
    await assert.ai('No validation error is visible on the filled register form', {
      includeScreenshot: true,
      includeSnapshot: true,
    });
  });
});
```

Later, recorded/code-generated automation scripts and E2E tests should produce this structure by default:

```typescript
await flow.step('Tap Register', async () => {
  await page.getByText('Register').click();
});
```

---

## Runtime Data Model

Add a timeline IR that is stable enough for UI, CLI, MCP, and AI agents.

```typescript
export type TimelineNodeKind =
  | 'script'
  | 'page'
  | 'frame'
  | 'step'
  | 'branch'
  | 'optional'
  | 'assertion'
  | 'action'
  | 'mock'
  | 'ai-call'
  | 'failure';

export interface TimelineNode {
  id: string;
  parentId?: string;
  kind: TimelineNodeKind;
  title: string;
  status: 'running' | 'passed' | 'failed' | 'skipped';
  startedAt: string;
  endedAt?: string;
  route?: string;
  codeRef?: CodeRef;
  artifacts?: TimelineArtifactRef[];
  metadata?: Record<string, unknown>;
  error?: AgentVisibleFailure;
}

export interface TimelineData {
  version: 1;
  runId: string;
  testName: string;
  mode: 'script' | 'test';
  status: 'running' | 'passed' | 'failed';
  startedAt: string;
  endedAt?: string;
  nodes: TimelineNode[];
  agentVisibleFailures?: AgentVisibleFailure[];
}
```

Every node must be useful without the source file open: title, status, time, artifacts, and enough error context for an AI agent.

---

## Assertion Library

Automation actions answer "what did we do?" E2E assertions answer "what did we prove?" The assertion library must be first-class and timeline-aware, not just a thin wrapper around thrown errors.

### Assertion Categories

1. **Deterministic UI assertions**
   - `assert.visible(title, locator, options?)`
   - `assert.hidden(title, locator, options?)`
   - `assert.enabled(title, locator, options?)`
   - `assert.disabled(title, locator, options?)`
   - `assert.text(title, locator, expected, options?)`
   - `assert.containsText(title, locator, expected, options?)`
   - `assert.count(title, locator, expected, options?)`

2. **Page/snapshot/semantic assertions**
   - `assert.snapshot(title, matcherOrPredicate, options?)`
   - `assert.semantic(title, matcher, options?)`
   - `assert.actionAvailable(title, query, options?)`
   - `assert.noErrorBanner(title, options?)`

3. **Mock/network assertions**
   - `assert.request(title, matcher, options?)`
   - `assert.noRequest(title, matcher, options?)`
   - `assert.requestCount(title, matcher, expected, options?)`

4. **State assertions**
   - `assert.state(title, providerName, matcher, options?)`
   - `assert.providerValue(title, providerName, expected, options?)`

5. **AI visual/semantic assertions**
   - `assert.ai(title, promptOrOptions, options?)`
   - `assert.visual(title, prompt, options?)`

### Assertion Timeline Nodes

Each assertion creates a `kind: 'assertion'` node:

```typescript
export interface AssertionMetadata {
  matcher: string;
  target?: string;
  expected?: unknown;
  actual?: unknown;
  aiAssisted?: boolean;
}
```

Example:

```json
{
  "kind": "assertion",
  "title": "Next button is enabled",
  "status": "passed",
  "metadata": {
    "matcher": "enabled",
    "target": "text=/Next|下一步/i"
  },
  "artifacts": [
    { "kind": "screenshot", "path": "artifacts/screenshots/assertion-next-button.png" }
  ]
}
```

Assertion failures become `AgentVisibleFailure` with `code: 'assertion_failed'`, current screenshot/snapshot where possible, matcher metadata, and recovery hints. This makes passive AI v0 useful for real E2E failures, not only automation action failures.

### Relationship To Existing `expect`

Keep the existing `expect(locator)` API for compatibility and self-healing. The new `assert` fixture is the timeline-native API. Internally, `assert.visible(...)` can reuse existing `Assertion`/`createExpect` logic so behavior stays consistent.

Long term, `expect(locator)` can optionally detect the current flow context and emit timeline assertion nodes, but the first slice should avoid breaking existing tests.

---

## Mock Runtime

Mocking is a first-class part of both automation scripts and E2E tests. Fliwright already has the core primitives:

- `driver.mock`: `MockManager`
- `.fliwright/mocks` rule files: `MockRuleStore`
- Flutter mock store via VM Service extensions
- Dio mock path
- tool-side fallback `ToolMockServer`
- MCP mock list/switch tools

The timeline work should **reuse these existing capabilities**, not introduce a new mock engine.

`MockRuntime` is a timeline-aware facade over `driver.mock`:

```typescript
await mock.loadRules('.fliwright/mocks');
await mock.switchRule('/api/register', 'success', 'POST');
await mock.route('/api/profile', { method: 'GET', status: 200, body: { name: 'Ada' } });
await mock.clearCalls();

await assert.request('Register API called', {
  path: '/api/register',
  method: 'POST',
  body: { email: user.email },
});
```

Recommended ergonomic wrapper:

```typescript
await mock.rules('Use successful registration API', async () => {
  await mock.loadRules('.fliwright/mocks');
  await mock.switchRule('/api/register', 'success', 'POST');
});
```

Each mock operation creates a `kind: 'mock'` or `kind: 'step'` timeline node with metadata:

```typescript
export interface MockTimelineMetadata {
  operation:
    | 'loadRules'
    | 'switchRule'
    | 'route'
    | 'removeRoute'
    | 'clearRoutes'
    | 'clearCalls'
    | 'setPassthrough'
    | 'getCalls';
  endpoint?: string;
  method?: string;
  ruleName?: string;
  mockDir?: string;
  routeCount?: number;
  callCount?: number;
  backend?: 'flutter' | 'dio' | 'tool-server';
}
```

Mock assertions should use the same normalized call shape whether the app uses HttpOverrides, Dio, or the tool-side fallback. This is why bridge-side mock call normalization is part of the first bridge work.

---

## Flutter Bridge Responsibilities

The TS runtime owns authoring ergonomics, timeline storage, AI calls, and report generation. The Flutter bridge owns runtime truth: rendered frames, widget semantics, actionability, navigation state, route information, mock/network observations, provider state, and low-level failure diagnostics.

The timeline feature cannot be TS-only. The bridge must expose richer, stable facts so the TS side does not infer too much from screenshots or ad hoc errors.

### Required Bridge Capabilities

1. **Runtime context**
   - Current route/location.
   - App lifecycle/frame state.
   - Bridge version and capability flags.
   - Current focused widget/input metadata.

2. **Frame capture**
   - Screenshot.
   - Agent snapshot (`ext.fliwright.snap`).
   - Optional legacy widget tree (`ext.fliwright.snapshot`).
   - Stable frame id or timestamp so screenshots/snapshots can be correlated.

3. **Action diagnostics**
   - Normalized action result for tap/type/drag/fill/navigation.
   - Actionability failure reason.
   - Target ref/selector metadata.
   - Before/after route and optional before/after snapshot summary.

4. **Assertion support**
   - Query widgets by key/text/type/semantics/ref and return normalized matches.
   - Count visible/hit-testable matches.
   - Return text/value/enabled/checked/actionable state.
   - Provide semantic action availability for `assert.actionAvailable`.

5. **Mock/network assertions**
   - Existing mock call logs must expose enough request details for `assert.request`.
   - Dio and HttpOverrides paths should return the same normalized call shape.

6. **State assertions**
   - Riverpod bridge should expose provider values/errors in a normalized debug-value shape.
   - TS `assert.state` must not depend on arbitrary string dumps when structured values are available.

7. **Agent-visible failure payloads**
   - Bridge errors should include stable `code`, `message`, `details`, and `recoveryHints`.
   - TS should wrap these into `FliwrightAgentError` instead of parsing fragile strings.

### Proposed Bridge Protocol Additions

Add or extend VM Service extensions:

```text
ext.fliwright.context
ext.fliwright.captureFrame
ext.fliwright.query
```

These can be implemented incrementally on top of existing extensions:

- `captureFrame` composes `screenshot`, `snap`, `snapshot`, `currentRoute`, diagnostics metadata.
- `query` reuses selector/inspect/ref resolution.
- Bridge-side `assert` is explicitly deferred for the first implementation. TS assertions use `query` results.
- Action diagnostics are returned inline from existing action/navigation RPCs instead of a new extension.

Example `captureFrame` response:

```json
{
  "success": true,
  "frameId": "frame-1780000000000",
  "capturedAt": "2026-06-18T10:00:00.000Z",
  "route": { "location": "/register", "name": "register" },
  "screenshot": { "format": "png", "base64": "..." },
  "snap": {
    "groupId": "snapshot-1780000000000",
    "snapshot": "- textbox \"Email\" [ref=e4]",
    "refs": []
  },
  "diagnostics": {
    "focused": { "ref": "e4", "role": "textbox", "label": "Email" },
    "transientCallbacks": 0
  }
}
```

Example normalized bridge failure:

```json
{
  "success": false,
  "code": "actionability_obscured",
  "message": "Target ref=e4 is obscured by another render object.",
  "target": { "ref": "e4", "role": "button", "label": "Next" },
  "details": {
    "hitTestPath": ["ModalBarrier", "Scaffold", "NextButton"],
    "rect": { "x": 16, "y": 520, "width": 343, "height": 48 }
  },
  "recoveryHints": [
    { "kind": "close-overlay", "description": "A modal barrier is intercepting the tap." },
    { "kind": "observe", "description": "Inspect visible buttons and dismiss controls." }
  ]
}
```

---

## Passive AI Strategy

Passive AI should ship in layers.

### Passive v0: Agent-Readable Failures

Do not call a model. Capture context and throw/write structured failures:

```typescript
export interface AgentVisibleFailure {
  code:
    | 'selector_not_found'
    | 'actionability_failed'
    | 'assertion_failed'
    | 'navigation_failed'
    | 'step_failed'
    | 'ai_call_failed'
    | 'unknown';
  title: string;
  message: string;
  timelineNodeId?: string;
  scriptLocation?: {
    file: string;
    line: number;
    column?: number;
    stepTitle?: string;
  };
  appState?: {
    route?: string;
    screenshotPath?: string;
    snapshotPath?: string;
    diagnosticsPath?: string;
  };
  actionContext?: {
    action?: string;
    target?: unknown;
    valueMasked?: boolean;
  };
  recoveryHints: Array<{
    kind: 'observe' | 'retry' | 'close-overlay' | 'change-selector' | 'wait' | 'manual';
    description: string;
  }>;
}
```

This is the minimum viable AI-native passive mode: external Codex/Claude/MCP agents can read `timeline.json`, logs, screenshots, snapshots, and `agentVisibleFailures` without Fliwright silently spending AI calls.

### Passive v1: Framework-Side Diagnosis

When configured, the runner calls AI after a failure and writes an `ai-call` plus `agent-diagnosis` node. It does not execute repair actions by default.

```typescript
agentPolicy: {
  passive: true,
  onFailure: 'diagnose',
  autoRepair: false,
}
```

### Passive v2: Controlled Runtime Repair

AI can propose structured runtime actions; Fliwright executes only allowed actions and retries the failed step.

```typescript
agentPolicy: {
  passive: true,
  autoRetry: true,
  autoRepair: 'runtime-only',
  allowCodePatch: false,
  maxRetriesPerStep: 2,
}
```

All AI suggestions, accepted actions, rejected actions, retries, and final outcomes must be represented in the timeline.

---

## File Map

### Flutter Bridge

- Modify `packages/fliwright-bridge/lib/src/bridge.dart`: advertise timeline/assertion/context capabilities in handshake.
- Create `packages/fliwright-bridge/lib/src/extensions/context.dart`: route, focus, lifecycle/frame diagnostics.
- Create `packages/fliwright-bridge/lib/src/extensions/capture_frame.dart`: one-shot screenshot + snap + route + diagnostics capture.
- Create `packages/fliwright-bridge/lib/src/extensions/query.dart`: normalized selector/ref query results for assertions.
- Modify `packages/fliwright-bridge/lib/src/extensions/gesture.dart`: return normalized action diagnostics and stable failure codes.
- Modify `packages/fliwright-bridge/lib/src/extensions/type_extension.dart`: return normalized type/fill diagnostics and stable failure codes.
- Modify `packages/fliwright-bridge/lib/src/extensions/router_navigate.dart`: return normalized route before/after metadata.
- Modify `packages/fliwright-bridge/lib/src/extensions/mock_rule_store.dart`: ensure mock calls expose normalized request shape for TS assertions.
- Modify `packages/fliwright-bridge/lib/src/extensions/dio_mock_extension.dart`: align Dio call log shape with mock server call shape.
- Modify `packages/fliwright-bridge/lib/src/extensions/riverpod.dart`: expose normalized provider debug values/errors for state assertions.
- Add bridge tests:
  - `packages/fliwright-bridge/test/context_test.dart`
  - `packages/fliwright-bridge/test/capture_frame_test.dart`
  - `packages/fliwright-bridge/test/query_test.dart`
  - action diagnostics regression tests in existing gesture/type tests.

### Core

- Create `packages/fliwright-core/src/timeline/types.ts`: timeline node/artifact/failure/policy types.
- Create `packages/fliwright-core/src/timeline/TimelineRecorder.ts`: node lifecycle and artifact registration.
- Create `packages/fliwright-core/src/timeline/TimelineArtifactStore.ts`: run directory, screenshots, snapshots, diagnostics, JSON writes.
- Create `packages/fliwright-core/src/timeline/FlowRuntime.ts`: `page`, `step`, `frame`, `branch`, `optional`, `assertion`.
- Create `packages/fliwright-core/src/mocks/MockRuntime.ts`: timeline-aware facade over `MockManager`.
- Create `packages/fliwright-core/src/mocks/types.ts`: mock timeline metadata and normalized request matcher types.
- Create `packages/fliwright-core/src/assertions/AssertRuntime.ts`: timeline-native assertion library.
- Create `packages/fliwright-core/src/assertions/types.ts`: assertion matcher/metadata types.
- Create `packages/fliwright-core/src/agent/AgentRuntime.ts`: active AI helper facade over `AiRuntime` plus timeline recording.
- Create `packages/fliwright-core/src/agent/FliwrightAgentError.ts`: structured passive v0 error.
- Modify `packages/fliwright-core/src/index.ts`: export timeline and agent APIs.
- Modify `packages/fliwright-core/src/TraceCollector.ts`: optionally bridge action trace events into the active timeline node.
- Modify `packages/fliwright-core/src/Assertion.ts`: convert assertion failures into `AgentVisibleFailure` when a flow context exists.
- Modify `packages/fliwright-core/src/Locator.ts`: attach action target context to agent-visible action failures when a flow context exists.
- Modify `packages/fliwright-core/src/Page.ts`: add `captureFrame()` and `context()` wrappers over bridge extensions.
- Modify `packages/fliwright-core/src/types.ts`: add bridge frame/context/query/action diagnostic types.

### Vitest

- Modify `packages/fliwright-vitest/src/index.ts`: add `{ flow, mock, agent, assert }` fixtures; complete timeline on pass/fail; write `timeline.json`.
- Add `packages/fliwright-vitest/tests/timeline-fixture.test.ts`.
- Add `packages/fliwright-vitest/tests/mock-fixture.test.ts`.
- Add `packages/fliwright-vitest/tests/agent-fixture.test.ts`.
- Add `packages/fliwright-vitest/tests/assert-fixture.test.ts`.

### CLI

- Modify `packages/fliwright-cli/src/commands/run.ts`: include timeline path and `agentVisibleFailures` in AI JSON report.
- Modify `packages/fliwright-cli/src/reporter.ts`: pretty-print timeline/failure summary.
- Add automation/test mode config to CLI output once modes are implemented.
- Add `packages/fliwright-cli/tests/timeline-run.test.ts`.

### MCP

- Create `packages/fliwright-mcp/src/tools/timeline.ts`: `fliwright_timeline_get`.
- Create `packages/fliwright-mcp/src/tools/agentDiagnose.ts`: `fliwright_agent_diagnose` for passive v1.
- Modify `packages/fliwright-mcp/src/server.ts`: register timeline/agent tools.
- Add `packages/fliwright-mcp/tests/timeline.test.ts`.
- Add `packages/fliwright-mcp/tests/agentDiagnose.test.ts`.

### Codegen / Recording

- Modify `packages/fliwright-core/src/CodeGenerator.ts`: generate `flow.step(...)` wrappers when `timeline: true`.
- Modify `packages/fliwright-core/src/types.ts`: add `CodegenOptions.timeline?: boolean`.
- Modify `packages/fliwright-core/src/types.ts`: add `CodegenOptions.mode?: 'script' | 'test'`.
- Modify `packages/fliwright-core/src/RecorderController.ts`: expose recorded frames as candidate timeline frames.
- Add `packages/fliwright-core/tests/TimelineCodeGenerator.test.ts`.

---

## Task 1: Bridge Handshake And Runtime Context

**Goal:** Make the Flutter bridge advertise timeline/assertion support and expose current app context as a stable runtime fact source.

**Files:**
- Modify `packages/fliwright-bridge/lib/src/bridge.dart`
- Create `packages/fliwright-bridge/lib/src/extensions/context.dart`
- Add `packages/fliwright-bridge/test/context_test.dart`
- Modify `packages/fliwright-core/src/Driver.ts`
- Modify `packages/fliwright-core/src/Page.ts`
- Modify `packages/fliwright-core/src/types.ts`

- [ ] Extend handshake `bridgeCapabilities` with:
  - `timelineContext`
  - `captureFrame`
  - `query`
  - `assertionDiagnostics`
  - `normalizedActionErrors`
  - `normalizedMockCalls`
  - `normalizedProviderState`
- [ ] Register `ext.fliwright.context`.
- [ ] Return current route using existing `RouterNavigateExtension` logic where possible.
- [ ] Return focused widget/input metadata when available.
- [ ] Return frame/lifecycle diagnostics useful for timeline frames.
- [ ] Add TS wrappers:
  - `driver.sdkVersion` remains unchanged.
  - `page.context()` returns bridge context.
- [ ] Add Dart tests for registration and shape.
- [ ] Add TS tests with mocked VM service response.

**Acceptance Criteria:**
- TS can determine whether the running app supports timeline-native bridge features.
- Timeline frames can include route/focus/frame diagnostics without guessing from screenshots.
- Older bridges still work through capability checks and fallbacks.

---

## Task 2: Bridge Frame Capture And Query Protocol

**Goal:** Provide one bridge call for timeline frame capture and one normalized query API for assertions.

**Files:**
- Create `packages/fliwright-bridge/lib/src/extensions/capture_frame.dart`
- Create `packages/fliwright-bridge/lib/src/extensions/query.dart`
- Modify `packages/fliwright-bridge/lib/src/bridge.dart`
- Add `packages/fliwright-bridge/test/capture_frame_test.dart`
- Add `packages/fliwright-bridge/test/query_test.dart`
- Modify `packages/fliwright-core/src/Page.ts`
- Modify `packages/fliwright-core/src/types.ts`

- [ ] Register `ext.fliwright.captureFrame`.
- [ ] Compose screenshot, `ext.fliwright.snap`, current route, and diagnostics into one response.
- [ ] Include `frameId`, `capturedAt`, and route metadata in every successful frame capture.
- [ ] Register `ext.fliwright.query`.
- [ ] Support query by key, text, containsText, type, semantics label/id, role, and ref.
- [ ] Return normalized matches:
  - ref
  - role
  - label/text/value
  - type/key
  - rect
  - enabled
  - visible
  - hitTestable/actionable
  - checked/selected when applicable
- [ ] Add `page.captureFrame(options?)`.
- [ ] Add `page.query(query, options?)`.
- [ ] Add internal TS helpers for `AssertRuntime` to call `page.query(...)`.

**Acceptance Criteria:**
- `flow.frame()` can call one bridge method and receive all artifacts needed for timeline UI.
- First-slice `assert.visible/enabled/text/count` can be implemented from normalized query results.
- Query behavior is tested in Flutter widget tests.

---

## Task 3: Bridge Diagnostics For Actions, Network, And State

**Goal:** Make bridge-originated failures and observations structured enough for passive AI v0 and timeline assertions.

**Files:**
- Modify `packages/fliwright-bridge/lib/src/extensions/gesture.dart`
- Modify `packages/fliwright-bridge/lib/src/extensions/type_extension.dart`
- Modify `packages/fliwright-bridge/lib/src/extensions/router_navigate.dart`
- Modify `packages/fliwright-bridge/lib/src/extensions/mock_rule_store.dart`
- Modify `packages/fliwright-bridge/lib/src/extensions/mock_server.dart`
- Modify `packages/fliwright-bridge/lib/src/extensions/dio_mock_extension.dart`
- Modify `packages/fliwright-bridge/lib/src/extensions/riverpod.dart`
- Add/modify Dart tests for action diagnostics, mock call shape, and provider state shape.
- Modify `packages/fliwright-core/src/Locator.ts`
- Modify `packages/fliwright-core/src/MockManager.ts`
- Modify `packages/fliwright-core/src/interfaces/StateAdapter.ts`

- [ ] Normalize action success responses with action, target, routeBefore/routeAfter when available.
- [ ] Normalize action failures with:
  - `success: false`
  - stable `code`
  - `message`
  - `target`
  - `details`
  - `recoveryHints`
- [ ] Map actionability exceptions into stable codes such as:
  - `actionability_disabled`
  - `actionability_zero_rect`
  - `actionability_offscreen`
  - `actionability_unstable`
  - `actionability_obscured`
  - `target_not_found`
- [ ] Return route before/after from navigation extensions.
- [ ] Normalize mock call logs across mock server and Dio:
  - method
  - url/path
  - headers
  - query
  - body
  - status/response when available
  - timestamp
- [ ] Normalize Riverpod provider values/errors using `debug_value_encoder`.
- [ ] Update TS wrappers to preserve bridge diagnostic payloads instead of flattening them into strings.

**Acceptance Criteria:**
- A failed action can become a useful `AgentVisibleFailure` without string parsing.
- `assert.request` can operate across mock server and Dio modes.
- `assert.state` has structured provider data when the Riverpod bridge is installed.

---

## Task 4: Timeline Core Types And Recorder

**Goal:** Create the minimal timeline IR and recorder. This task should not change test behavior yet.

**Files:**
- Create `packages/fliwright-core/src/timeline/types.ts`
- Create `packages/fliwright-core/src/timeline/TimelineRecorder.ts`
- Create `packages/fliwright-core/src/agent/FliwrightAgentError.ts`
- Create `packages/fliwright-core/tests/timeline/TimelineRecorder.test.ts`
- Create `packages/fliwright-core/tests/agent/FliwrightAgentError.test.ts`
- Modify `packages/fliwright-core/src/index.ts`

- [ ] Define `TimelineNode`, `TimelineData`, `TimelineArtifactRef`, `AgentVisibleFailure`, `AgentPolicy`, and `CodeRef`.
- [ ] Implement `TimelineRecorder.startNode(kind, title, metadata?)`.
- [ ] Implement `TimelineRecorder.passNode(id)` / `failNode(id, failure)` / `skipNode(id)`.
- [ ] Preserve parent-child nesting with an internal node stack.
- [ ] Add tests for nested page -> step -> frame ordering.
- [ ] Add tests for failed node storing `AgentVisibleFailure`.
- [ ] Implement `FliwrightAgentError extends Error` with `failure: AgentVisibleFailure` and original `cause`.
- [ ] Export timeline types and recorder from `@fliwright/core`.

**Acceptance Criteria:**
- Core tests can create a recorder, nest nodes, close them, and serialize stable `TimelineData`.
- A failed node contains structured agent-visible error data.
- No VM Service or screenshot dependency is required for these tests.

---

## Task 5: Timeline Artifact Store

**Goal:** Persist timeline artifacts under a run directory.

**Files:**
- Create `packages/fliwright-core/src/timeline/TimelineArtifactStore.ts`
- Create `packages/fliwright-core/tests/timeline/TimelineArtifactStore.test.ts`

- [ ] Create run directory layout:
  - `.fliwright/runs/<runId>/timeline.json`
  - `.fliwright/runs/<runId>/artifacts/screenshots/*.png`
  - `.fliwright/runs/<runId>/artifacts/snapshots/*.json`
  - `.fliwright/runs/<runId>/artifacts/diagnostics/*.json`
- [ ] Implement `writeTimeline(data)`.
- [ ] Implement `writeScreenshot(nodeId, buffer)`.
- [ ] Implement `writeSnapshot(nodeId, snapshot)`.
- [ ] Implement `writeDiagnostics(nodeId, diagnostics)`.
- [ ] Return relative artifact refs suitable for JSON reports and UI.
- [ ] Add deterministic temp-dir tests.

**Acceptance Criteria:**
- Artifacts are persisted with deterministic names.
- `timeline.json` references artifacts by path and MIME type.
- Tests do not depend on a running Flutter app.

---

## Task 6: FlowRuntime DSL

**Goal:** Add the script structure API: `page`, `step`, `frame`, `branch`, `optional`.

**Files:**
- Create `packages/fliwright-core/src/timeline/FlowRuntime.ts`
- Create `packages/fliwright-core/tests/timeline/FlowRuntime.test.ts`

- [ ] Implement `flow.step(title, body)`.
- [ ] Implement `flow.page(title, options, body)`.
- [ ] Implement `flow.frame(title, options?)`.
- [ ] Implement `flow.branch(title, metadata, body)`.
- [ ] Implement `flow.optional(title, { when }, body)`.
- [ ] Capture sync and async errors, mark nodes failed, and rethrow `FliwrightAgentError`.
- [ ] If a `page` is available and frame options request artifacts, call `page.captureFrame()` when supported.
- [ ] Fall back to `page.screenshot()` and/or `page.snapshot()` for older bridges.
- [ ] Add tests using fake page screenshot/snapshot APIs.
- [ ] Add tests that skipped optional nodes appear as `status: 'skipped'`.

**Acceptance Criteria:**
- Test authors can wrap existing `page` calls without changing page/driver APIs.
- Every `flow.step` has a node with pass/fail status.
- `flow.frame(..., { screenshot: true, snapshot: true })` writes artifacts.

---

## Task 7: Script And Test Modes

**Goal:** Make automation script mode and E2E test framework mode explicit while sharing the same timeline runtime.

**Files:**
- Modify `packages/fliwright-core/src/timeline/types.ts`
- Modify `packages/fliwright-core/src/timeline/FlowRuntime.ts`
- Modify `packages/fliwright-vitest/src/index.ts`
- Add `packages/fliwright-vitest/tests/mode-fixture.test.ts`

- [ ] Add `TimelineRunMode = 'script' | 'test'`.
- [ ] Add `mode` to `TimelineData`.
- [ ] Add `defineScript` / `script` export or equivalent fixture helper for automation scripts.
- [ ] Keep `test` for assertion-oriented E2E tests.
- [ ] In script mode, a run may pass with zero assertion nodes and may include mock setup/teardown nodes.
- [ ] In test mode, add an optional policy `requireAssertions?: boolean`; when true, fail if no assertion nodes were recorded.
- [ ] Add config support:
  - `createFliwrightTest({ mode: 'test' })`
  - `createFliwrightScript({ mode: 'script' })` or `script(...)`
- [ ] Add tests proving both modes produce compatible timeline JSON.

**Acceptance Criteria:**
- Automation scripts can use `flow`, `mock`, and `agent` without importing assertion APIs.
- E2E tests can require assertions by policy.
- CLI/report output identifies whether a run was a script or a test.

---

## Task 8: MockRuntime And Timeline Mock Operations

**Goal:** Make existing Fliwright mock rules and mock manager operations timeline-aware without creating a new mock engine.

**Files:**
- Create `packages/fliwright-core/src/mocks/types.ts`
- Create `packages/fliwright-core/src/mocks/MockRuntime.ts`
- Add `packages/fliwright-core/tests/mocks/MockRuntime.test.ts`
- Modify `packages/fliwright-core/src/index.ts`

- [ ] Wrap an existing `MockManager` instance instead of duplicating mock logic.
- [ ] Implement timeline-aware methods:
  - `loadRules(mockDir?)`
  - `switchRule(endpoint, ruleName, method?)`
  - `route(path, response)`
  - `routeFlutter(path, response)`
  - `clearRoutes()`
  - `clearCalls()`
  - `setPassthrough(enabled)`
  - `getCalls(path?)`
  - `listRoutes()`
  - `listRules()`
- [ ] Implement `mock.rules(title, body)` as a grouped timeline step for mock setup.
- [ ] Record `kind: 'mock'` nodes or step metadata for every mock operation.
- [ ] Include backend metadata when known: `flutter`, `dio`, or `tool-server`.
- [ ] Preserve existing `driver.mock` behavior and APIs.
- [ ] Add tests using mocked `MockManager` / `SendRequest`; do not require a running Flutter app.

**Acceptance Criteria:**
- Existing `.fliwright/mocks` rule files work unchanged.
- Scripts/tests can use `{ mock }` instead of manually threading `driver.mock`.
- Timeline clearly shows which mock rules were loaded/switched and which backend handled them.

---

## Task 9: AssertRuntime And Timeline Assertions

**Goal:** Add the first slice of the assertion facade for E2E test framework mode. This is not a new generic assertion engine; reuse Vitest/community `expect` for ordinary value assertions and implement only Fliwright runtime-aware assertions here.

**Files:**
- Create `packages/fliwright-core/src/assertions/types.ts`
- Create `packages/fliwright-core/src/assertions/AssertRuntime.ts`
- Add `packages/fliwright-core/tests/assertions/AssertRuntime.test.ts`
- Modify `packages/fliwright-core/src/index.ts`

- [ ] Define assertion metadata types:
  - matcher
  - target
  - expected
  - actual
  - aiAssisted
- [ ] Implement deterministic locator assertions:
  - `visible`
  - `hidden`
  - `enabled`
  - `disabled`
  - `text`
  - `containsText`
  - `count`
- [ ] Reuse existing `Assertion`/`createExpect` where possible.
- [ ] Implement mock/network assertions using `MockRuntime` / existing `MockManager` call logs:
  - `request`
  - `noRequest`
  - `requestCount`
- [ ] Defer snapshot/semantic assertions to a later slice:
  - `snapshot`
  - `semantic`
  - `actionAvailable`
- [ ] Defer AI assertions until after `AgentRuntime` is implemented:
  - `ai`
  - `visual`
- [ ] Defer state assertions until Riverpod state normalization is implemented:
  - `state`
  - `providerValue`
- [ ] Record every assertion as a `kind: 'assertion'` timeline node.
- [ ] On failure, capture screenshot/snapshot best-effort and throw `FliwrightAgentError` with `code: 'assertion_failed'`.
- [ ] Add tests with fake locators/page/driver.

**Acceptance Criteria:**
- E2E tests can verify outcomes without falling back to raw Vitest `expect`.
- Each assertion appears in `timeline.json`.
- Assertion failures are AI-agent-readable in passive v0.

---

## Task 10: Active Agent Runtime

**Goal:** Provide explicit AI calls that are recorded as timeline nodes.

**Files:**
- Create `packages/fliwright-core/src/agent/AgentRuntime.ts`
- Create `packages/fliwright-core/tests/agent/AgentRuntime.test.ts`

- [ ] Implement `agent.ask(titleOrPrompt, request?)`.
- [ ] Implement `agent.generate(titleOrPrompt, request)`.
- [ ] Implement `agent.verify(prompt, options?)` using `AiRuntime.visible` or `ai.visible`.
- [ ] Implement `agent.inspect(titleOrPrompt, request)`.
- [ ] Record each active AI call as `kind: 'ai-call'`, `mode: 'active'`.
- [ ] Store prompt, schema summary, provider metadata, artifactsDir, pass/fail status.
- [ ] Mask obvious secrets and generated secret values in timeline metadata.
- [ ] Add tests with `MockAiAdapter`; do not call real providers.

**Acceptance Criteria:**
- Active AI calls are visible in the timeline.
- `agent.generate` returns typed data and records fallback use when fallback is returned.
- Failed AI calls become agent-visible failures.

---

## Task 11: Vitest Fixtures

**Goal:** Expose `{ flow, mock, agent, assert }` in `@fliwright/vitest` and write `timeline.json` for each test/script run.

**Files:**
- Modify `packages/fliwright-vitest/src/index.ts`
- Add `packages/fliwright-vitest/tests/timeline-fixture.test.ts`
- Add `packages/fliwright-vitest/tests/mock-fixture.test.ts`
- Add `packages/fliwright-vitest/tests/agent-fixture.test.ts`
- Add `packages/fliwright-vitest/tests/assert-fixture.test.ts`

- [ ] Extend fixture type to `{ page, driver, aiRuntime, flow, mock, agent, assert }`.
- [ ] Create one `TimelineRecorder` per test.
- [ ] Use existing `runId` and test name for artifact paths.
- [ ] Complete timeline as passed/failed in the fixture teardown.
- [ ] On test error, capture screenshot, snapshot, diagnostics best-effort.
- [ ] Preserve existing `page`, `driver`, `aiRuntime`, and `expect()` behavior.
- [ ] Wire `mock` to the current timeline and `driver.mock`.
- [ ] Wire `assert` to the current timeline, page, driver, and AI runtime.
- [ ] Add tests that fixture creation does not require AI provider config.
- [ ] Add tests that a failing `flow.step` writes an `AgentVisibleFailure`.
- [ ] Add tests that a failing `assert.visible` writes an assertion node and agent-visible failure.

**Acceptance Criteria:**
- Existing tests continue to work unchanged.
- New tests can destructure `{ flow, mock, agent, assert }`.
- A failed flow-backed test writes a timeline with structured failure context.
- Assertion nodes appear in timelines for E2E tests.

---

## Task 12: Passive AI v0 Errors

**Goal:** Make failures naturally readable by external AI agents without calling AI.

**Files:**
- Modify `packages/fliwright-core/src/timeline/FlowRuntime.ts`
- Modify `packages/fliwright-core/src/Assertion.ts`
- Modify `packages/fliwright-core/src/Locator.ts`
- Add/modify `packages/fliwright-core/tests/agent/FliwrightAgentError.test.ts`

- [ ] Convert generic step errors into `code: 'step_failed'`.
- [ ] Convert assertion failures into `code: 'assertion_failed'`.
- [ ] Convert locator/action failures into `selector_not_found` or `actionability_failed` when recognizable.
- [ ] Add recovery hints:
  - selector not found -> `observe`, `change-selector`, `retry`
  - actionability failed -> `close-overlay`, `wait`, `retry`
  - navigation failed -> `observe`, `manual`
- [ ] Ensure thrown error message contains a concise summary plus timeline node id.
- [ ] Keep original error as `cause`.

**Acceptance Criteria:**
- External agents can understand failures from logs plus `timeline.json`.
- No AI provider is required.
- Existing failure collection still works.

---

## Task 13: CLI Report Integration

**Goal:** Make `fliwright run --reporter ai-json` return timeline and agent-visible failures.

**Files:**
- Modify `packages/fliwright-cli/src/commands/run.ts`
- Modify `packages/fliwright-cli/src/reporter.ts`
- Add `packages/fliwright-cli/tests/timeline-run.test.ts`

- [ ] Add timeline path to `CliRunResult.artifacts`.
- [ ] Read timeline JSON when present after Vitest run.
- [ ] Add `agentVisibleFailures` top-level field.
- [ ] Include timeline summary in pretty output:
  - pages count
  - steps passed/failed
  - screenshots count
  - first agent-visible failure
- [ ] Preserve existing `failures` and screenshot behavior.
- [ ] Add tests using a fake sidecar timeline file.

**Acceptance Criteria:**
- MCP/external agents can call `fliwright_run` and immediately locate timeline artifacts.
- Existing CLI JSON consumers remain compatible.

---

## Task 14: MCP Timeline Tools

**Goal:** Let external agents inspect the timeline directly through MCP.

**Files:**
- Create `packages/fliwright-mcp/src/tools/timeline.ts`
- Modify `packages/fliwright-mcp/src/server.ts`
- Add `packages/fliwright-mcp/tests/timeline.test.ts`

- [ ] Register `fliwright_timeline_get`.
- [ ] Params:
  - `runId?: string`
  - `path?: string`
  - `includeArtifacts?: boolean`
  - `nodeId?: string`
- [ ] Default to last run result's timeline when available.
- [ ] Return full timeline or selected node with surrounding context.
- [ ] Add tests for no run, last run, and node filtering.

**Acceptance Criteria:**
- Agent can inspect timeline without scraping CLI stdout.
- Tool output is compact enough for AI context windows.

---

## Task 15: Passive AI v1 Diagnosis

**Goal:** Optionally ask AI to diagnose failures and record the answer in the timeline.

**Files:**
- Create `packages/fliwright-core/src/agent/PassiveAgent.ts`
- Create `packages/fliwright-core/tests/agent/PassiveAgent.test.ts`
- Create `packages/fliwright-mcp/src/tools/agentDiagnose.ts`
- Add `packages/fliwright-mcp/tests/agentDiagnose.test.ts`

- [ ] Build `AgentContext` from current node, recent timeline nodes, screenshot, snapshot, diagnostics, and allowed tools.
- [ ] Implement `passiveAgent.diagnose(failure, context)`.
- [ ] Use `AiRuntime.generate` with a strict schema:
  - `summary`
  - `rootCause`
  - `suggestedActions`
  - `confidence`
- [ ] Record diagnosis as `kind: 'ai-call'`, `mode: 'passive-diagnosis'`.
- [ ] Add MCP `fliwright_agent_diagnose` for external explicit diagnosis.
- [ ] Default off unless `agentPolicy.passive === true`.
- [ ] Add tests with `MockAiAdapter`.

**Acceptance Criteria:**
- Framework-side diagnosis is opt-in.
- Diagnosis never hides or replaces the original failure.
- Timeline shows why AI was called and what it suggested.

---

## Task 16: Passive AI v2 Runtime Repair

**Goal:** Add controlled retry/repair for runtime-only issues.

**Files:**
- Create `packages/fliwright-core/src/agent/AgentRepair.ts`
- Add `packages/fliwright-core/tests/agent/AgentRepair.test.ts`

- [ ] Define safe repair actions:
  - `click` by key/text/ref
  - `wait`
  - `dismissModal`
  - `retryStep`
  - `observe`
- [ ] Explicitly disallow code edits in runtime repair.
- [ ] Add `agentPolicy.autoRetry`, `autoRepair`, `maxRetriesPerStep`.
- [ ] Execute only schema-valid, allowed repair actions.
- [ ] Record accepted and rejected repair proposals in timeline.
- [ ] Add loop guard for retries.
- [ ] Add tests for close-overlay -> retry success.
- [ ] Add tests for disallowed code patch proposal being rejected.

**Acceptance Criteria:**
- Runtime repair can recover from common overlay/wait/selector state failures.
- Every repair action is visible and auditable.
- No code mutation happens in v2.

---

## Task 17: Timeline-Aware Codegen

**Goal:** Make generated/recorded tests structured by default.

**Files:**
- Modify `packages/fliwright-core/src/types.ts`
- Modify `packages/fliwright-core/src/CodeGenerator.ts`
- Modify `packages/fliwright-core/src/DartCodeGenerator.ts` only if Dart timeline support is added later; otherwise leave unchanged.
- Add `packages/fliwright-core/tests/TimelineCodeGenerator.test.ts`

- [ ] Add `CodegenOptions.timeline?: boolean`.
- [ ] Add `CodegenOptions.mode?: 'script' | 'test'`.
- [ ] When `timeline` is true, import `test` from `@fliwright/vitest` and generate `{ page, flow }`.
- [ ] In script mode, generate `script('...', async ({ page, flow, mock, agent }) => { ... })`.
- [ ] In test mode, generate `test('...', async ({ page, flow, mock, assert, agent }) => { ... })`.
- [ ] Wrap each recorded operation in a clear `flow.step`.
- [ ] If assertion suggestions exist, generate timeline-native `assert.*` calls in test mode.
- [ ] Convert `RecordingFrame` metadata into optional `flow.frame` comments or calls when screenshot data exists.
- [ ] Preserve old flat codegen when `timeline` is false.
- [ ] Add tests for tap/type/drag/longPress codegen.
- [ ] Add tests for script mode vs test mode output.

**Acceptance Criteria:**
- Recorded tests can be visualized immediately after generation.
- Existing codegen output remains backward-compatible by default until the product chooses to flip the default.
- Automation scripts and E2E tests are generated with different top-level APIs.

---

## Task 18: Visual Timeline UI Contract

**Goal:** Define a stable contract for VS Code/web UI before building heavy UI.

**Files:**
- Create `docs/superpowers/specs/2026-06-18-ai-native-timeline-agent-design.md` or update this plan into a spec after review.
- Optionally add JSON schema fixture under `packages/fliwright-core/tests/fixtures/timeline/`.

- [ ] Document node kinds and required fields.
- [ ] Document artifact path semantics.
- [ ] Document how active/passive AI calls appear.
- [ ] Document status colors and grouping expectations:
  - script
  - page
  - frame
  - step
  - branch
  - ai-call
  - failure
- [ ] Provide an example timeline for auto-register-fill.

**Acceptance Criteria:**
- UI work can proceed without guessing runtime semantics.
- Agents can consume the same JSON the visual UI consumes.

---

## Testing Strategy

- Flutter bridge tests:
  - `melos run analyze`
  - `melos run test`
  - Focus on context, captureFrame, query, assertion helpers, action diagnostics, mock call shape, and Riverpod provider state shape.
- Core unit tests:
  - `pnpm --filter @fliwright/core test`
  - Focus on timeline recorder, artifact store, flow runtime, mock runtime, assert runtime, agent errors, active agent calls, passive diagnosis.
- Vitest integration:
  - `pnpm --filter @fliwright/vitest test`
  - Ensure `page`, `driver`, `aiRuntime`, `flow`, `mock`, `agent`, and `assert` fixtures preserve existing behavior and support both script/test modes.
- CLI tests:
  - `pnpm --filter @fliwright/cli test`
  - Verify timeline report integration.
- MCP tests:
  - `pnpm --filter @fliwright/mcp test`
  - Verify `fliwright_timeline_get` and `fliwright_agent_diagnose`.
- Full TS check:
  - `pnpm lint`

Live Flutter E2E tests remain opt-in and require `FLIWRIGHT_VM_SERVICE_URL`.

---

## Rollout Strategy

1. Ship bridge protocol foundations first: capabilities, context, captureFrame, query, and normalized diagnostics.
2. Ship passive v0 next: timeline + structured failure output, no hidden AI calls.
3. Add explicit script/test modes on the same timeline foundation.
4. Add timeline-aware MockRuntime over existing mock rules and `driver.mock`.
5. Add timeline-native assertion library for E2E test mode, including request assertions via MockRuntime.
6. Add active AI calls as explicit script/test API.
7. Expose CLI/MCP timeline inspection.
8. Add passive v1 diagnosis behind config.
9. Add passive v2 runtime-only repair behind stricter config.
10. Convert recorder/codegen to generate timeline-aware scripts and tests.
11. Build or update visual timeline UI on top of the stable JSON contract.

---

## Non-Goals For First Slice

- No automatic code patching.
- No persistent multi-turn AI session in the first slice.
- No real provider calls in default tests.
- No replacement of existing `page`, `driver`, `aiRuntime`, or `expect` APIs.
- No requirement that every existing test be migrated immediately.
- No requirement that automation scripts include assertions.
- No requirement that script mode and test mode use different timeline storage.
- No requirement that older Flutter bridge versions support timeline-native features; TS must fall back or report missing capabilities clearly.

---

## Open Decisions

- Should `flow` be mandatory for generated tests, or gated by `CodegenOptions.timeline` until stable?
- Should the top-level automation API be named `script`, `task`, or `automation`?
- Should E2E test mode require at least one assertion by default, or only when `requireAssertions` is enabled?
- Should `flow.frame()` capture screenshot by default, or require `{ screenshot: true }` to control artifact volume?
- Should `captureFrame` always include screenshots, or allow snapshot-only mode for lower artifact volume?
- Should timeline IDs be deterministic slugs from titles or generated counters?
- Should passive v1 diagnosis live in core only, or should MCP be the preferred diagnosis host?
- How much source code context should be included in `AgentContext` by default?
- Which assertion APIs should ship first: deterministic locator assertions only, or include mock/state/AI assertions in the first slice?
- Bridge-side `ext.fliwright.assert` is deferred for the first implementation; revisit only if TS-side assertions over `query` are insufficient.
- Should `{ mock }` be exposed as a separate fixture, or only as `driver.mock` plus timeline wrappers on `flow.mock(...)`?
- Should mock setup nodes be `kind: 'mock'` or grouped `kind: 'step'` nodes with mock metadata?
