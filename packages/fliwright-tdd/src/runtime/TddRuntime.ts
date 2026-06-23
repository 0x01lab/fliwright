import { FliwrightDriver } from '@fliwright/core';
import { FlutterDaemonController } from '../daemon/FlutterDaemonController.js';
import { SubprocessDaemonTransport } from '../daemon/SubprocessDaemonTransport.js';
import { PersistentTestExecutor } from '../executor/PersistentTestExecutor.js';
import { BaselineManager } from '../baseline/BaselineManager.js';
import type {
  CycleOpts,
  RuntimeSnapshot,
  Scenario,
  StartOpts,
  TddCycleResult,
  TddRuntimeDeps,
} from '../types.js';

const defaultScenario: Scenario = {
  homeRoute: '/',
  resetCategories: ['navigation', 'mock'],
};

export class TddRuntime {
  private readonly daemon: NonNullable<TddRuntimeDeps['daemon']>;
  private readonly executor: NonNullable<TddRuntimeDeps['executor']>;
  private readonly driverFactory: NonNullable<TddRuntimeDeps['driverFactory']>;
  private baseline?: NonNullable<TddRuntimeDeps['baseline']>;
  private driver?: ReturnType<NonNullable<TddRuntimeDeps['driverFactory']>>;
  private app?: { appId: string; wsUri: string; supportsRestart: boolean };
  private vmServiceUrl?: string;
  private scenario: Scenario = defaultScenario;
  private focusedTest?: { file: string; testName?: string };
  private lastResult?: TddCycleResult;
  private started = false;
  private launchMode: 'start' | 'attach' = 'start';
  private driverConnections = 0;

  constructor(deps: TddRuntimeDeps = {}) {
    this.daemon = deps.daemon ?? new FlutterDaemonController(new SubprocessDaemonTransport());
    this.executor = deps.executor ?? new PersistentTestExecutor();
    this.driverFactory = deps.driverFactory ?? (() => new FliwrightDriver());
    this.baseline = deps.baseline;
  }

  async start(opts: StartOpts): Promise<RuntimeSnapshot> {
    if (this.started) return this.snapshot();

    this.scenario = opts.scenario ?? defaultScenario;
    this.launchMode = opts.launchMode ?? (opts.app ? 'start' : 'attach');

    let vmServiceUrl = opts.vmServiceUrl;
    if (opts.app) {
      await this.daemon.start();
      const app = await this.daemon.startApp(opts.app);
      this.app = app;
      vmServiceUrl = app.wsUri;
      this.launchMode = 'start';
    }

    if (!vmServiceUrl) {
      throw new Error('TddRuntime.start requires either app start params or vmServiceUrl.');
    }
    this.vmServiceUrl = vmServiceUrl;

    this.driver = this.driverFactory();
    await this.driver.connect(vmServiceUrl);
    this.driverConnections += 1;

    this.baseline = this.baseline ?? new BaselineManager(this.driver);
    await this.executor.boot({
      configRoot: opts.configRoot,
      vmServiceUrl,
      driverProvider: async () => this.requireDriver(),
    });

    this.started = true;
    return this.snapshot();
  }

  async focus(file: string, testName?: string): Promise<void> {
    this.focusedTest = { file, testName };
  }

  async cycle(testName?: string, opts: CycleOpts = {}): Promise<TddCycleResult> {
    if (!this.started) throw new Error('TddRuntime is not started.');
    const focused = this.focusedTest;
    if (!focused) throw new Error('No focused test. Call focus(file, testName) before cycle().');
    const actualTestName = testName ?? focused.testName;
    const startedAt = Date.now();

    const lastSync = await this.sync(opts.sync ?? 'none');
    const resetReport = await this.requireBaseline().reset(this.scenario, {
      full: opts.fullReset ?? lastSync === 'restart',
    });
    const outcome = await this.executor.rerun(focused.file, actualTestName);

    this.lastResult = {
      status: outcome.status,
      testName: outcome.testName ?? actualTestName,
      file: focused.file,
      durationMs: Date.now() - startedAt,
      lastSync,
      baselineVersion: resetReport.version,
      failure: outcome.failure,
      unsupportedState: resetReport.unsupported,
    };
    return this.lastResult;
  }

  snapshot(): RuntimeSnapshot {
    return {
      connected: this.started,
      daemonStatus: this.started ? 'running' : 'stopped',
      appId: this.app?.appId,
      supportsRestart: this.app?.supportsRestart ?? this.launchMode === 'attach',
      launchMode: this.launchMode,
      restartCapable: this.launchMode === 'start' && (this.app?.supportsRestart ?? false),
      driverConnections: this.driverConnections,
      fixtureDriverSharing: 'vm-service-url',
      notes: [
        'Vitest 2.1.9 runs tests in worker processes, so live FliwrightDriver objects are not shared across the executor boundary.',
        'The TDD runtime injects FLIWRIGHT_VM_SERVICE_URL so fixtures connect to the same app VM service.',
      ],
      focusedTest: this.focusedTest,
      lastResult: this.lastResult,
      baselineVersion: this.baseline?.version ?? 0,
      unsupportedState: this.lastResult?.unsupportedState,
    };
  }

  async stop(opts: { keepAppAlive?: boolean } = {}): Promise<void> {
    try {
      await this.executor.dispose();
    } finally {
      try {
        await this.driver?.dispose();
      } finally {
        if (!opts.keepAppAlive && this.app) await this.daemon.stop(this.app.appId);
        await this.daemon.dispose();
        this.driver = undefined;
        this.app = undefined;
        this.vmServiceUrl = undefined;
        this.started = false;
      }
    }
  }

  private async sync(sync: NonNullable<CycleOpts['sync']>): Promise<TddCycleResult['lastSync']> {
    if (sync === 'none') return 'none';
    if (!this.app) {
      if (sync === 'restart') throw new Error('Hot restart requires a daemon-started app.');
      await this.requireDriver().reloadSources?.();
      return 'reload';
    }
    if (sync === 'reload') {
      await this.daemon.reload(this.app.appId);
      return 'reload';
    }
    await this.daemon.restart(this.app.appId);
    return 'restart';
  }

  private requireDriver(): NonNullable<typeof this.driver> {
    if (!this.driver) throw new Error('TddRuntime driver is not connected.');
    return this.driver;
  }

  private requireBaseline(): NonNullable<typeof this.baseline> {
    if (!this.baseline) throw new Error('TddRuntime baseline is not initialized.');
    return this.baseline;
  }
}
