import { TestRunner as VitestTestRunner } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { RunnerTask as Task } from 'vitest';
import { appendFile } from 'node:fs/promises';
import { relative } from 'node:path';
import { RunSession, registerRunSession, unregisterRunSession } from '@fliwright/core';
import type { RunSessionResult, RunnerOutcome } from '@fliwright/core';
import { AttemptContext, setAttemptContext } from './AttemptContext.js';
import { releaseTaskEndpointLease, finishTaskEndpointLeasePhase } from './TaskEndpointLease.js';
import { prepareRegisteredTask } from './TestRegistration.js';

export interface FliwrightRunnerOptions {
  createSession?: (task: Task, attemptIndex?: number) => RunSession;
  onSessionStart?: (session: RunSession, task: Task, attemptIndex?: number) => void | Promise<void>;
  /** Called after setup/body and again after teardown, before finalization. */
  onAttemptFinished?: (task: Task, retry: number, session: RunSession) => void | Promise<void>;
  /** Called once with the final runner outcome for a task. */
  onSessionFinished?: (task: Task, result: RunSessionResult) => void | Promise<void>;
}

type SessionRecord = {
  session: RunSession;
  context: AttemptContext;
  attemptIndex: number;
  started: boolean;
  observedStatus?: RunnerOutcome['status'];
};
type CompletedAttempt = { context: AttemptContext; result: RunSessionResult };
type TaskWithResult = Task & { fliwrightSessionResult?: RunSessionResult };

export interface FliwrightRunnerConstructor {
  new (config: ConstructorParameters<typeof VitestTestRunner>[0], options?: FliwrightRunnerOptions): VitestTestRunner;
}

/** Compose the lifecycle with an existing VitestTestRunner subclass, retaining its constructor and hooks.
 * The base runner must call its own Vitest super hooks to preserve assertion/snapshot semantics.
 */
export function createFliwrightRunner(BaseRunner: typeof VitestTestRunner): FliwrightRunnerConstructor {
  class ComposedFliwrightRunner extends BaseRunner {
    private runId = process.env.FLIWRIGHT_RUN_ID ?? `run-${randomUUID()}`;
    private readonly active = new Map<string, SessionRecord>();
    private readonly completed = new Map<string, CompletedAttempt[]>();
    private readonly tasks = new Set<Task>();
    private preparationController = new AbortController();

    constructor(
      config: ConstructorParameters<typeof VitestTestRunner>[0],
      private readonly options: FliwrightRunnerOptions = {},
    ) { super(config); }

    async onBeforeRunFiles(files: Task[]): Promise<void> {
      this.preparationController = new AbortController();
      await callBase('onBeforeRunFiles', this, files);
      this.runId = process.env.FLIWRIGHT_RUN_ID ?? `run-${randomUUID()}`;
    }

    cancel(reason: Parameters<VitestTestRunner['cancel']>[0]): void {
      try { return BaseRunner.prototype.cancel.call(this, reason); }
      finally { this.preparationController.abort(new Error(`Test run canceled while preparing the App: ${reason}`)); }
    }

    async onAfterRunFiles(files?: Task[]): Promise<void> {
      try { await callBase('onAfterRunFiles', this, files); }
      finally {
        for (const task of this.tasks) await releaseTaskEndpointLease(task);
        this.tasks.clear();
      }
    }

    async onBeforeRunTask(task: Task): Promise<void> {
      this.tasks.add(task);
      const configuredRunId = process.env.FLIWRIGHT_RUN_ID;
      if (configuredRunId && configuredRunId !== this.runId) this.runId = configuredRunId;
      else if (process.env.FLIWRIGHT_TDD_MODE === '1') this.runId = `run-${randomUUID()}`;
      await callBase('onBeforeRunTask', this, task);
      await this.startAttempt(task, 0);
      if (task.mode === 'run' || task.mode === 'queued') {
        try { await prepareRegisteredTask(task, this.preparationController.signal); }
        catch (error) {
          const canceled = this.preparationController.signal.aborted;
          // Vitest does not register a running task until this hook returns,
          // so its cancellation wrapper cannot abort this preparation wait.
          const context = this.active.get(task.id)?.context;
          const message = context?.session.redactReport(error instanceof Error ? error.message : String(error))
            ?? 'App preparation failed.';
          const outcome = canceled ? 'interrupted' : 'failed';
          try {
            if (canceled) {
              task.mode = 'skip';
              context?.runnerErrors.push({ message, phase: 'setup-or-body' });
              context?.recordEvidenceIssue(error);
            } else {
              // Returning a failed task uses Vitest's early-failure path;
              // throwing here would abort the enclosing file and its peers.
              task.result = { state: 'fail', errors: [{
                name: error instanceof Error ? error.name : 'Error', message,
                stack: error instanceof Error ? error.stack : undefined,
              }] };
              await context?.captureRunnerFailures(task, 'setup-or-body');
            }
            await this.finishAttempt(task, outcome);
            await this.finalizeTask(task, outcome);
          } finally {
            await releaseTaskEndpointLease(task);
            this.tasks.delete(task);
          }
          return;
        }
      }
      // Pre-skipped tasks do not reach any later runner hook.
      if (task.mode !== 'run' && task.mode !== 'queued') {
        await this.finishAttempt(task, 'skipped');
        await this.finalizeTask(task, 'skipped');
      }
    }

    async onBeforeTryTask(task: Task, options: { retry?: number; repeats?: number } = {}): Promise<void> {
      const configuredRunId = process.env.FLIWRIGHT_RUN_ID;
      if (configuredRunId && configuredRunId !== this.runId) this.runId = configuredRunId;
      else if (process.env.FLIWRIGHT_TDD_MODE === '1' && !this.active.has(task.id) && !this.completed.has(task.id)) {
        this.runId = `run-${randomUUID()}`;
      }
      await callBase('onBeforeTryTask', this, task, options);
      let record = this.active.get(task.id);
      if (record?.started) {
        // Includes aroundEach teardown, which runs after onAfterRetryTask.
        await record.context.captureRunnerFailures(task, 'teardown');
        await this.finishAttempt(task, record.observedStatus ?? 'failed');
        record = undefined;
      }
      record ??= await this.startAttempt(task, this.completed.get(task.id)?.length ?? 0);
      record.started = true;
      record.context.runnerEntered = true;
    }

    async onTaskFinished(task: Task): Promise<void> {
      await callBase('onTaskFinished', this, task);
      const record = this.active.get(task.id);
      if (!record) return;
      record.context.finalization.begin();
      if (task.result?.state === 'pass') {
        const validationError = record.context.validate?.();
        if (validationError) {
          task.result.state = 'fail';
          (task.result.errors ??= []).push({ name: validationError.name, message: validationError.message, stack: validationError.stack });
        }
      }
      await record.context.captureRunnerFailures(task, 'setup-or-body');
      if (this.options.onAttemptFinished) await record.context.finalizeStep('Attempt callback', async () => {
        await this.options.onAttemptFinished!(task, record.attemptIndex, record.session);
      });
      record.context.finalization.pause();
    }

    async onAfterRetryTask(task: Task, options: { retry: number; repeats: number }): Promise<void> {
      await callBase('onAfterRetryTask', this, task, options);
      const record = this.active.get(task.id);
      if (!record) return;
      await record.context.captureRunnerFailures(task, 'teardown');
      if (this.options.onAttemptFinished) await record.context.finalizeStep('Attempt callback', async () => {
        await this.options.onAttemptFinished!(task, record.attemptIndex, record.session);
      });
      record.observedStatus = outcomeForTask(task);
      record.context.runnerEntered = false;
      // Runtime skip returns before onAfterRunTask too.
      if (record.observedStatus === 'skipped') {
        try {
          await this.finishAttempt(task, 'skipped');
          await this.finalizeTask(task, 'skipped');
        } finally { await finishTaskEndpointLeasePhase(task, 'skipFinalized'); }
      }
    }

    async onAfterRunTask(task: Task): Promise<void> {
      try {
        await callBase('onAfterRunTask', this, task);
        const record = this.active.get(task.id);
        if (record) {
          await record.context.captureRunnerFailures(task, 'final');
          const finalStatus = outcomeForTask(task);
          const observedStatus = isExpectedFailure(task)
            ? finalStatus === 'passed' ? 'failed' : 'passed'
            : finalStatus;
          await this.finishAttempt(task, observedStatus);
        }
        await this.finalizeTask(task, outcomeForTask(task));
      } finally {
        await releaseTaskEndpointLease(task);
        this.tasks.delete(task);
      }
    }

    private async startAttempt(task: Task, attemptIndex: number): Promise<SessionRecord> {
      const runId = this.runId;
      const attemptId = `attempt-${attemptIndex}`;
      const session = this.options.createSession?.(task, attemptIndex) ?? new RunSession({
        runId, testId: task.id, testName: task.name, attemptId, attemptIndex,
        testFile: relative(this.config.root, task.file.filepath).split('\\').join('/'),
        testPath: sourceTestPath(task),
      });
      const context = new AttemptContext(session, runId, task.id, task.name, attemptId);
      if (attemptIndex > 0) context.ignorePriorFailures(task);
      const record = { session, context, attemptIndex, started: false };
      context.beforeFixtures = async () => {
        const previous = this.active.get(task.id);
        if (!previous?.started || previous.context.runnerEntered) return;
        // aroundEach resolves automatic fixtures before onBeforeTryTask.
        // Finish the preceding attempt before any new scenario preparation.
        await previous.context.captureRunnerFailures(task, 'teardown');
        await this.finishAttempt(task, previous.observedStatus ?? 'failed');
        await this.startAttempt(task, this.completed.get(task.id)?.length ?? 0);
      };
      context.onSetupSkipped = async () => {
        const active = this.active.get(task.id);
        if (!active) return;
        // A retry may skip in aroundEach before onBeforeTryTask can finish
        // the previous attempt and create the new one.
        if (active.started) {
          await this.finishAttempt(task, active.observedStatus ?? 'failed');
          await this.startAttempt(task, this.completed.get(task.id)?.length ?? 0);
        }
        try {
          await this.finishAttempt(task, 'skipped');
          await this.finalizeTask(task, 'skipped');
        } finally { await finishTaskEndpointLeasePhase(task, 'skipFinalized'); }
      };
      this.active.set(task.id, record);
      registerRunSession(task.id, session);
      setAttemptContext(task, context);
      await context.initialize();
      await this.options.onSessionStart?.(session, task, attemptIndex);
      return record;
    }

    private async finishAttempt(task: Task, status: RunnerOutcome['status']): Promise<void> {
      const record = this.active.get(task.id);
      if (!record) return;
      if (record.context.beforeFinish) {
        await record.context.finalizeStep('Passive diagnosis', (signal) => record.context.beforeFinish!(signal));
      }
      const result = await record.session.finish({ status, evidenceStatus: 'complete' });
      result.expectedFailure = isExpectedFailure(task);
      if (record.context.evidenceErrors.length && result.evidenceStatus !== 'disabled') result.evidenceStatus = 'partial';
      result.failureContextPath = record.context.failureContextPath;
      result.runnerErrors = [...record.context.runnerErrors];
      this.active.delete(task.id);
      unregisterRunSession(task.id, record.session);
      const attempts = this.completed.get(task.id) ?? [];
      attempts.push({ context: record.context, result });
      this.completed.set(task.id, attempts);
      await record.context.persist(result);
    }

    private async finalizeTask(task: Task, testOutcome: RunnerOutcome['status']): Promise<void> {
      const attempts = this.completed.get(task.id) ?? [];
      const flaky = testOutcome === 'passed' && !isExpectedFailure(task) && attempts.length > 1
        && attempts.some(({ result }) => result.attemptOutcome === 'failed');
      // Earlier attempts may have finished before a long retry body. Refresh
      // their task-level projections using the final attempt's remaining time.
      const finalization = attempts.at(-1)?.context.finalization;
      for (const { result } of attempts) {
        result.testOutcome = testOutcome;
        result.flaky = flaky;
      }
      const finalAttempt = attempts.at(-1);
      if (finalAttempt && this.options.onSessionFinished) {
        await finalAttempt.context.finalizeStep('Session callback', async () => {
          await this.options.onSessionFinished!(task, finalAttempt.result);
        });
      }
      for (const { context, result } of attempts) {
        await context.persist(result, true, finalization);
        const outputPath = process.env.FLIWRIGHT_SESSION_RESULTS_PATH;
        if (outputPath && finalization) try {
          await finalization.run('Result handoff', () => appendFile(outputPath, `${JSON.stringify(result)}\n`, 'utf8'));
        } catch (error) { context.recordEvidenceIssue(error); }
      }
      const result = attempts.at(-1)?.result;
      if (result) {
        (task as TaskWithResult).fliwrightSessionResult = result;
        (task.meta as Record<string, unknown>).fliwrightRun = { runId: result.runId, testId: result.testId, attemptId: result.attemptId };
      }
      // Task metadata travels through Vitest's reporter channel even when the
      // worker cannot flush its artifact store. Only affected attempts pay for
      // this snapshot; regular runs keep the compact identity above.
      const recovery = attempts.filter(({ context }) => context.persistenceIncomplete).map(({ context, result }) => ({
        runsRoot: context.runsRoot,
        result: context.session.redactReport(result),
        ...(context.recordingMode !== 'off' ? { timeline: context.session.redactReport(context.recorder.complete(result.testOutcome)) } : {}),
      }));
      if (recovery.length) (task.meta as Record<string, unknown>).fliwrightRecovery = recovery;
      this.completed.delete(task.id);
    }
  }

  async function callBase(name: string, runner: VitestTestRunner, ...args: unknown[]): Promise<void> {
    const method = (BaseRunner.prototype as unknown as Record<string, unknown>)[name];
    if (typeof method === 'function') await (method as (...values: unknown[]) => unknown).call(runner, ...args);
  }
  return ComposedFliwrightRunner;
}

/** Default lifecycle adapter using Vitest's standard runner. */
export class FliwrightRunner extends createFliwrightRunner(VitestTestRunner) {}

function sourceTestPath(task: Task): string[] {
  const names = [task.name];
  let suite = task.suite;
  while (suite && suite !== task.file) {
    names.unshift(suite.name);
    suite = suite.suite;
  }
  return names;
}

function isExpectedFailure(task: Task): boolean {
  return task.type === 'test' && task.fails === true;
}

function outcomeForTask(task: Task): RunnerOutcome['status'] {
  if (task.result?.state === 'pass') return 'passed';
  if (task.result?.state === 'skip') return 'skipped';
  return 'failed';
}

export default FliwrightRunner;
