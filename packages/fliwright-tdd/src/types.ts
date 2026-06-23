import type { AppHandle, AppStartParams } from './daemon/DaemonTransport.js';

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
  sync?: 'none' | 'reload' | 'restart';
  fullReset?: boolean;
}

export interface TddCycleResult {
  status: 'red' | 'green';
  testName?: string;
  file: string;
  durationMs: number;
  lastSync: 'reload' | 'restart' | 'none';
  baselineVersion: number;
  failure?: { message?: string };
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
    rerun(file: string, testName?: string): Promise<{ status: 'red' | 'green'; testName?: string; failure?: { message?: string } }>;
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
