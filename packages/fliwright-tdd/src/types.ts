import type { PersistentTestExecutor } from './executor/PersistentTestExecutor.js';
import type { ResetContext } from './baseline/BaselineManager.js';
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

/** Low-level reset options. Business setup uses a named TestScenario via defaultScenario. */
export interface BaselineConfig {
  homeRoute: string;
  resetCategories: ResetCategory[];
  riverpodOverrides?: unknown[];
  mockProfile?: string;
  mockDir?: string;
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
  fixtureDriverSharing: 'vm-service-url';
  notes?: string[];
  focusedTest?: { file: string; testName?: string };
  lastResult?: TddCycleResult;
  baselineVersion: number;
  unsupportedState?: ResetCategory[];
  updatedAtMs?: number;
}

export interface StartOpts {
  sharedConfig?: Partial<import('@fliwright/core').FliwrightProjectConfig>;
  app?: AppStartParams;
  vmServiceUrl?: string;
  configRoot: string;
  launchMode?: 'start' | 'attach';
  baselineConfig?: BaselineConfig;
  defaultScenario?: string;
  /**
   * Optional path the runtime writes its {@link RuntimeSnapshot} to after each state change
   * (start/focus/cycle/reconnect/stop), as a best-effort, non-blocking JSON dump. Lets read-only
   * monitors (e.g. the VS Code TDD Loop panel) observe the loop without a second driver connection.
   * Defaults to `~/.fliwright/<project-path>/runtime/tdd-status.json` when set by the CLI layer.
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
}

/** Default per-cycle timeout (design §8). Generous: real reruns are sub-second; restarts are seconds. */
export const DEFAULT_CYCLE_TIMEOUT_MS = 60_000;

export interface TddCycleResult {
  status: 'red' | 'green';
  testName?: string;
  file: string;
  durationMs: number;
  lastSync: 'reload' | 'restart' | 'none';
  /** True only when an automatic reload failure retry escalated this cycle to one restart. */
  syncEscalated?: boolean;
  baselineVersion: number;
  failure?: { message?: string };
  failureContext?: TddFailureContext;
  /** Existing per-test timeline produced by @fliwright/vitest, available for both red and green runs. */
  timelinePath?: string;
  timelineNodeId?: string;
  unsupportedState?: ResetCategory[];
}

export interface TddSyncResult {
  lastSync: TddCycleResult['lastSync'];
  snapshot: RuntimeSnapshot;
}

export interface TddRuntimeDeps {
  daemon?: {
    start(): Promise<void>;
    startApp(params: AppStartParams): Promise<AppHandle>;
    reload(appId: string): Promise<void>;
    restart(appId: string): Promise<void>;
    stop(appId: string): Promise<void>;
    dispose(options?: { keepAppAlive?: boolean }): Promise<void>;
  };
  executor?: Pick<PersistentTestExecutor, 'boot' | 'rerun' | 'dispose'>;
  driverFactory?: () => ResetContext['driver'] & {
    connect(vmServiceUrl: string): Promise<void>;
    dispose(options?: { signal?: AbortSignal }): Promise<void>;
    reloadSources?(): Promise<unknown>;
  };
  baseline?: {
    reset(scenario: BaselineConfig, opts: { full?: boolean }): Promise<ResetReport>;
    get version(): number;
  };
}
