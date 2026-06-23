declare module '@fliwright/tdd' {
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
    baselineVersion: number;
    unsupportedState?: ResetCategory[];
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

  export class TddRuntime {
    start(opts: {
      configRoot: string;
      vmServiceUrl?: string;
      app?: { deviceId: string; target?: string; projectId?: string };
      launchMode?: 'start' | 'attach';
      scenario?: Scenario;
    }): Promise<RuntimeSnapshot>;
    focus(file: string, testName?: string): Promise<void>;
    cycle(testName?: string, opts?: { sync?: 'none' | 'reload' | 'restart'; fullReset?: boolean }): Promise<TddCycleResult>;
    stop(opts?: { keepAppAlive?: boolean }): Promise<void>;
    snapshot(): RuntimeSnapshot;
  }
}
