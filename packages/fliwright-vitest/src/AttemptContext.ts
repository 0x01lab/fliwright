import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  RunArtifactStore, RunProgressJournal, TimelineArtifactStore, TimelineRecorder, projectRunTrace, resolveFliwrightRunsRoot,
  mergeFliwrightConfig, readFliwrightEnvironment,
} from '@fliwright/core';
import type { FliwrightLogger, RecordingMode, RunSession, RunSessionResult, TimelineRunMode, TimelineNode, TimelineData } from '@fliwright/core';
import type { RunnerTask } from 'vitest';
import { FinalizationBudget } from './FinalizationBudget.js';
import { AsyncLocalStorage } from 'node:async_hooks';

const attemptKey = Symbol.for('@fliwright/vitest/active-attempt');
type AttemptTask = RunnerTask & { [attemptKey]?: AttemptContext };

/** Shared by the runner and fixture module, including separate Vitest module graphs. */
export class AttemptContext {
  recorder: TimelineRecorder;
  artifactStore: TimelineArtifactStore;
  runStore: RunArtifactStore;
  recordingMode: RecordingMode;
  logger?: FliwrightLogger;
  failureContextPath?: string;
  validate?: () => Error | undefined;
  /** aroundEach setup can skip before Vitest enters the attempt hooks. */
  onSetupSkipped?: () => Promise<void>;
  /** Automatic fixtures can resolve before onBeforeTryTask inside aroundEach. */
  beforeFixtures?: () => Promise<void>;
  runnerEntered = false;
  readonly evidenceErrors: string[] = [];
  beforeFinish?: (signal: AbortSignal) => Promise<void>;
  onFailure?: (error: unknown, node: TimelineNode, signal: AbortSignal) => Promise<void>;
  readonly runnerErrors: NonNullable<RunSessionResult['runnerErrors']> = [];
  private readonly failures = new WeakSet<object>();
  private progressQueue: Promise<void> = Promise.resolve();
  private journal: RunProgressJournal;
  private progressClosed = false;
  persistenceIncomplete = false;
  private readonly progressController = new AbortController();
  private readonly finalizationScope = new AsyncLocalStorage<AbortSignal>();
  finalization: FinalizationBudget;

  /** Reserve a small part of the same deadline for writing the terminal result. */
  get persistenceReserveMs(): number { return Math.min(250, this.finalization.timeoutMs / 5); }
  get finalizationSignal(): AbortSignal | undefined { return this.finalizationScope.getStore(); }
  get runsRoot(): string { return dirname(this.runStore.runDir); }

  recordEvidenceIssue(error: unknown): void {
    const message = this.session.redactReport(error instanceof Error ? error.message : String(error));
    if (!this.evidenceErrors.includes(message)) this.evidenceErrors.push(message);
  }

  async finalizeStep(stage: string, work: (signal: AbortSignal) => Promise<void>): Promise<void> {
    try {
      await this.finalization.run(stage, (signal) => this.finalizationScope.run(signal, () => work(signal)), this.persistenceReserveMs);
    }
    catch (error) { this.recordEvidenceIssue(error); }
  }

  constructor(
    readonly session: RunSession,
    readonly runId: string,
    readonly testId: string,
    readonly testName: string,
    readonly attemptId: string,
  ) {
    this.finalization = new FinalizationBudget(mergeFliwrightConfig({
      environment: readFliwrightEnvironment(process.env),
    }).recording.testFinalizationBudgetMs);
    this.recordingMode = process.env.FLIWRIGHT_RECORDING_MODE === 'off' ? 'off'
      : process.env.FLIWRIGHT_RECORDING_MODE === 'full' ? 'full' : 'standard';
    this.configureRecordingPolicy({});
    this.runStore = new RunArtifactStore({ runsRoot: resolveFliwrightRunsRoot({ projectRoot: process.env.FLIWRIGHT_PROJECT_ROOT }), runId });
    this.artifactStore = this.makeArtifactStore();
    this.journal = new RunProgressJournal(this.runStore, testId, attemptId);
    this.recorder = this.makeRecorder();
    session.bindRecorder(this.recorder);
    session.configureProgressPersistence((result) => {
      if (this.progressClosed) return Promise.resolve();
      // Each snapshot is owned by this attempt; serialize writes from concurrent
      // branches so an older snapshot cannot overwrite a newer one.
      const timeline = this.session.redactReport(this.recorder.toJSON());
      if (this.recordingMode !== 'off') result.eventsPath = 'events.jsonl';
      this.progressQueue = this.progressQueue.then(async () => {
        if (this.progressClosed) return;
        if (this.recordingMode !== 'off') await this.appendJournal(result, timeline);
        if (this.progressClosed) return;
        await this.runStore.writeAttemptResult(this.testId, this.attemptId, result, { signal: this.progressController.signal });
        if (this.progressClosed) return;
        if (this.recordingMode !== 'off') await this.artifactStore.writeTimeline(timeline, { signal: this.progressController.signal });
      }).catch((error: unknown) => {
        if (!this.progressController.signal.aborted) this.recordEvidenceIssue(error);
      });
      return this.progressQueue;
    });
  }

  async configure(options: { runsRoot: string; mode: TimelineRunMode; logger: FliwrightLogger;
    recordingMode?: RecordingMode; testFinalizationBudgetMs?: number }): Promise<void> {
    await this.recorder.flushProgress();
    await this.progressQueue;
    const store = new RunArtifactStore({ runsRoot: options.runsRoot, runId: this.runId });
    if (store.runDir !== this.runStore.runDir) this.journal = new RunProgressJournal(store, this.testId, this.attemptId);
    this.runStore = store;
    this.artifactStore = this.makeArtifactStore();
    this.logger = options.logger;
    this.configureRecordingPolicy(options);
    this.recorder = this.makeRecorder(options.mode);
    this.session.bindRecorder(this.recorder);
    await this.persistRunning();
  }

  /** Resolve policy before an endpoint wait can be canceled, without opening an App connection. */
  configureRecordingPolicy(options: { recordingMode?: RecordingMode; testFinalizationBudgetMs?: number }): void {
    this.recordingMode = options.recordingMode ?? this.recordingMode;
    this.session.configureRecording({ mode: this.recordingMode, captureEvidence: async () => (
      this.recordingMode === 'off' ? { status: 'disabled' }
        : { status: 'unavailable', error: 'No app evidence source was configured for this attempt.' }
    ) });
    if (options.testFinalizationBudgetMs !== undefined) {
      this.finalization = new FinalizationBudget(options.testFinalizationBudgetMs);
    }
  }

  /**
   * Seed a durable running marker before fixture setup can finish. The parent
   * process uses this marker to recover an attempt whose worker disappeared.
   * Configured runs roots are available through the CLI/preset environment;
   * fixture configuration writes the marker again for config-only callers.
   */
  async initialize(): Promise<void> {
    // Fixture policy is not resolved yet. Keep only the recovery marker until
    // configure() decides whether process recording is enabled.
    if (process.env.FLIWRIGHT_RUNS_ROOT) {
      await this.runStore.writeAttemptResult(this.testId, this.attemptId, this.session.snapshot());
    }
  }

  private async persistRunning(): Promise<void> {
    const result = this.session.snapshot();
    if (this.recordingMode !== 'off') result.eventsPath = 'events.jsonl';
    if (this.recordingMode !== 'off') await this.appendJournal(result, this.recorder.toJSON());
    await this.runStore.writeAttemptResult(this.testId, this.attemptId, result);
  }

  private makeArtifactStore(): TimelineArtifactStore {
    return new TimelineArtifactStore({ runId: this.runId,
      attemptDir: this.runStore.attemptDir(this.testId, this.attemptId) });
  }

  private makeRecorder(mode?: TimelineRunMode): TimelineRecorder {
    return new TimelineRecorder({ runId: this.runId, testName: this.testName, mode, logger: this.logger,
      onChange: (data) => this.persistNodeProgress(data),
      onPersistenceError: (error) => {
        this.evidenceErrors.push(this.session.redactReport(error instanceof Error ? error.message : String(error)));
      },
    });
  }

  private async persistNodeProgress(data: TimelineData): Promise<void> {
    if (this.recordingMode === 'off' || this.progressClosed) return;
    const result = this.session.snapshot();
    result.eventsPath = 'events.jsonl';
    // Timeline mutations may contain input/error metadata; use the same privacy
    // boundary as RunSession operation snapshots before persisting any node.
    const timeline = this.session.redactReport(data);
    this.progressQueue = this.progressQueue.then(async () => {
      if (!this.progressClosed) await this.appendJournal(result, timeline);
    });
    await this.progressQueue;
  }

  ignorePriorFailures(task: RunnerTask): void {
    for (const error of task.result?.errors ?? []) this.failures.add(error);
  }

  async captureRunnerFailures(task: RunnerTask, phase: 'setup-or-body' | 'teardown' | 'final'): Promise<void> {
    const errors = task.result?.errors ?? [];
    for (let index = 0; index < errors.length; index++) {
      const original = errors[index];
      if (this.failures.has(original)) continue;
      this.failures.add(original);
      const error = this.session.redactReport(original);
      errors[index] = error;
      this.failures.add(error);
      this.runnerErrors.push({ message: error.message ?? String(error), stack: error.stack, phase });
      const node = this.recorder.startNode('failure', error.message ?? this.testName, { metadata: { phase } });
      this.recorder.failNode(node.id, {
        code: 'unknown', title: this.testName, message: error.message ?? String(error),
        recoveryHints: [{ kind: 'observe', description: 'Inspect the saved failure evidence and runner error.' }],
        cause: error,
      });
      await this.finalizeStep('Failure evidence', async (signal) => {
        await this.recorder.flushProgress();
        if (this.recordingMode !== 'off') for (const kind of ['screenshot', 'snapshot', 'diagnostics'] as const) {
          if (signal.aborted) return;
          const evidence = await this.session.checkpoint({ kind, reason: 'failure', operationId: node.id });
          if (signal.aborted) return;
          this.recorder.addArtifacts(node.id, (evidence.artifactPaths ?? []).map((path) => ({ kind, path })));
        }
      });
      await this.finalizeStep('Failure projection', async (signal) => { await this.onFailure?.(error, node, signal); });
      await this.finalizeStep('Failure progress flush', () => this.recorder.flushProgress());
    }
  }

  async persist(result: RunSessionResult, finalized = false, budget = this.finalization): Promise<void> {
    const reserveMs = Math.min(250, budget.timeoutMs / 5);
    let flushed = this.progressClosed;
    try {
      if (!this.progressClosed) await budget.run('Progress flush', async () => {
        await this.recorder.flushProgress();
        await this.progressQueue;
      }, reserveMs / 2);
      flushed = true;
    } catch (error) { this.persistenceIncomplete = true; this.recordEvidenceIssue(error); }
    // Late evidence and queued progress must not overwrite terminal snapshots.
    this.progressClosed = true;
    this.progressController.abort();
    result.finalized = finalized;
    this.applyEvidenceIssues(result);
    if (this.recordingMode !== 'off') try {
      await budget.run('Artifact persistence', async (signal) => {
        result.eventsPath = 'events.jsonl';
        const data = this.session.redactReport(this.recorder.complete(result.testOutcome));
        if (flushed) await this.appendJournal(result, data, finalized, signal);
        if (signal.aborted) return;
        // A trace references only artifacts already owned by this attempt.
        const traceDir = join(this.artifactStore.runDir, 'trace');
        await mkdir(traceDir, { recursive: true });
        if (signal.aborted) return;
        const tracePath = join(traceDir, 'trace.json');
        const temporaryPath = `${tracePath}.${process.pid}.tmp`;
        await writeFile(temporaryPath, JSON.stringify(projectRunTrace(result, data), null, 2), { signal });
        if (signal.aborted) return;
        await rename(temporaryPath, tracePath);
        if (signal.aborted) return;
        await this.artifactStore.writeTimeline(data, { signal });
      }, reserveMs / 4);
    } catch (error) { this.persistenceIncomplete = true; this.recordEvidenceIssue(error); }
    this.applyEvidenceIssues(result);
    try {
      await budget.run('Result persistence', (signal) => this.runStore.writeAttemptResult(this.testId, this.attemptId, result, { signal }));
    } catch (error) {
      this.persistenceIncomplete = true;
      this.recordEvidenceIssue(error);
      this.applyEvidenceIssues(result);
    }
  }

  private applyEvidenceIssues(result: RunSessionResult): void {
    if (!this.evidenceErrors.length) return;
    if (result.evidenceStatus !== 'disabled') result.evidenceStatus = 'partial';
    result.evidenceIssues = [...new Set([...(result.evidenceIssues ?? []), ...this.evidenceErrors])];
  }

  private async appendJournal(result: RunSessionResult, timeline: import('@fliwright/core').TimelineData,
    finalized = false, signal = this.progressController.signal): Promise<void> {
    try { await this.journal.append(result, timeline, finalized, { signal }); } catch (error) {
      if (signal.aborted) return;
      const message = this.session.redactReport(`Progress journal persistence failed: ${error instanceof Error ? error.message : String(error)}`);
      if (!this.evidenceErrors.includes(message)) this.evidenceErrors.push(message);
      result.evidenceStatus = 'partial';
      result.evidenceIssues = [...new Set([...(result.evidenceIssues ?? []), message])];
    }
  }
}

export function setAttemptContext(task: RunnerTask, context: AttemptContext): void {
  // Keep recorder/session internals out of Vitest's task serialization.
  Object.defineProperty(task, attemptKey, { value: context, configurable: true });
}

export function requireAttemptContext(task: RunnerTask): AttemptContext {
  const context = (task as AttemptTask)[attemptKey];
  if (!context) throw new Error('Fliwright fixtures require the Fliwright runner. Configure fliwrightPreset() in vitest.config.ts.');
  return context;
}
