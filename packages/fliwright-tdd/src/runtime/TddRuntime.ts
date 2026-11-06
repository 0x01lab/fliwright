import { waitForVmServiceEndpoint, EndpointLeaseManager, FliwrightDriver, VmServiceEndpointResolver, explicitEndpointSource } from '@fliwright/core';
import { dirname } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { FlutterDaemonController } from '../daemon/FlutterDaemonController.js';
import { FlutterDaemonEndpointSource } from '../daemon/FlutterDaemonEndpointSource.js';
import { SubprocessDaemonTransport } from '../daemon/SubprocessDaemonTransport.js';
import { decideSync, looksStructuralAfterReload } from '../daemon/ReloadStrategy.js';
import { PersistentTestExecutor } from '../executor/PersistentTestExecutor.js';
import { BaselineManager } from '../baseline/BaselineManager.js';
import { buildTddFailureContext } from '../diagnostics/TddFailureContext.js';
import type {
  CycleOpts,
  RuntimeSnapshot,
  BaselineConfig,
  StartOpts,
  TddCycleResult,
  TddSyncResult,
  TddRuntimeDeps,
} from '../types.js';
import { DEFAULT_CYCLE_TIMEOUT_MS } from '../types.js';

const defaultBaseline: BaselineConfig = {
  homeRoute: '/',
  resetCategories: ['navigation', 'mock'],
};

export class TddRuntime {
  private readonly daemon: NonNullable<TddRuntimeDeps['daemon']>;
  private readonly executor: NonNullable<TddRuntimeDeps['executor']>;
  private readonly driverFactory: NonNullable<TddRuntimeDeps['driverFactory']>;
  private readonly injectedBaseline?: NonNullable<TddRuntimeDeps['baseline']>;
  private baseline?: NonNullable<TddRuntimeDeps['baseline']>;
  private driver?: ReturnType<NonNullable<TddRuntimeDeps['driverFactory']>>;
  private app?: { appId: string; wsUri: string; supportsRestart: boolean };
  private vmServiceUrl?: string;
  private configRoot?: string;
  private sharedConfig?: StartOpts['sharedConfig'];
  private startAppParams?: import('../types.js').StartOpts['app'];
  private defaultScenarioName?: string;
  private baselineConfig: BaselineConfig = defaultBaseline;
  private focusedTest?: { file: string; testName?: string };
  private lastResult?: TddCycleResult;
  private started = false;
  private launchMode: 'start' | 'attach' = 'attach';
  private driverConnections = 0;
  private startSignature?: string;
  private updatedAtMs = Date.now();
  // Serializes runtime/app state mutations (design §8: only one operation at a time). This covers
  // cycle(), manual sync, scenario updates, reconnect, and stop so an agent cannot reload/restart or
  // swap baselines mid-rerun.
  private readonly endpointLeases = new EndpointLeaseManager();
  private operationChain: Promise<unknown> = Promise.resolve();
  private statusFilePath?: string;
  // Serializes best-effort status-file writes so concurrent snapshots never interleave bytes.
  private statusWriteChain: Promise<void> = Promise.resolve();

  constructor(deps: TddRuntimeDeps = {}) {
    this.daemon = deps.daemon ?? new FlutterDaemonController(new SubprocessDaemonTransport());
    this.executor = deps.executor ?? new PersistentTestExecutor();
    this.driverFactory = deps.driverFactory ?? (() => new FliwrightDriver({
      cacheRoot: this.sharedConfig?.cacheRoot,
      projectRoot: this.configRoot && (/\.[cm]?[jt]s$/.test(this.configRoot) ? dirname(this.configRoot) : this.configRoot),
    }));
    this.injectedBaseline = deps.baseline;
    this.baseline = deps.baseline;
  }

  async start(opts: StartOpts): Promise<RuntimeSnapshot> {
    const startSignature = startOptsSignature(opts);
    if (this.started) {
      if (this.startSignature !== startSignature) {
        throw new Error('TddRuntime is already started with different options. Stop it before reconfiguring.');
      }
      return this.snapshot();
    }

    try {
      this.baselineConfig = opts.baselineConfig ?? defaultBaseline;
      this.launchMode = opts.launchMode ?? (opts.app ? 'start' : 'attach');
      this.startSignature = startSignature;
      this.configRoot = opts.configRoot;
      this.sharedConfig = opts.sharedConfig;
      this.startAppParams = opts.app;
      this.statusFilePath = opts.statusFilePath;

      let vmServiceUrl = opts.vmServiceUrl;
      if (opts.app) {
        await this.daemon.start();
        const source = new FlutterDaemonEndpointSource({ controller: this.daemon, ...opts.app });
        const endpoint = await source.acquire();
        this.app = source.lastApp;
        vmServiceUrl = endpoint.url;
        this.launchMode = 'start';
      }

      if (!vmServiceUrl) {
        throw new Error('TddRuntime.start requires either app start params or vmServiceUrl.');
      }
      this.vmServiceUrl = vmServiceUrl;
      this.defaultScenarioName = opts.defaultScenario;

      this.driver = this.driverFactory();
      await this.verifyManagedEndpoint(vmServiceUrl);
      await this.driver.connect(vmServiceUrl);
      this.driverConnections += 1;

      this.baseline = this.baseline ?? this.injectedBaseline ?? new BaselineManager(this.driver);
      await this.executor.boot({ sharedConfig: this.sharedConfig, scenarioMode: this.launchMode === 'start' ? 'managed-start' : 'attach',
        defaultScenario: opts.defaultScenario,
        configRoot: opts.configRoot,
        vmServiceUrl,
      });

      this.started = true;
      this.markUpdated();
      this.persistStatus();
      return this.snapshot();
    } catch (error) {
      await this.executor.dispose().catch(() => undefined);
      await this.cleanupStartedResources().catch(() => undefined);
      throw error;
    }
  }

  /** Interrupt owned transports/execution; the operation chain still drains before reuse. */
  async cancel(): Promise<void> {
    await Promise.allSettled([
      this.driver?.dispose({ signal: AbortSignal.abort() }),
      this.executor.dispose(),
      this.daemon.dispose(),
    ]);
  }

  /** Wait for real work, including a cycle whose caller already received timeout. */
  async whenIdle(): Promise<void> { await this.operationChain; }

  async focus(file: string, testName?: string): Promise<void> {
    this.focusedTest = { file, testName };
    this.markUpdated();
    this.persistStatus();
  }

  /** Select the named scenario that Vitest fixtures prepare before every attempt. */
  async setDefaultScenario(name: string): Promise<RuntimeSnapshot> {
    return this.enqueueOperation(async () => {
      if (!this.started) throw new Error('TddRuntime is not started.');
      await this.executor.dispose();
      await this.executor.boot({ sharedConfig: this.sharedConfig,
        scenarioMode: this.launchMode === 'start' ? 'managed-start' : 'attach',
        configRoot: this.configRoot!, vmServiceUrl: this.vmServiceUrl, defaultScenario: name });
      this.defaultScenarioName = name;
      this.markUpdated();
      this.persistStatus();
      return this.snapshot();
    });
  }

  async setBaselineConfig(config: BaselineConfig): Promise<RuntimeSnapshot> {
    return await this.enqueueOperation(async () => {
      this.baselineConfig = config;
      this.markUpdated();
      this.persistStatus();
      return this.snapshot();
    });
  }

  async syncApp(sync: Exclude<NonNullable<CycleOpts['sync']>, 'auto'>): Promise<TddSyncResult> {
    return await this.enqueueOperation(async () => {
      if (!this.started) throw new Error('TddRuntime is not started.');
      const lastSync = await this.controlPhase(() => this.sync(sync));
      this.markUpdated();
      this.persistStatus();
      return {
        lastSync,
        snapshot: this.snapshot(),
      };
    });
  }

  async cycle(testName?: string, opts: CycleOpts = {}): Promise<TddCycleResult> {
    // Serialize overlapping cycles (design §8): each cycle runs to completion before the next starts.
    // The caller's promise (deferred) is resolved separately so a timeout can return early, while the
    // chain task keeps awaiting the real body — guaranteeing the single-threaded executor is never
    // overlapped by the next cycle even after a timeout.
    const deferred = makeDeferred<TddCycleResult>();
    const task = () => this.runCycleWithEscalation(testName, opts, deferred);
    const run = this.operationChain.then(task, task);
    this.operationChain = run.then(noop, noop);
    return deferred.promise;
  }

  /**
   * Reconnect after a VM disconnect (design §8). Daemon-start relaunches the app and rebinds to the
   * fresh VM service; attach retries the original URL. If the URL changed, the executor is rebooted
   * so fixtures pick up the new `FLIWRIGHT_VM_SERVICE_URL`. Throws on failure; the caller surfaces a
   * structured error. Awaited on the cycle chain so it never races an in-flight rerun.
   */
  async reconnect(): Promise<RuntimeSnapshot> {
    return await this.enqueueOperation(async () => this.reconnectNow());
  }

  private async reconnectNow(): Promise<RuntimeSnapshot> {
    if (!this.started) throw new Error('TddRuntime is not started; nothing to reconnect.');
    await this.driver?.dispose().catch(() => undefined);
    this.driver = undefined;

    let vmServiceUrl = this.vmServiceUrl;
    if (this.startAppParams) {
      await this.daemon.start().catch(() => undefined);
      const source = new FlutterDaemonEndpointSource({ controller: this.daemon, ...this.startAppParams });
      const endpoint = await source.acquire();
      this.app = source.lastApp;
      vmServiceUrl = endpoint.url;
    }
    if (!vmServiceUrl) throw new Error('Cannot reconnect: no VM service URL is available.');

    const urlChanged = vmServiceUrl !== this.vmServiceUrl;
    this.vmServiceUrl = vmServiceUrl;
    if (urlChanged && this.configRoot) {
      // Fixtures read FLIWRIGHT_VM_SERVICE_URL at run time; reboot so the new URL propagates.
      await this.executor.dispose().catch(() => undefined);
      await this.executor.boot({ sharedConfig: this.sharedConfig, scenarioMode: this.launchMode === 'start' ? 'managed-start' : 'attach',
        configRoot: this.configRoot,
        defaultScenario: this.defaultScenarioName,
        vmServiceUrl,
      });
    }

    this.driver = this.driverFactory();
    await this.verifyManagedEndpoint(vmServiceUrl);
    await this.driver.connect(vmServiceUrl);
    this.driverConnections += 1;
    this.baseline = this.injectedBaseline ?? new BaselineManager(this.driver);
    this.markUpdated();
    this.persistStatus();
    return this.snapshot();
  }

  private async verifyManagedEndpoint(vmServiceUrl: string): Promise<void> {
    if (!(this.driver instanceof FliwrightDriver)) return;
    if (this.launchMode === 'start') await waitForVmServiceEndpoint({ url: vmServiceUrl, kind: 'direct-vm', source: 'managed-launch', scope: 'execution-worker', acquiredAt: new Date().toISOString() });
    await new VmServiceEndpointResolver([
      explicitEndpointSource(vmServiceUrl, { source: 'flutter-daemon', scope: 'execution-worker' }),
    ], { persistWorkspaceCache: false }).acquire();
  }

  private async runCycleWithEscalation(
    testName: string | undefined,
    opts: CycleOpts,
    deferred: Deferred<TddCycleResult>,
  ): Promise<TddCycleResult> {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_CYCLE_TIMEOUT_MS;
    const runAll = async (): Promise<TddCycleResult> => {
      const first = await this.performCycle(testName, opts);
      if ((opts.autoEscalate ?? true) && looksStructuralAfterReload(first) && this.canRestart()) {
        try {
          const escalated = await this.performCycle(testName, {
            ...opts,
            sync: 'restart',
            fullReset: true,
            changes: undefined,
            autoEscalate: false,
          });
          if (escalated.lastSync === 'restart') return { ...escalated, syncEscalated: true };
        } catch {
          // Escalation is best-effort: if the restart cycle itself fails, surface the reload result.
        }
      }
      return first;
    };

    // Resolve the caller early on timeout, but keep awaiting `runAll` so the chain (and thus the
    // next cycle) cannot advance past a still-running executor body.
    const timer = setTimeout(() => {
      const timeoutResult = this.timeoutResult(testName, timeoutMs);
      this.lastResult = timeoutResult;
      this.markUpdated();
      this.persistStatus();
      deferred.resolve(timeoutResult);
    }, timeoutMs);
    try {
      const result = await runAll();
      clearTimeout(timer);
      this.lastResult = result;
      this.markUpdated();
      this.persistStatus();
      deferred.resolve(result);
      return result;
    } catch (error) {
      clearTimeout(timer);
      deferred.reject(error);
      throw error;
    }
  }

  private timeoutResult(testName: string | undefined, timeoutMs: number): TddCycleResult {
    const focused = this.focusedTest;
    const file = focused?.file ?? '<unknown>';
    const actualName = testName ?? focused?.testName;
    const baselineVersion = this.baseline?.version ?? 0;
    const message = `TDD cycle exceeded the ${timeoutMs}ms budget and was returned as a timeout.`;
    return {
      status: 'red',
      testName: actualName,
      file,
      durationMs: timeoutMs,
      lastSync: 'none',
      baselineVersion,
      failure: { message },
      failureContext: buildTddFailureContext({
        file,
        testName: actualName,
        message,
        kind: 'timeout',
        baselineVersion,
      }),
      unsupportedState: undefined,
    };
  }

  private async performCycle(testName: string | undefined, opts: CycleOpts): Promise<TddCycleResult> {
    if (!this.started) throw new Error('TddRuntime is not started.');
    const focused = this.focusedTest;
    if (!focused) throw new Error('No focused test. Call focus(file, testName) before cycle().');
    const actualTestName = testName ?? focused.testName;
    const startedAt = Date.now();

    const requestedSync = opts.sync ?? 'none';
    const resolvedSync = requestedSync === 'auto' ? decideSync(opts.changes) : requestedSync;
    let lastSync: TddCycleResult['lastSync'] = 'none';
    try {
      lastSync = await this.controlPhase(() => this.sync(resolvedSync));
    } catch (error) {
      const baselineVersion = this.baseline?.version ?? 0;
      const message = error instanceof Error ? error.message : String(error);
      return {
        status: 'red',
        testName: actualTestName,
        file: focused.file,
        durationMs: Date.now() - startedAt,
        lastSync,
        baselineVersion,
        failure: { message },
        failureContext: buildTddFailureContext({
          file: focused.file,
          testName: actualTestName,
          message,
          kind: 'test-error',
          lastSync,
          baselineVersion,
        }),
      };
    }
    const resetReport = this.defaultScenarioName
      ? { version: this.requireBaseline().version, unsupported: [] }
      : await this.controlPhase(() => this.requireBaseline().reset(this.baselineConfig, {
        full: opts.fullReset ?? lastSync === 'restart',
      }));
    const outcome = await this.executor.rerun(focused.file, actualTestName);

    const unsupportedState = resetReport.unsupported;
    const failureContext = outcome.status === 'red'
      ? buildTddFailureContext({
        file: focused.file,
        testName: outcome.testName ?? actualTestName,
        message: outcome.failure?.message,
        lastSync,
        baselineVersion: resetReport.version,
        unsupportedState,
        source: outcome.failureDetails?.source,
        assertion: outcome.failureDetails?.assertion,
        artifacts: outcome.failureDetails?.artifacts,
      })
      : undefined;

    return {
      status: outcome.status,
      testName: outcome.testName ?? actualTestName,
      file: focused.file,
      durationMs: Date.now() - startedAt,
      lastSync,
      baselineVersion: resetReport.version,
      failure: outcome.failure,
      failureContext,
      timelinePath: outcome.timelinePath ?? outcome.failureDetails?.artifacts?.timelinePath,
      timelineNodeId: outcome.timelineNodeId ?? outcome.failureDetails?.artifacts?.timelineNodeId,
      unsupportedState,
    };
  }

  /**
   * Best-effort, non-blocking dump of {@link snapshot} to {@link statusFilePath}, serialized so
   * concurrent writes never interleave. Read-only monitors (VS Code TDD Loop panel) poll this file
   * instead of opening a second driver connection. Never throws; failures are swallowed.
   */
  private persistStatus(): void {
    this.persistStatusTo(this.statusFilePath);
  }

  private persistStatusTo(statusFilePath: string | undefined): void {
    if (!statusFilePath) return;
    const snapshot = this.snapshot();
    this.statusWriteChain = this.statusWriteChain.then(async () => {
      try {
        await mkdir(dirname(statusFilePath), { recursive: true });
        await writeFile(statusFilePath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
      } catch {
        /* best-effort: a missing status file just means the monitor shows "no snapshot" */
      }
    });
  }

  /** Current endpoint for an owning CLI host; changes after managed reconnect. */
  get endpoint(): string | undefined { return this.vmServiceUrl; }

  snapshot(): RuntimeSnapshot {
    return {
      connected: this.started,
      daemonStatus: this.started ? 'running' : 'stopped',
      appId: this.app?.appId,
      supportsRestart: this.started ? (this.app?.supportsRestart ?? false) : false,
      launchMode: this.launchMode,
      restartCapable: this.launchMode === 'start' && (this.app?.supportsRestart ?? false),
      driverConnections: this.driverConnections,
      fixtureDriverSharing: 'vm-service-url',
      notes: [
        'Vitest 5.0.5 runs tests in worker processes, so live FliwrightDriver objects are not shared across the executor boundary.',
        'The TDD runtime injects FLIWRIGHT_VM_SERVICE_URL so fixtures connect to the same app VM service.',
      ],
      focusedTest: this.focusedTest,
      lastResult: this.lastResult,
      baselineVersion: this.baseline?.version ?? 0,
      unsupportedState: this.lastResult?.unsupportedState,
      updatedAtMs: this.updatedAtMs,
    };
  }

  async stop(opts: { keepAppAlive?: boolean } = {}): Promise<void> {
    await this.enqueueOperation(async () => {
      const statusFilePath = this.statusFilePath;
      try {
        await this.executor.dispose();
      } finally {
        await this.cleanupStartedResources(opts);
      }
      // Publish a final "stopped" snapshot so monitors reflect the halted runtime.
      this.markUpdated();
      this.persistStatusTo(statusFilePath);
      await this.statusWriteChain;
    });
  }

  private markUpdated(): void {
    this.updatedAtMs = Date.now();
  }

  private enqueueOperation<T>(task: () => Promise<T>): Promise<T> {
    const run = this.operationChain.then(task, task);
    this.operationChain = run.then(noop, noop);
    return run;
  }

  private async controlPhase<T>(work: () => Promise<T>): Promise<T> {
    return this.vmServiceUrl ? this.endpointLeases.run(this.vmServiceUrl, work) : work();
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

  /** True only when a daemon-started app advertised restart support (gates auto-escalation). */
  private canRestart(): boolean {
    return this.launchMode === 'start' && (this.app?.supportsRestart ?? false);
  }

  private requireDriver(): NonNullable<typeof this.driver> {
    if (!this.driver) throw new Error('TddRuntime driver is not connected.');
    return this.driver;
  }

  private requireBaseline(): NonNullable<typeof this.baseline> {
    if (!this.baseline) throw new Error('TddRuntime baseline is not initialized.');
    return this.baseline;
  }

  private async cleanupStartedResources(opts: { keepAppAlive?: boolean } = {}): Promise<void> {
    try {
      await this.driver?.dispose();
    } finally {
      try {
        if (!opts.keepAppAlive && this.app) await this.daemon.stop(this.app.appId);
      } finally {
        try {
          await this.daemon.dispose(opts);
        } finally {
          this.driver = undefined;
          this.app = undefined;
          this.vmServiceUrl = undefined;
          this.configRoot = undefined;
          this.sharedConfig = undefined;
          this.defaultScenarioName = undefined;
          this.startAppParams = undefined;
          this.baseline = undefined;
          this.focusedTest = undefined;
          this.lastResult = undefined;
          this.startSignature = undefined;
          this.launchMode = 'attach';
          this.started = false;
        }
      }
    }
  }
}

function startOptsSignature(opts: StartOpts): string {
  return JSON.stringify({
    app: opts.app
      ? {
        deviceId: opts.app.deviceId,
        flutterArgs: opts.app.flutterArgs,
        mode: opts.app.mode,
        projectId: opts.app.projectId,
        target: opts.app.target ?? 'lib/main.dart',
      }
      : undefined,
    configRoot: opts.configRoot,
    sharedConfig: opts.sharedConfig,
    launchMode: opts.launchMode ?? (opts.app ? 'start' : 'attach'),
    baselineConfig: opts.baselineConfig ?? defaultBaseline,
    defaultScenario: opts.defaultScenario,
    statusFilePath: opts.statusFilePath,
    vmServiceUrl: opts.vmServiceUrl,
  });
}

function noop(): void {
  /* chain keeper: swallows task rejections so the mutex never wedges */
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function makeDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
