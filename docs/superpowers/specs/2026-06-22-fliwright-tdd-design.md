# Fliwright TDD Mode — Design

- **Date:** 2026-06-22
- **Status:** Draft (pending review)
- **Scope:** Overall architecture (Gaps A–F) + detailed P0 core-loop spec; D/E/F as phased extensions
- **Target package:** new `@fliwright/tdd` + additive changes to `bridge`, `mcp`, `vscode`, `cli`
- **Target consumer:** the `exio` app (`/Users/leo.he/projects/exio/exio_app`)

---

## 1. Background & Motivation

Fliwright is strong at the two *ends* of TDD — writing tests (code-gen, record) and diagnosing
failures (failure context, self-healing, AI diagnosis, timeline). What is missing for a real
red→green→refactor loop is the **loop itself**: tight, fast, deterministic, and (for this design)
drivable by an AI agent.

Verified gaps from source:

- **Gap A — No persistent/watch runner.** `fliwright-cli/src/commands/run.ts:runVitest` spawns a
  fresh `vitest run` process per invocation, and `@fliwright/vitest`'s fixture driver
  (`sharedDriver` at `index.ts:79`, lazily created by `getSharedDriver`) is therefore recreated on
  every run; the CLI `process.exit`s. Every rerun pays full cold-start cost (process spawn + WS
  connect). VS Code's `VitestRunner` also spawns per run; `onDidSaveTextDocument` only refreshes the
  parse cache — it does not rerun. (Note: `setup.ts`'s `globalSetup` driver exists but is **not** what
  fixtures use — see §6.0.)
- **Gap B — Dart changes cannot be picked up automatically; no hot restart.** `reloadSources()`
  exists end-to-end (`VMServiceConnector` → `Driver.reloadSources` → CLI `hotReloadAndSnapInteraction`
  → MCP `fliwright_hot_reload_and_snap`) but it is **hot reload only**. There is no `hotRestart`/
  `restartFramework` anywhere. Hot reload cannot reflect structural Dart changes (new providers,
  changed signatures, changed `main()`/routes, changed `*.g.dart`) — exactly the edits made in the
  "green" step.
- **Gap C — No fast, deterministic baseline reset.** `record` generates a `beforeEach` that navigates
  home, but there is no fast, no-relaunch "reset the whole app to a known state"
  (Riverpod overrides + mock log + storage + navigation).
- **Gap D — "Red-first" scaffolding is weak.** `fliwright_generate_test` generates from *existing*
  source/snapshot; TDD wants a meaningful failing test for a *not-yet-implemented* feature.
- **Gap E — No automated red→diagnose→repair→rerun closed loop.** `AgentRepair`, `PassiveAgent`, and
  failure context exist as parts but are not wired into an automatic cycle.
- **Gap F — No loop-observability / agent-drive surface.** MCP has `run`/`get_failure` but no
  "subscribe to test status" or "drive this test to green."

## 2. Goals & Non-Goals

**Goals**

- A deterministic, agent-drivable red→green→refactor loop with a **sub-second test-executor rerun**
  (the part P0 controls). Total cycle latency is dominated by `flutter` reload/restart and is tracked
  as a separate metric, not promised as sub-second.
- Robust reload **and** hot restart via `flutter daemon`.
- Deterministic baseline reset (UI/E2E primary).
- Fully additive / opt-in: existing VS Code interactive mode and CLI batch mode work unchanged.

**Non-goals (this spec)**

- A new test-authoring API. A TDD test is an ordinary `createFliwrightTest` test, targeted by name.
- A new assertion library (reuses `@fliwright/vitest` `expect`).
- Replacing the existing batch/interactive runners.

## 3. Key Decisions (locked during brainstorming)

| Dimension | Decision |
|---|---|
| Primary driver | **Agent-driven.** MCP `fliwright_tdd_*` tools are first-class; the persistent runtime lives in the long-lived MCP server process. VS Code / CLI are supervision / fallback. |
| App process | **Owned via `flutter daemon`** (same daemon IDEs use). Reload + hot restart via the daemon's `app.restart` RPC. |
| Granularity | **UI/E2E primary.** Drive the real app UI; logic assertions by observing provider state. Default baseline = navigate home + clear/restore state. |
| Scope of this doc | **Overall architecture (A–F) + detailed P0 core-loop spec.** D/E/F are phased extension outlines. |

## 4. Design Principles (hard constraints)

1. **Purely additive, opt-in.** `@fliwright/tdd` is new; `core`/`vscode`/`mcp`/`vitest`/`bridge`
   receive additions only, no behavioral changes to existing paths. With TDD unused, behavior is
   byte-for-byte identical to today.
2. **Lazy runtime creation.** The MCP server instantiates `TddRuntime` only on the first
   `fliwright_tdd_*` call. No call → no overhead, no extra process.
3. **VS Code session untouched.** `FliwrightSession`/`VitestRunner`/sandbox/form/recording keep
   working as today. TDD in the extension is a **new monitor panel + commands**, never a replacement.
4. **Single driver by convention, not force.** Only one driver runs the loop at a time (the agent via
   MCP). The VS Code monitor is read-only by default; "take over" is opt-in. Avoids two drivers
   fighting over reset/reload.
5. **A TDD test is a normal fliwright test.** P0 adds loop *orchestration*, not test *syntax*.

## 5. Overall Architecture

### 5.1 Package layout

```
packages/
  fliwright-core        (unchanged; TDD only consumes existing driver/page/mock/timeline)
  fliwright-bridge      (+1 OPTIONAL extension ext.fliwright.storage.reset; absent → graceful skip)
  fliwright-tdd         [NEW] TddRuntime, FlutterDaemonController, BaselineManager,
                         ReloadStrategy, FocusedTestTracker, PersistentTestExecutor, Scenario types
  fliwright-mcp         (+fliwright_tdd_* tool group; lazy TddRuntime)        ← first-class surface
  fliwright-vscode      (+TDD Loop monitor panel + take-over commands; existing features untouched)
  fliwright-cli         (+fliwright tdd subcommand to start the runtime standalone)
  fliwright-vitest      (+1 additive, opt-in extension point: injectable driver provider —
                         existing sharedDriver behavior preserved when none injected)
```

### 5.2 Three coexisting execution paths (backward compatibility)

| Path | Trigger | Test execution | App sync | Lifetime |
|---|---|---|---|---|
| **Batch (existing)** | `fliwright run` / VS Code CodeLens | spawn `vitest run` each time | none | one-shot |
| **Interactive (existing)** | VS Code session/runner | `VitestRunner` spawn | manual | session |
| **TDD loop (new)** | agent calls `fliwright_tdd_*` | **in-process persistent vitest** (rerun by name; driver reused across reruns) | `flutter daemon` auto reload/restart | MCP server lifetime |

The first two change nothing. The third is new.

### 5.3 TDD loop data flow

```
agent ─fliwright_tdd_cycle(testName)─▶ MCP server
                                         │ (lazy create / reuse)
                                         ▼
                                      TddRuntime ──holds──▶ ① PersistentTestExecutor (in-process vitest)
                                         │  ┌─────────────▶ ② FlutterDaemonController (reload/restart)
                                         │  ├─────────────▶ ③ BaselineManager (reset: nav home + clear state)
                                         │  └─────────────▶ ④ FliwrightDriver (connected, reused across reruns)
                                         ▼
                         [reset baseline → reload/restart as needed → vitest.rerun(testName)]
                                         │
                                         ▼
                       red/green + failure context + diagnosis ──▶ agent
                                         │
                         (optional) AgentRepair propose/apply minimal fix → cycle again
```

The speed of P0 comes from: the test is never re-spawned — a long-lived in-process vitest reruns the
focused test via `changeNamePattern` (the real Vitest 2.1.9 API; see §6.6). This collapses the
**executor** rerun (reset + sync + run-one-test, excluding the flutter-tooling-bound restart) toward
sub-second. The original §6.0 "one driver shared, never reconnected" win is **not** realized on 2.1.9
(worker boundary; see §6.0): fixtures open their own WS via `FLIWRIGHT_VM_SERVICE_URL`. Two distinct
metrics are tracked (§9): executor-rerun latency (target: sub-second) and total cycle latency
(restart-bound, reported but not promised).

### 5.4 Opt-in in practice

- exio changes nothing to keep using current flows.
- To use TDD: agent (or developer) calls `fliwright_tdd_start` (attach to a daemon-managed app +
  boot the runtime) → drives the loop via `fliwright_tdd_cycle(testName)`. Stopping restores the
  prior state.
- VS Code gains a "TDD Loop" panel; it is invisible until opened.

## 6. P0 Core-Loop Component Design

### 6.0 Driver ownership model (cross-cutting)

> **Status (revised 2026-06-25):** The single-object model below is the *goal*, not what shipped.
> The P0.2 spike proved that Vitest 2.1.9 runs test files in **worker processes**, so a live
> `FliwrightDriver` (holding a WebSocket) **cannot** be passed across the worker boundary — the
> injectable provider is not reachable from the test process. Production therefore uses the
> **`vm-service-url` fallback** (described at the end of this section) as the formal architecture.
> See `spike/findings/2026-06-22-spike-verdict.md`. The single-driver goal stays open for a future
> Vitest/Node version that can run the test file in the MCP server's own process.

**Goal (single-object — not yet achievable on 2.1.9).** `TddRuntime` owns **exactly one**
`FliwrightDriver`, connected to the daemon-managed app's `wsUri`, used for **both** baseline reset
(`BaselineManager`) and test execution (the vitest fixtures). To share the one driver with fixtures
without a second connection, `@fliwright/vitest` gained an **additive, opt-in injectable driver
provider**: `createFliwrightTest(config, { driverProvider })`. When supplied, the `driver`/`page`
fixtures call it instead of lazily creating `sharedDriver`. The existing `sharedDriver` path remains
the default when no provider is injected → non-TDD usage is unchanged.

**What shipped (`vm-service-url` fallback — the production model).** `@fliwright/vitest` still
implements the `driverProvider` option (additive, opt-in, default path unchanged), but
`PersistentTestExecutor.boot()` does **not** rely on it: it injects `FLIWRIGHT_VM_SERVICE_URL`
instead, so ordinary `@fliwright/vitest` fixtures connect to the same app VM service. Result:
baseline reset uses the runtime-owned driver, and fixtures use their own connection to the same app
— **two** WebSocket connections to one app. `RuntimeSnapshot.fixtureDriverSharing === 'vm-service-url'`
and `snapshot().notes` make this explicit so the agent never mistakes it for single-object sharing.

In both models the executor forces `pool: 'forks'` + `poolOptions.forks.singleFork: true` so the
focused rerun is deterministic and does not spawn per-worker processes across reruns (§6.6).

### 6.1 Component map

| Component | Responsibility | Dependencies |
|---|---|---|
| `TddRuntime` | Orchestrator; holds all components; exposes operations called by MCP tools | all |
| `FlutterDaemonController` | Spawn `flutter daemon`; launch/attach app; provide reload + **hot restart** (Gap B linchpin) | flutter SDK subprocess |
| `PersistentTestExecutor` | In-process persistent vitest; rerun a single test by name; inject `FLIWRIGHT_VM_SERVICE_URL` for fixtures (2.1.9) | `@fliwright/vitest` |
| `BaselineManager` | Deterministic, fast baseline reset (Gap C) | driver + bridge extensions + MockService |
| `ReloadStrategy` | Change set → reload vs restart decision (Gap B policy) | file watcher / analyzer |
| `FocusedTestTracker` | Remember the targeted test + last result; feed the monitor | none |

### 6.2 Key interfaces (design-level sketch)

```ts
// @fliwright/tdd
export class TddRuntime {
  constructor(deps: {
    daemon: FlutterDaemonController;
    executor: PersistentTestExecutor;
    baseline: BaselineManager;
    strategy: ReloadStrategy;
    driver: () => FliwrightDriver;        // the SINGLE shared driver (§6.0); used by reset + fixtures
    repair?: AgentRepair;                 // optional; wired in P3
  });

  async start(opts: StartOpts): Promise<RuntimeSnapshot>;   // idempotent
  async cycle(testName: string, opts?: CycleOpts): Promise<TddCycleResult>;
  async focus(file: string, testName: string): Promise<void>;
  snapshot(): RuntimeSnapshot;                              // for the VS Code monitor
  async stop(opts?: { keepAppAlive?: boolean }): Promise<void>;
}

export interface TddCycleResult {
  status: 'red' | 'green';
  testName: string; file: string; durationMs: number;
  lastSync: 'reload' | 'restart' | 'none';
  baselineVersion: number;
  failure?: FailureContext;     // reuses core's screenshot + widget tree + source
  diagnosis?: AgentDiagnosis;   // optional (PassiveAgent)
}

export interface RuntimeSnapshot {
  connected: boolean;
  daemonStatus: 'running' | 'stopped' | 'unknown';
  appId?: string;               // required by daemon app.restart; persisted from app.start
  supportsRestart: boolean;     // from daemon app events; gates hot restart
  launchMode: 'start' | 'attach';  // start = daemon-owned; attach = degraded
  restartCapable: boolean;      // false in degraded attach mode or when supportsRestart is false
  driverConnections: number;    // runtime-owned driver count (baseline reset side); fixtures add their own (§6.0)
  fixtureDriverSharing: 'vm-service-url' | 'in-process-provider';  // 2.1.9 ships 'vm-service-url' (§6.0)
  focusedTest?: { file: string; testName: string };
  lastResult?: TddCycleResult;
  baselineVersion: number;
  unsupportedState?: string[];  // categories a Scenario claims but has no reset adapter for (§6.5)
}
```

### 6.3 FlutterDaemonController — Gap B linchpin

Uses `flutter daemon` JSON-RPC (the same protocol IDEs use). Precise mapping:

| TDD action | daemon method | Notes |
|---|---|---|
| Launch app | `app.start {projectId, deviceId, target}` → persist returned `appId`; listen for `app.debugPort` → `wsUri` | captures `appId` + `wsUri`; reads `supportsRestart` + launch mode from app events |
| Hot reload | `app.restart {appId, fullRestart:false}` | **requires `appId`**; gate on `supportsRestart` |
| **Hot restart** | `app.restart {appId, fullRestart:true}` | **requires `appId`**; gate on `supportsRestart`; **picks up structural changes** — the capability missing today |
| Stop | `app.stop {appId}` | |

`FlutterDaemonController` persists `appId`, `supportsRestart`, and `launchMode` from `app.start` /
app events and surfaces them in `RuntimeSnapshot` (§6.2). Restart is gated on `supportsRestart`; if
false, `restartCapable` is false. This resolves Gap B at its root: restart uses the flutter tool's own
restart semantics, not the raw VM-Service `reloadSources` (which is hot-reload only). The driver
connects to the `wsUri` exposed by the daemon-managed app.

**Degraded path (compat):** when the daemon cannot start, `FlutterDaemonController` falls back to
**attach** mode (attach to a developer-run `flutter run`). Attach mode cannot reliably hot-restart;
the runtime caps `lastSync` at `reload`, sets `restartCapable:false` + `launchMode:'attach'` in the
snapshot, and signals the agent that structural changes then require a manual restart.

### 6.4 ReloadStrategy — reload vs restart decision

Three layers; **pragmatic by default, analyzer-precise as opt-in**:

1. **Change capture.** A watcher observes `lib/**/*.dart` + `*.g.dart`, recording a `ChangeSet`
   since the last sync.
2. **Decision rules** (priority order):
   - **restart** if any "structural" signal fires: top-level/class/provider declaration line count
     changed, new `@riverpod`/`Provider` declarations, `main()`/route table changed, `*.g.dart`
     changed, `pubspec`/assets changed.
   - otherwise **reload** (method bodies, literals, UI detail).
3. **Fallback escalation.** If the daemon reports a reload failure, or the test fails with an
   "element/provider not found"-class error after reload, automatically escalate to restart and
   cycle once more; `lastSync` records whichever actually took effect.

> Default uses heuristic cheap signals (rule 2) + fallback escalation (rule 3), with **no analyzer
> dependency**. `analyzer` AST diff is an opt-in `strategy: 'precise'` upgrade (exio already has
> `analyzer ^8.1.1`). Correctness is preserved by "rather restart once more than be stale."

### 6.5 BaselineManager — deterministic reset (Gap C)

For UI/E2E primary, reset to baseline **before each rerun** (after reload/restart, before the test).
Baseline reset is a **scenario contract over pluggable reset adapters**, not a fixed step list — so
the set of state categories that must be reset (and exio-specific ones) is explicit and diagnosable.

```ts
export type ResetCategory =
  | 'navigation' | 'riverpod' | 'mock' | 'storage'          // built-in
  | 'secureStorage' | 'authTokens' | 'webview' | 'localDb'  // exio-relevant, adapter-provided
  | 'timers' | 'isolates' | 'permissions';                  // adapter-provided

export interface ResetAdapter {
  category: ResetCategory;
  reset(ctx: ResetContext): Promise<'ok' | 'skipped' | 'unsupported'>;
}

export interface Scenario {
  homeRoute: string;
  riverpodOverrides?: OverrideSpec[];
  mockProfile?: string;
  storageSeed?: Record<string, unknown>;
  resetCategories: ResetCategory[];   // the contract: which categories this scenario resets
}

export class BaselineManager {
  registerAdapter(adapter: ResetAdapter): void;             // built-ins + exio adapters
  async reset(scenario: Scenario, opts: { full?: boolean }): Promise<ResetReport>;
  // full=false: light reset (run adapters whose category survives reload)
  // full=true:  required after restart (main re-ran → zeroed; run ALL declared adapters + re-seed)
}
```

**Built-in adapters (reuse existing capabilities):** navigation → `router.navigate`; riverpod →
`riverpod.override` + `registerFliwrightWritableProvider`; mock → `mockserver` + `MockRuntime`;
storage → the optional `ext.fliwright.storage.reset` bridge extension.

**Adapter-provided for exio (registered by the exio integration, not this spec):** secure storage /
auth tokens (exio_wallet, exio_device_security), webview/cookie state, local DBs (drift/sqflite/isar),
pending timers/background streams (exio_ws, exio_monitoring_system), runtime permissions, isolates.

**"Unsupported state" diagnostics (determinism honesty):** if a Scenario declares a `resetCategory`
but (a) no adapter is registered for it, or (b) the adapter returns `'unsupported'` (e.g.,
`storage.reset` extension absent), `reset` does not fail — it records the category in
`ResetReport.unsupported` and the runtime surfaces it as `RuntimeSnapshot.unsupportedState`. The agent
is thus told determinism is partial, never silently lied to.

**Restart-specific drift:** after a hot restart, Riverpod regenerates providers and `main()` re-runs;
the riverpod adapter re-registers overrides against the **new** container and verifies every override
key still exists. Missing keys (generated-provider registration drift) are reported as unsupported
state, not silently dropped.

> Correctness: a `full` reset always runs after a restart (main re-ran → state zeroed); a light reset
> suffices after reload. `TddRuntime.cycle` guarantees this ordering.

### 6.6 PersistentTestExecutor — speed linchpin

In-process, no subprocess. The focused-rerun mechanism uses the **real Vitest 2.1.9 API** (verified in
`node_modules/vitest/dist/.../reporters.*.d.ts`): the `Vitest` instance exposes
`rerunFiles(files?: string[], trigger?: string, allTestsRun?: boolean)` and
`changeNamePattern(pattern, files?, trigger?)` — there is **no options object and no `testNamePattern`
on `rerunFiles`** (the earlier `rerunFiles([file], { testNamePattern })` assumption was wrong).

```ts
import { startVitest } from 'vitest/node';
import type { Vitest } from 'vitest/node';

export class PersistentTestExecutor {
  private vitest?: Vitest;
  async boot(opts: {
    configRoot: string;
    vmServiceUrl?: string;
    driverProvider: () => Promise<FliwrightDriver>;   // accepted for API symmetry; NOT relied on (§6.0)
  }): Promise<void> {
    // Sets FLIWRIGHT_VM_SERVICE_URL so ordinary @fliwright/vitest fixtures connect to the app VM
    // service. force pool:'forks' + singleFork. driverProvider is ignored (worker boundary — §6.0).
    this.vitest = await startVitest('test', [], { /* inherit project fliwright.config.ts + overrides */ });
  }
  async rerun(file: string, testName?: string): Promise<TestRunOutcome> {
    const v = this.vitest!;
    if (testName) await v.changeNamePattern(testName, [file]);   // 2.1.9: filter by name within file (reruns)
    else await v.changeFilenamePattern(file);
    return this.collectFromReporter();   // custom reporter collects pass/fail + reads failure-context
  }
  async dispose(): Promise<void>;
}
```

**Exact focused-rerun recipe is a P0.2 spike outcome (PASSED):** `changeNamePattern(testName, [file])`
reruns internally on 2.1.9 — see §10 / the spike verdict.

**Speed source:** the executor process is created once at boot and reused across reruns (no per-rerun
process spawn). The driver-sharing model is `vm-service-url` (§6.0): fixtures connect to the injected
`FLIWRIGHT_VM_SERVICE_URL`, so an executor rerun is "reset baseline + reload/restart + run one test",
with no `vitest` process spawn and no executor restart. (The single-driver speed win the original
§6.0 promised is *not* realized — fixtures still open their own WS — but the executor-side win is.)

**Mandatory constraint:** vitest defaults to worker-thread isolation, which would reconstruct the
injected driver per worker. The TDD config forces **`pool: 'forks'` + `poolOptions.forks.singleFork:
true`** so the injected singleton is reachable from the test process and survives across reruns. This
sacrifices parallelism — irrelevant since the loop runs a single focused test. The batch/CI path keeps
the default pool and is unaffected.

## 7. MCP Tool Surface (first-class, agent-driven)

Each tool is a thin shim over a `TddRuntime` method; the runtime is lazily created.

| Tool | Input | Output | Runtime method |
|---|---|---|---|
| `fliwright_tdd_start` | `{projectRoot, deviceId?, target?, flutterArgs?, scenario?}` | RuntimeSnapshot | `start` |
| `fliwright_tdd_stop` | `{keepAppAlive?}` | ok | `stop` |
| `fliwright_tdd_focus` | `{file, testName}` | focused info (validates existence) | `focus` |
| `fliwright_tdd_cycle` | `{testName?, forceSync?:'reload'\|'restart'\|'none', repair?}` | TddCycleResult | `cycle` ← **core, called repeatedly** |
| `fliwright_tdd_status` | — | RuntimeSnapshot (cheap poll) | `snapshot` |
| `fliwright_tdd_set_scenario` | `{homeRoute, riverpodOverrides?, mockProfile?, storageSeed?}` | baselineVersion | `baseline.define` |
| `fliwright_tdd_reload` / `fliwright_tdd_restart` | — | sync result (manual override) | daemon direct |
| `fliwright_tdd_repair` (P3) | `{mode:'suggest'\|'safe-apply'}` | repair diff + new cycle result | `repair` |

**Reused existing tools (not re-implemented):** `fliwright_get_failure` (deep failure context),
`fliwright_generate_test` (red-first, enhanced in P2), `fliwright_agent_diagnose` (diagnosis),
`fliwright_screenshot` / `fliwright_snap` (observation).

> Design rule: `tdd_cycle` is the only high-frequency tool; the rest are setup/observation/manual
> override. Failures are always surfaced structurally so the agent can decide the next action; never
> swallowed silently.

## 8. Error Handling

All failures flow through the existing `FliwrightAgentError` (with recovery hints) and are returned
to the agent as structured `TddCycleResult` / error:

| Failure mode | Handling |
|---|---|
| App crash / VM disconnect mid-cycle | cycle returns a result flagged disconnected; runtime exposes `reconnect` (daemon relaunches or re-attaches); never wedges the loop |
| Flutter SDK missing / daemon won't start | `start` fails fast with a `doctor`-style diagnostic |
| reload compile failure | daemon error → returned as `status:'red'` with the Dart compile error; if restart also fails, surface the compile error |
| reload succeeds but didn't reflect a structural change | fallback escalation to restart, cycle once more (rule 6.4.3) |
| Test not found | `focus`/`cycle` returns a clear error |
| vitest boot failure (bad config) | `start` fails with a config diagnostic |
| Partial baseline failure (e.g., no `storage.reset` extension) | non-fatal; the category is added to `RuntimeSnapshot.unsupportedState` (§6.5); loop continues |
| Timeout | per-cycle timeout → red with timeout context (reuses FailureCollector) |
| Concurrent `cycle` calls | serialized (mutex queue); only one cycle at a time |

## 9. Testing Strategy (for `@fliwright/tdd` itself)

**Unit (isolated, fast):**

- `FlutterDaemonController`: fake daemon (stubbed JSON-RPC subprocess) → verify
  `app.start`/`app.restart(fullRestart)` calls, `app.debugPort` wsUri extraction, event handling.
- `ReloadStrategy`: table-driven; given `ChangeSet`s assert reload/restart decisions + the fallback
  escalation path.
- `BaselineManager`: fake driver (stubbed bridge extension calls) → verify reset sequence, `full`
  vs light, graceful degradation when `storage.reset` is absent.
- `PersistentTestExecutor`: throwaway fixture project + a known test → assert rerun returns the
  correct pass/fail. (The original "assert driver connect count == 1 across N reruns" goal is
  dropped — on 2.1.9 the executor does not own the fixture driver; §6.0. Instead assert the
  `vitest` process is not re-spawned across reruns and that red results carry structured details.)
- `TddRuntime.cycle`: all deps faked → assert reset→sync→rerun ordering and result propagation.

**E2E smoke (real Flutter VM, reuse the existing e2e harness):** a mini demo app + a real cycle:
reload picks up a method-body change, restart picks up a structural change. Latency is scoped to what
P0 controls — **assert the rerun-only time (test execution, excluding the flutter-tooling-bound
reload/restart) trends sub-second.** Total cycle time is not asserted, because it is dominated by
`flutter` restart latency outside our control. (The "driver connects exactly once" assertion from the
original draft is dropped on 2.1.9 — see §6.0/§9 unit note.) Two manual harnesses ship under
`packages/fliwright-tdd/spike/` (see `spike/E2E.md`): `e2e-daemon-conformance.mjs` asserts the real
`flutter daemon` wire-format fields the controller depends on (the only place those are checked
against a real daemon), and `e2e-tdd-cycle.mjs` drives the whole runtime start→cycle→stop against a
real app. Both need a booted device, so they are manual (no CI gate).

**Contract tests:** new MCP tools follow the mcp package's existing tool-test pattern; unit-test the
new optional bridge extension `storage.reset`.

## 10. Phased Roadmap

### P0 Core loop (detailed in this spec) — internal slicing

**P0.2 is a hard de-risking spike; P0.3–P0.5 stay blocked until it passes.** Two core assumptions did
not match the repo (review findings #1, #2): the Vitest focused-rerun API and single-driver
ownership. The spike must prove all three before downstream work proceeds:

- **P0.1** `FlutterDaemonController` + reload/restart, gated on `appId`/`supportsRestart`
  (initially wired to the existing one-shot vitest, to prove hot restart works).
- **P0.2 (SPIKE — verdict recorded; see `spike/findings/2026-06-22-spike-verdict.md`):**
  1. **Programmatic focused rerun on Vitest 2.1.9 — PASS.** Recipe = `changeNamePattern(testName,
     [file])` (reruns internally); encoded in `FocusedRerunRecipe.ts`.
  2. **Single driver ownership — REVISED.** The injectable `driverProvider` option shipped in
     `@fliwright/vitest`, but Vitest 2.1.9 runs test files in worker processes, so a live driver
     cannot cross the boundary. Production uses the `vm-service-url` fallback (§6.0) — the
     runtime-owned driver + a fixture-side connection = **two** connections. The single-connection
     goal is deferred to a future Vitest/Node that runs the test in-process.
  3. **Failure-result collection — PASS.** `PersistentTestExecutor` returns pass/fail + structured
     failure details (source/assertion/artifacts) via a custom reporter.
  - **Fallback if the spike fails:** controlled `vitest watch` subprocess for execution. This keeps
    P0.3–P0.5 viable but with **weaker guarantees**: reruns are process-bound (slower, no
    sub-second executor rerun) and the driver is shared via env URL only (baseline-reset driver +
    fixture `sharedDriver` = two connections). The fallback is documented as such, not hidden.
- **P0.3** `BaselineManager` + `Scenario` + reset-adapter contract (unblocked by P0.2).
- **P0.4** `TddRuntime` orchestration + `fliwright_tdd_*` MCP tool group.
- **P0.5** VS Code read-only monitor panel + CLI `fliwright tdd` subcommand.

### P1 (Gap C close-out + Gap F)

- bridge `ext.fliwright.storage.reset` (full determinism).
- MCP `tdd_status` streaming/subscription + VS Code "TDD Loop" panel (focused test / red·green /
  lastSync / baselineVersion / daemonStatus / restartCapable) + optional "take over" command.
- Promote CLI `fliwright tdd` to a first-class subcommand.

### P2 (Gap D — red-first scaffolding)

- `fliwright_generate_test` gains `mode:'red-first'` / `from:'intent'|'figma'|'snapshot'` → emits a
  test that fails meaningfully for not-yet-implemented features (locator-not-found, not a crash).
- `@fliwright/vitest` adds a snapshot-first / golden-first assertion helper.
- VS Code visual editor becomes the red-first authoring surface.

### P3 (Gap E — AI repair closed loop)

- `fliwright_tdd_repair` wires `AgentRepair` into the cycle with a guardrail (safe repairs only;
  `suggest` emits a diff for approval / `safe-apply` applies automatically).
- `tdd_cycle` gains a `repair` option; closed loop: `cycle(red) → repair → cycle`, capped by an
  iteration limit.

## 11. Backward-Compatibility Guarantees

- `vitest` receives **one additive, opt-in extension point** — the injectable driver provider
  (§6.0). Existing `sharedDriver` behavior is preserved when no provider is injected, so non-TDD
  usage is unchanged. **Note (revised 2026-06-25):** on Vitest 2.1.9 this provider is not relied on
  for TDD (worker boundary; §6.0); the production path injects `FLIWRIGHT_VM_SERVICE_URL` instead,
  so fixtures connect to the same app. The provider ships anyway (additive, default-unchanged) and
  is the hook a future in-process-execution mode would use.
- No changes to `core` or existing `bridge` extensions' behavior.
- `mcp` additions are new tools only; existing tools unchanged.
- `vscode` additions are a new panel + commands; the existing session/runner/sandbox/form/recording
  paths are untouched.
- `cli` addition is a new `tdd` subcommand; existing subcommands unchanged.
- The one bridge addition (`storage.reset`) is optional and degrades gracefully when absent.

## 12. Open Questions / Risks

- **Vitest focused-rerun API (resolved).** `changeNamePattern(testName, [file])` reruns internally
  on 2.1.9; encoded in `FocusedRerunRecipe.ts`.
- **Single-driver ownership (resolved — fallback adopted).** The injectable provider ships in
  `@fliwright/vitest`, but 2.1.9's worker-process model means a live driver cannot cross into the
  test process, so production shares via `FLIWRIGHT_VM_SERVICE_URL` (two connections). The
  single-connection goal re-opens only if a future Vitest/Node runs the test in the MCP server's own
  process (§6.0).
- **`flutter daemon` protocol drift across Flutter versions.** `app.start` `appId`, `app.restart
  {fullRestart}`, `supportsRestart`, and the `app.debugPort` wsUri must be stable; `doctor` should
  surface the running Flutter version.
- **`singleFork` interaction with fliwright fixtures.** Confirm the injected driver singleton is
  reachable from the test under `singleFork` and that `singleFork` does not regress existing test
  isolation assumptions.
- **Baseline reset completeness for exio.** Whether the declared reset adapters (secure storage,
  auth tokens, webview, local DB, timers/streams, permissions) fully determinize exio's flows (auth,
  KYC state, trading) needs validation during P0.3; gaps surface as `unsupportedState`.

## 13. References

- Gap analysis source: `fliwright-cli/src/commands/run.ts`, `fliwright-vitest/src/setup.ts`,
  `fliwright-core/src/VMServiceConnector.ts`, `fliwright-vscode/src/runner/VitestRunner.ts`,
  `fliwright-vscode/src/extension.ts` (`onDidSaveTextDocument`).
- Reused capabilities: `@fliwright/core` (driver, page, mock, timeline, AgentRepair, FailureCollector),
  `@fliwright/vitest` (setup/expect/reporter), `@fliwright/plugin-riverpod` (overrides).
- Target consumer: `/Users/leo.he/projects/exio/exio_app` (Riverpod-heavy; `.fliwright/` already
  configured).
