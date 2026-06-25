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
}
