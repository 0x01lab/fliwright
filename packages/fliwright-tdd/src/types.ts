import type { RepairProposal, RepairResult } from '@fliwright/core';
import type { AppHandle, AppStartParams } from './daemon/DaemonTransport.js';
import type { TddFailureContext } from './diagnostics/TddFailureContext.js';

export type ResetCategory =
  | 'navigation'
  | 'riverpod'
  | 'mock'
  | 'storage'
  | 'secureStorage'
  | 'authTokens'
  | 'webview'
  | 'localDb'
  | 'timers'
  | 'isolates'
  | 'permissions';

export interface Scenario {
  homeRoute: string;
  resetCategories: ResetCategory[];
  riverpodOverrides?: unknown[];
  mockProfile?: string;
  storageSeed?: Record<string, unknown>;
}

export interface ResetAdapterResult {
  category: ResetCategory;
  status: 'ok' | 'skipped' | 'unsupported';
  message?: string;
}

export interface ResetReport {
  version: number;
  full: boolean;
  results: ResetAdapterResult[];
  unsupported: ResetCategory[];
}

export interface RuntimeSnapshot {
  connected: boolean;
  daemonStatus: 'running' | 'stopped' | 'unknown';
  appId?: string;
  supportsRestart: boolean;
  launchMode: 'start' | 'attach';
  restartCapable: boolean;
  driverConnections: number;
  fixtureDriverSharing: 'in-process-provider' | 'vm-service-url';
  notes?: string[];
  focusedTest?: { file: string; testName?: string };
  lastResult?: TddCycleResult;
  baselineVersion: number;
  unsupportedState?: ResetCategory[];
}

export interface StartOpts {
  app?: AppStartParams;
  vmServiceUrl?: string;
  configRoot: string;
  launchMode?: 'start' | 'attach';
  scenario?: Scenario;
  /**
   * Optional path the runtime writes its {@link RuntimeSnapshot} to after each state change
   * (start/focus/cycle/reconnect/stop), as a best-effort, non-blocking JSON dump. Lets read-only
   * monitors (e.g. the VS Code TDD Loop panel) observe the loop without a second driver connection.
   * Defaults to `<projectRoot>/.fliwright/tdd-status.json` when set by the MCP/CLI layer.
   */
  statusFilePath?: string;
}

export interface CycleOpts {
  /** How to sync the app before this cycle. `'auto'` decides from {@link changes} (design §6.4). */
  sync?: 'none' | 'reload' | 'restart' | 'auto';
  fullReset?: boolean;
  /**
   * File paths changed since the last sync. Used only when {@link sync} is `'auto'` to choose
   * reload vs restart via `decideSync`. Ignored for explicit sync levels.
   */
  changes?: string[];
  /**
   * When true (default), a `reload` cycle that fails with a structural-looking error is retried
   * once with a hot restart + full reset, if the runtime can restart. Set false to keep the raw
   * reload result. Design §6.4 fallback-escalation rule.
   */
  autoEscalate?: boolean;
  /**
   * Per-cycle wall-clock budget (ms) covering sync + reset + rerun. On expiry the caller receives a
   * red `timeout` result immediately, but the in-flight body is allowed to finish so the next cycle
   * never overlaps the single-threaded executor. Design §8 Timeout. Default {@link DEFAULT_CYCLE_TIMEOUT_MS}.
   */
  timeoutMs?: number;
  /**
   * Run an inline AI repair closed loop (design §7 P3 / §10 P3). When set, a red initial cycle is
   * followed by repair → cycle again, up to {@link TddRepairOpts.iterations} (default 3).
   * - `'suggest'`: stop after emitting the repair diff/plan (no apply, no loop).
   * - `'safe-apply'`: apply only guarded safe repairs and loop until green or the cap.
   * Additive: omitted → identical to today's behavior. Requires a repair planner wired into
   * {@link TddRuntimeDeps.repair}.
   */
  repair?: TddRepairOpts;
}

/**
 * Options for the AI repair closed loop (design §7 P3).
 *
 * - `'suggest'` emits a repair plan (diff + proposed safe actions) for agent approval and applies
 *   nothing; the loop does not iterate.
 * - `'safe-apply'` applies only guarded safe repairs (those that pass the AgentRepair guardrail)
 *   and loops `cycle(red) → repair → cycle` until green or the iteration cap.
 */
export interface TddRepairOpts {
  mode: 'suggest' | 'safe-apply';
  /**
   * Maximum number of repair→cycle iterations in safe-apply mode. Default 3. Ignored for 'suggest'
   * (which never loops). The cap prevents unbounded AI edits; reaching it still red is a terminal
   * state surfaced to the agent.
   */
  iterations?: number;
}

/**
 * One proposed repair action with its guardrail verdict. `safe` is true only when the AgentRepair
 * `validate()` guard accepts it (i.e. it is a bounded runtime action, never a `codePatch`).
 */
export interface TddRepairProposalEntry {
  proposal: RepairProposal;
  /** True when the guardrail accepts this proposal; false when rejected as unsafe/unsupported. */
  safe: boolean;
  /** Rejection reason from the guardrail, when `safe` is false. */
  reason?: string;
}

/**
 * A repair plan: the proposed patch text (for agent approval / `suggest` mode) plus the individual
 * repair actions and their guardrail verdicts. In `suggest` mode this is returned without applying;
 * in `safe-apply` mode only the `safe` entries are executed.
 */
export interface TddRepairPlan {
  mode: 'suggest' | 'safe-apply';
  /** Human/agent-readable patch/diff describing the proposed minimal fix. */
  diff: string;
  /** Individual proposed repair actions with their guardrail verdicts. */
  proposals: TddRepairProposalEntry[];
}

/**
 * The outcome of one repair step inside the closed loop: the plan proposed, and (in safe-apply mode)
 * the AgentRepair execute results for the actions actually attempted.
 */
export interface TddRepairStep {
  /** 1-based index of this repair iteration within the loop. */
  iteration: number;
  plan: TddRepairPlan;
  /** Only populated in safe-apply mode: one AgentRepair result per safe proposal that was executed. */
  applied?: RepairResult[];
}

/**
 * The full repair trace returned by the closed loop. Empty when no repair was requested, when the
 * initial cycle was already green, or when no repair planner is configured.
 */
export interface TddRepairTrace {
  mode: 'suggest' | 'safe-apply';
  /** Per-iteration repair steps (one for each cycle(red) → repair pass). */
  steps: TddRepairStep[];
  /** True when the iteration cap was reached while still red. */
  capped: boolean;
}

/** Default per-cycle timeout (design §8). Generous: real reruns are sub-second; restarts are seconds. */
export const DEFAULT_CYCLE_TIMEOUT_MS = 60_000;

export interface TddCycleResult {
  status: 'red' | 'green';
  testName?: string;
  file: string;
  durationMs: number;
  lastSync: 'reload' | 'restart' | 'none';
  baselineVersion: number;
  failure?: { message?: string };
  failureContext?: TddFailureContext;
  unsupportedState?: ResetCategory[];
}

export interface TddRuntimeDeps {
  daemon?: {
    start(): Promise<void>;
    startApp(params: AppStartParams): Promise<AppHandle>;
    reload(appId: string): Promise<void>;
    restart(appId: string): Promise<void>;
    stop(appId: string): Promise<void>;
    dispose(): Promise<void>;
  };
  executor?: {
    boot(opts: { configRoot: string; vmServiceUrl?: string; driverProvider: () => Promise<unknown> }): Promise<void>;
    rerun(file: string, testName?: string): Promise<{
      status: 'red' | 'green';
      testName?: string;
      failure?: { message?: string };
      failureDetails?: {
        source?: {
          file: string;
          line: number;
          snippet: string;
        };
        assertion?: {
          matcher: string;
          expected: string;
          actual: string;
          timeout: number;
        };
        artifacts?: {
          failureContextPath?: string;
          screenshotPath?: string;
          screenshotBase64?: string;
          widgetTree?: unknown;
          timelinePath?: string;
          timelineNodeId?: string;
        };
      };
    }>;
    dispose(): Promise<void>;
  };
  driverFactory?: () => {
    connect(vmServiceUrl: string): Promise<void>;
    dispose(): Promise<void>;
    page: {
      resetToHome(options?: { homeRoute?: string }): Promise<void>;
    };
    mock: {
      clear(): Promise<void>;
      clearCalls(): Promise<void>;
    };
    reloadSources?(): Promise<unknown>;
  };
  baseline?: {
    reset(scenario: Scenario, opts: { full?: boolean }): Promise<ResetReport>;
    get version(): number;
  };
  /**
   * Optional AI repair planner (design §6.2 `repair?: AgentRepair`, wired in P3). When absent, the
   * cycle behaves identically to today (no repair loop). When present, a cycle requested with
   * {@link CycleOpts.repair} runs the closed loop: cycle(red) → repair → cycle, capped by an
   * iteration limit, applying only guardrail-safe repairs in 'safe-apply' mode.
   *
   * Exposed as a minimal interface so production can pass a `TddRepairPlanner` while tests inject a
   * fake without depending on `@fliwright/core`'s `AgentRepair` directly.
   */
  repair?: TddRepairPlannerLike;
}

/**
 * Minimal repair-planner contract injected into {@link TddRuntimeDeps.repair}. Production wires a
 * {@link TddRepairPlanner} backed by `@fliwright/core`'s `AgentRepair`; tests pass a fake that
 * proposes deterministic patches.
 */
export interface TddRepairPlannerLike {
  /**
   * Propose a minimal repair plan for a red cycle result.
   *
   * - `'suggest'`: returns the plan (diff + proposed actions with guardrail verdicts) and applies
   *   nothing. The loop does not iterate.
   * - `'safe-apply'`: applies only the guardrail-safe proposals via the underlying `AgentRepair`
   *   and returns the plan plus the execute results for the attempted actions.
   */
  propose(result: TddCycleResult, mode: 'suggest' | 'safe-apply'): Promise<TddRepairPlan & { applied?: RepairResult[] }>;
}

/**
 * Result of a cycle that ran the optional repair closed loop. When no repair was requested the
 * runtime returns a plain {@link TddCycleResult}; when {@link CycleOpts.repair} is set, the cycle
 * returns this shape carrying the final cycle outcome plus the repair trace.
 */
export interface TddRepairCycleResult extends TddCycleResult {
  /** Repair trace: diffs suggested/applied across the loop. Empty iff the initial cycle was green. */
  repair: TddRepairTrace;
}
