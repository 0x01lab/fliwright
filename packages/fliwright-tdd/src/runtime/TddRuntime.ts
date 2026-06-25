import { FliwrightDriver } from '@fliwright/core';
import { dirname } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { FlutterDaemonController } from '../daemon/FlutterDaemonController.js';
import { SubprocessDaemonTransport } from '../daemon/SubprocessDaemonTransport.js';
import { decideSync, looksStructuralAfterReload } from '../daemon/ReloadStrategy.js';
import { PersistentTestExecutor } from '../executor/PersistentTestExecutor.js';
import { BaselineManager } from '../baseline/BaselineManager.js';
import { TddRepairPlanner } from '../repair/TddRepairPlanner.js';
import { buildTddFailureContext } from '../diagnostics/TddFailureContext.js';
import type {
  CycleOpts,
  RuntimeSnapshot,
  Scenario,
  StartOpts,
  TddCycleResult,
  TddRepairCycleResult,
  TddRepairOpts,
  TddRepairPlannerLike,
  TddRepairStep,
  TddRepairTrace,
  TddRuntimeDeps,
} from '../types.js';
import { DEFAULT_CYCLE_TIMEOUT_MS } from '../types.js';

const defaultScenario: Scenario = {
  homeRoute: '/',
  resetCategories: ['navigation', 'mock'],
};

/** Default cap on repair→cycle iterations (design §7 P3). Prevents unbounded AI edits. */
const DEFAULT_REPAIR_ITERATIONS = 3;

export class TddRuntime {
  private readonly daemon: NonNullable<TddRuntimeDeps['daemon']>;
  private readonly executor: NonNullable<TddRuntimeDeps['executor']>;
  private readonly driverFactory: NonNullable<TddRuntimeDeps['driverFactory']>;
  private readonly injectedBaseline?: NonNullable<TddRuntimeDeps['baseline']>;
  private baseline?: NonNullable<TddRuntimeDeps['baseline']>;
  /** Optional AI repair planner (design §6.2, wired P3). Absent → no repair loop (additive). */
  private repairPlanner?: TddRepairPlannerLike;
  private driver?: ReturnType<NonNullable<TddRuntimeDeps['driverFactory']>>;
  private app?: { appId: string; wsUri: string; supportsRestart: boolean };
  private vmServiceUrl?: string;
  private configRoot?: string;
  private startAppParams?: import('../types.js').StartOpts['app'];
  private scenario: Scenario = defaultScenario;
  private focusedTest?: { file: string; testName?: string };
  private lastResult?: TddCycleResult;
  private started = false;
  private launchMode: 'start' | 'attach' = 'attach';
  private driverConnections = 0;
  private startSignature?: string;
  // Serializes overlapping cycle() calls (design §8: only one cycle at a time). Also awaited by
  // stop() so we never dispose the executor mid-rerun.
  private cycleChain: Promise<unknown> = Promise.resolve();
  private statusFilePath?: string;
  // Serializes best-effort status-file writes so concurrent snapshots never interleave bytes.
  private statusWriteChain: Promise<void> = Promise.resolve();

  constructor(deps: TddRuntimeDeps = {}) {
    this.daemon = deps.daemon ?? new FlutterDaemonController(new SubprocessDaemonTransport());
    this.executor = deps.executor ?? new PersistentTestExecutor();
    this.driverFactory = deps.driverFactory ?? (() => new FliwrightDriver());
    this.injectedBaseline = deps.baseline;
    this.baseline = deps.baseline;
    this.repairPlanner = deps.repair;
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
      this.scenario = opts.scenario ?? defaultScenario;
      this.launchMode = opts.launchMode ?? (opts.app ? 'start' : 'attach');
      this.startSignature = startSignature;
      this.configRoot = opts.configRoot;
      this.startAppParams = opts.app;
      this.statusFilePath = opts.statusFilePath;

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

      // Auto-wire the repair planner from the real driver's page so fliwright_tdd_repair works
      // out of the box. Skipped when a planner was injected, and for non-FliwrightDriver test
      // doubles (their page lacks the AgentRepair surface) — keeping the path additive.
      if (!this.repairPlanner && this.driver instanceof FliwrightDriver) {
        this.repairPlanner = TddRepairPlanner.forPage(this.driver.page);
      }

      this.baseline = this.baseline ?? this.injectedBaseline ?? new BaselineManager(this.driver);
      await this.executor.boot({
        configRoot: opts.configRoot,
        vmServiceUrl,
        driverProvider: async () => this.requireDriver(),
      });

      this.started = true;
      this.persistStatus();
      return this.snapshot();
    } catch (error) {
      await this.executor.dispose().catch(() => undefined);
      await this.cleanupStartedResources().catch(() => undefined);
      throw error;
    }
  }

  async focus(file: string, testName?: string): Promise<void> {
    this.focusedTest = { file, testName };
    this.persistStatus();
  }

  async cycle(testName?: string, opts: CycleOpts = {}): Promise<TddCycleResult> {
    // Serialize overlapping cycles (design §8): each cycle runs to completion before the next starts.
    // The caller's promise (deferred) is resolved separately so a timeout can return early, while the
    // chain task keeps awaiting the real body — guaranteeing the single-threaded executor is never
    // overlapped by the next cycle even after a timeout.
    //
    // When opts.repair is set, the same chain task also runs the AI repair closed loop after the
    // initial cycle (design §7/§10 P3): the whole loop (initial cycle + repair proposals + re-cycles)
    // lives inside this serialized task, so it can never overlap another cycle or be reentered.
    const deferred = makeDeferred<TddCycleResult>();
    const task = () => this.runCycleWithEscalation(testName, opts, deferred);
    this.cycleChain = this.cycleChain.then(task, task).then(noop, noop);
    return deferred.promise;
  }

  /**
   * Reconnect after a VM disconnect (design §8). Daemon-start relaunches the app and rebinds to the
   * fresh VM service; attach retries the original URL. If the URL changed, the executor is rebooted
   * so fixtures pick up the new `FLIWRIGHT_VM_SERVICE_URL`. Throws on failure; the caller surfaces a
   * structured error. Awaited on the cycle chain so it never races an in-flight rerun.
   */
  async reconnect(): Promise<RuntimeSnapshot> {
    if (!this.started) throw new Error('TddRuntime is not started; nothing to reconnect.');
    await this.cycleChain.catch(() => undefined);
    await this.driver?.dispose().catch(() => undefined);
    this.driver = undefined;

    let vmServiceUrl = this.vmServiceUrl;
    if (this.startAppParams) {
      await this.daemon.start().catch(() => undefined);
      const app = await this.daemon.startApp(this.startAppParams);
      this.app = app;
      vmServiceUrl = app.wsUri;
    }
    if (!vmServiceUrl) throw new Error('Cannot reconnect: no VM service URL is available.');

    const urlChanged = vmServiceUrl !== this.vmServiceUrl;
    this.vmServiceUrl = vmServiceUrl;
    if (urlChanged && this.configRoot) {
      // Fixtures read FLIWRIGHT_VM_SERVICE_URL at run time; reboot so the new URL propagates.
      await this.executor.dispose().catch(() => undefined);
      await this.executor.boot({
        configRoot: this.configRoot,
        vmServiceUrl,
        driverProvider: async () => this.requireDriver(),
      });
    }

    this.driver = this.driverFactory();
    await this.driver.connect(vmServiceUrl);
    this.driverConnections += 1;
    this.persistStatus();
    return this.snapshot();
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
          if (escalated.lastSync === 'restart') return escalated;
        } catch {
          // Escalation is best-effort: if the restart cycle itself fails, surface the reload result.
        }
      }
      return first;
    };

    // Resolve the caller early on timeout, but keep awaiting `runAll` so the chain (and thus the
    // next cycle) cannot advance past a still-running executor body.
    const timer = setTimeout(() => {
      const timeoutResult = this.timeoutResult(testName);
      this.lastResult = timeoutResult;
      this.persistStatus();
      deferred.resolve(timeoutResult);
    }, timeoutMs);
    try {
      const result = await runAll();
      clearTimeout(timer);
      // AI repair closed loop (design §7/§10 P3). Runs only when requested AND a planner is wired.
      // Entirely serialized: lives inside this chain task, so it never overlaps another cycle and is
      // not reentrant. 'suggest' stops after one proposal (no apply, no loop); 'safe-apply' loops
      // cycle(red) → repair → cycle until green or the iteration cap. Omitted → byte-for-byte today.
      const finalResult = opts.repair && this.repairPlanner && result.status === 'red'
        ? await this.runRepairLoop(testName, opts, result)
        : result;
      this.lastResult = finalResult;
      this.persistStatus();
      deferred.resolve(finalResult);
      return finalResult;
    } catch (error) {
      clearTimeout(timer);
      deferred.reject(error);
      throw error;
    }
  }

  /**
   * The AI repair closed loop (design §7/§10 P3). Runs serialized inside the cycle chain task after
   * the initial red cycle. Proposes a minimal, guardrail-bounded repair via the wired planner, then
   * (safe-apply only) re-cycles until green or the iteration cap. Never reentrant: the caller has
   * already acquired the chain; this method calls {@link performCycle} directly (not {@link cycle}).
   *
   * In 'suggest' mode it proposes once, attaches the diff as a repair trace, and returns the original
   * red result unchanged (nothing applied). In 'safe-apply' mode it applies only guardrail-safe
   * repairs and re-cycles; reaching the cap still red is a terminal state surfaced via the trace.
   */
  private async runRepairLoop(
    testName: string | undefined,
    opts: CycleOpts,
    initialRed: TddCycleResult,
  ): Promise<TddRepairCycleResult> {
    const repairOpts: TddRepairOpts = opts.repair!;
    const planner = this.repairPlanner!;
    const maxIterations = repairOpts.iterations && repairOpts.iterations > 0 ? repairOpts.iterations : DEFAULT_REPAIR_ITERATIONS;

    const steps: TddRepairStep[] = [];
    let current: TddCycleResult = initialRed;
    let capped = false;

    // Re-cycle options for each repair iteration: no nested repair, keep the caller's sync/reset
    // policy, but disable auto-escalation (already attempted on the initial cycle).
    const reCycleOpts: CycleOpts = {
      ...opts,
      repair: undefined,
      autoEscalate: false,
    };

    for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
      const planAndApplied = await planner.propose(current, repairOpts.mode);
      const step: TddRepairStep = { iteration, plan: planAndApplied };
      if (repairOpts.mode === 'safe-apply' && planAndApplied.applied) {
        step.applied = planAndApplied.applied;
      }
      steps.push(step);

      // 'suggest' never loops or applies: emit the diff and stop on the first proposal.
      if (repairOpts.mode === 'suggest') break;

      // safe-apply: nothing safe was applied this iteration → no point re-cycling, stop.
      if (!planAndApplied.applied || planAndApplied.applied.length === 0) break;

      current = await this.performCycle(testName, reCycleOpts);
      if (current.status === 'green') break;
      if (iteration === maxIterations) capped = true;
    }

    const trace: TddRepairTrace = { mode: repairOpts.mode, steps, capped };
    return { ...current, repair: trace };
  }

  private timeoutResult(testName: string | undefined): TddCycleResult {
    const focused = this.focusedTest;
    const file = focused?.file ?? '<unknown>';
    const actualName = testName ?? focused?.testName;
    const baselineVersion = this.baseline?.version ?? 0;
    const message = `TDD cycle exceeded the ${DEFAULT_CYCLE_TIMEOUT_MS}ms budget and was returned as a timeout.`;
    return {
      status: 'red',
      testName: actualName,
      file,
      durationMs: DEFAULT_CYCLE_TIMEOUT_MS,
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
    const lastSync = await this.sync(resolvedSync);
    const resetReport = await this.requireBaseline().reset(this.scenario, {
      full: opts.fullReset ?? lastSync === 'restart',
    });
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

  snapshot(): RuntimeSnapshot {
    return {
      connected: this.started,
      daemonStatus: this.started ? 'running' : 'stopped',
      appId: this.app?.appId,
      supportsRestart: this.started ? (this.app?.supportsRestart ?? this.launchMode === 'attach') : false,
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
    // Wait for any in-flight cycle to settle before tearing the executor down.
    await this.cycleChain.catch(() => undefined);
    const statusFilePath = this.statusFilePath;
    try {
      await this.executor.dispose();
    } finally {
      await this.cleanupStartedResources(opts);
    }
    // Publish a final "stopped" snapshot so monitors reflect the halted runtime.
    this.persistStatusTo(statusFilePath);
    await this.statusWriteChain;
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
          await this.daemon.dispose();
        } finally {
          this.driver = undefined;
          this.app = undefined;
          this.vmServiceUrl = undefined;
          this.configRoot = undefined;
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
    launchMode: opts.launchMode ?? (opts.app ? 'start' : 'attach'),
    scenario: opts.scenario ?? defaultScenario,
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
