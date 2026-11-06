import {
  openSync,
  closeSync,
  mkdirSync,
  writeFileSync,
  renameSync,
  rmSync,
  readFileSync,
  existsSync,
  fsyncSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import type { ExecutionLease, Outcome, WorkerTimelineBatch, WorkerTimelineClock, WorkerTimelineFinish, WorkerStopReason } from '@fliwright/cloud-protocol';
import { WorkerTimelineRecorder } from './WorkerTimelineRecorder.js';
import type { WorkerTimelineChannel } from './WorkerTimelineChannel.js';
import { compactSpoolAttempt, pruneSpool, type SpoolRetention } from './spool.js';

export interface ExecutionResult {
  verdict: Outcome['verdict'];
  bundleDir?: string;
  infrastructure?: Outcome['infrastructure'];
  error?: string;
}
export interface WorkerDependencies {
  claim(signal?: AbortSignal): Promise<ExecutionLease | null>;
  watchLease?(lease: ExecutionLease, listener: (reason: 'lost' | 'cancelled') => void): () => void;
  heartbeat(
    lease: ExecutionLease,
    stage: string,
    timelineClock?: WorkerTimelineClock,
  ): Promise<{ cancelRequested: boolean }>;
  execute(
    lease: ExecutionLease,
    directory: string,
    signal: AbortSignal,
    onStage: (stage: string) => void,
    timeline: WorkerTimelineRecorder,
  ): Promise<ExecutionResult>;
  stopOwned(directory: string): Promise<void>;
  reset(timeline?: WorkerTimelineRecorder, parentSpanId?: string): Promise<void>;
  publish(lease: ExecutionLease, directory: string, timeline?: WorkerTimelineChannel, parentSpanId?: string): Promise<string>;
  finish(lease: ExecutionLease, outcome: Outcome, timeline?: WorkerTimelineFinish): Promise<unknown>;
  recordTimeline?(batch: WorkerTimelineBatch, signal: AbortSignal): Promise<{ ackSeq: number }>;
  recordResult?(
    lease: ExecutionLease,
    result: Pick<Outcome, 'verdict' | 'infrastructure' | 'error'>,
  ): Promise<unknown>;
  recover(evidence: string): Promise<unknown>;
}
export interface WorkerAgentOptions {
  workerId: string;
  slotId: string;
  deviceId: string;
  root: string;
  heartbeatMs?: number;
  spoolRetention?: Partial<SpoolRetention>;
}
interface Journal {
  pid: number;
  lease?: ExecutionLease;
  directory?: string;
  stage: string;
  outcome?: Outcome;
}
export function writeJournal(path: string, value: unknown) {
  const temp = `${path}.tmp-${randomUUID()}`;
  writeFileSync(temp, JSON.stringify(value), { mode: 0o600 });
  const file = openSync(temp, 'r');
  try {
    fsyncSync(file);
  } finally {
    closeSync(file);
  }
  renameSync(temp, path);
  const dir = openSync(dirname(path), 'r');
  try {
    fsyncSync(dir);
  } finally {
    closeSync(dir);
  }
}

/** Runs one slot. A retained lock always requires explicit local recovery. */
export class WorkerAgent {
  constructor(
    readonly options: WorkerAgentOptions,
    private readonly deps: WorkerDependencies,
  ) {
    mkdirSync(options.root, { recursive: true, mode: 0o700 });
  }
  async runOnce(signal?: AbortSignal): Promise<boolean> {
    const lock = join(this.options.root, 'slot.lock');
    try {
      closeSync(openSync(lock, 'wx', 0o600));
    } catch {
      throw new Error(
        'Worker slot lock exists; run local recovery before starting',
      );
    }
    let journal: Journal = { pid: process.pid, stage: 'claiming' };
    writeJournal(lock, journal);
    await pruneSpool(this.options.root, this.options.spoolRetention, directory => this.deps.stopOwned(directory));
    let lease: ExecutionLease | null;
    try {
      lease = await this.deps.claim(signal);
    } catch (e) {
      rmSync(lock, { force: true });
      throw e;
    }
    if (!lease) {
      rmSync(lock, { force: true });
      return false;
    }
    if (
      lease.workerId !== this.options.workerId ||
      lease.slotId !== this.options.slotId ||
      lease.deviceId !== this.options.deviceId
    )
      throw new Error('Claim does not match local slot/device configuration');
    const directory = join(this.options.root, 'spool', lease.attemptId);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    journal = { ...journal, lease, directory, stage: 'assigned' };
    writeJournal(lock, journal);
    const controller = new AbortController(),
      heartbeatStop = new AbortController();
    let lost = false;
    let cancelled = false;
    let timeout = false;
    let stopError: unknown;
    let stopPromise: Promise<void> | undefined;
    let stageWrites = Promise.resolve();
    let stopReason: WorkerStopReason = 'shutdown';
    const recording = new WorkerTimelineRecorder(directory, lease, { send: this.deps.recordTimeline?.bind(this.deps) });
    const abortExecution = (reason: WorkerStopReason) => {
      stopReason = reason;
      recording.stopping(reason);
      if (reason === 'lease_lost') recording.stopSending();
      controller.abort(Object.assign(new Error(`Worker execution stopped: ${reason}`), { workerStopReason: reason }));
    };
    try {
    const heartbeat = async (stage: string) => {
      if (lost) return;
      try {
        const response = await this.deps.heartbeat(lease!, stage, recording.clock());
        void recording.flush();
        if (response.cancelRequested) {
          cancelled = true;
          abortExecution('cancelled');
        }
      } catch {
        lost = true;
        abortExecution('lease_lost');
      }
    };
    const recordStage = (stage: string) => {
      journal.stage = stage;
      writeJournal(lock, journal);
      stageWrites = stageWrites.then(() => heartbeat(stage));
    };
    const stop = () => {
      stopPromise ??= recording.channel.run('processes.stop', () => this.deps.stopOwned(directory)).then(() => {
        recording.interrupt('executor', stopReason);
      }).catch((e) => {
        stopError = e;
      });
    };
    controller.signal.addEventListener('abort', stop, { once: true });
    const unwatch = this.deps.watchLease?.(lease, reason => {
      if (reason === 'lost') lost = true;
      else cancelled = true;
      abortExecution(reason === 'lost' ? 'lease_lost' : 'cancelled');
    });
    const outerAbort = () => abortExecution('shutdown');
    signal?.addEventListener('abort', outerAbort, { once: true });
    if (signal?.aborted) abortExecution('shutdown');
    const timer = setTimeout(() => {
      timeout = true;
      abortExecution('timeout');
    }, lease.request.target.timeoutMs);
    const beats = (async () => {
      while (!heartbeatStop.signal.aborted) {
        try {
          await delay(this.options.heartbeatMs ?? 5000, undefined, {
            signal: heartbeatStop.signal,
          });
        } catch {
          break;
        }
        stageWrites = stageWrites.then(() => heartbeat(journal.stage));
        await stageWrites;
        if (lost) break;
      }
    })();
    let result: ExecutionResult;
    try {
      controller.signal.throwIfAborted();
      result = await this.deps.execute(
        lease,
        directory,
        controller.signal,
        recordStage,
        recording,
      );
    } catch {
      result = {
        verdict: controller.signal.aborted ? 'interrupted' : 'unknown',
        infrastructure: 'permanent',
        error:
          'Execution interrupted or preparation failed; inspect local execution diagnostics',
      };
    }
    clearTimeout(timer);
    if (timeout) {
      result.infrastructure = 'permanent';
      result.error = 'Execution deadline exceeded';
    }
    if (cancelled) {
      result.verdict = 'interrupted';
      delete result.infrastructure;
    }
    await stageWrites;
    if (!lost && this.deps.recordResult)
      try {
        await this.deps.recordResult(lease, {
          verdict: result.verdict,
          ...(result.infrastructure
            ? { infrastructure: result.infrastructure }
            : {}),
          ...(result.error ? { error: result.error } : {}),
        });
      } catch {
        lost = true;
        abortExecution('lease_lost');
      }
    await stopPromise;
    // Always verify process termination, including after a successful executor exit.
    try {
      await recording.channel.run('processes.stop', () => this.deps.stopOwned(directory));
      recording.interrupt('executor', controller.signal.aborted ? stopReason : 'process_exit');
    } catch (e) {
      stopError = e;
    }
    let publication: Outcome['publication'] = 'unavailable';
    recordStage('finalizing');
    await stageWrites;
    if (!lost && result.bundleDir)
      try {
        await recording.channel.run('report.publish', spanId => this.deps.publish(lease, result.bundleDir!, recording.channel, spanId));
        publication = 'published';
      } catch {
        publication = 'publish_failed';
      }
    let cleanup: Outcome['cleanup'] = 'failed';
    if (!stopError)
      try {
        await recording.channel.run('device.reset.after', spanId => this.deps.reset(recording, spanId));
        cleanup = 'clean';
      } catch {
        /* quarantine */
      }
    heartbeatStop.abort();
    await beats;
    signal?.removeEventListener('abort', outerAbort);
    unwatch?.();
    const outcome: Outcome = {
      verdict: result.verdict,
      publication,
      cleanup,
      ...(result.infrastructure
        ? { infrastructure: result.infrastructure }
        : {}),
      ...(result.error ? { error: result.error } : {}),
    };
    journal.outcome = outcome;
    journal.stage = lost ? 'ownership-lost' : 'finished';
    writeJournal(lock, journal);
    if (lost)
      throw new Error(
        'Worker lease ownership lost; slot remains locked for recovery',
      );
    await recording.flush();
    await this.deps.finish(lease, outcome, recording.summary());
    if (cleanup === 'failed')
      throw new Error(
        'Device cleanup failed; slot remains locked for recovery',
      );
    recording.close();
    writeJournal(join(directory, 'retention.json'), { completedAt: Date.now(), published: publication === 'published', bundleReady: Boolean(result.bundleDir) });
    await compactSpoolAttempt(directory, publication === 'published', Boolean(result.bundleDir));
    await pruneSpool(this.options.root, this.options.spoolRetention, directory => this.deps.stopOwned(directory));
    rmSync(lock, { force: true });
    return true;
    } finally { recording.close(); }
  }
  async recover() {
    const lock = join(this.options.root, 'slot.lock');
    if (!existsSync(lock)) {
      // Fence idle executors/retry-uploads before recovery starts touching the device or spool.
      closeSync(openSync(lock, 'wx', 0o600));
      writeJournal(lock, { pid: process.pid, stage: 'recovering' });
    }
    const journal: Journal = existsSync(lock)
      ? JSON.parse(readFileSync(lock, 'utf8'))
      : { pid: 0, stage: 'unknown' };
    if (journal.pid && journal.pid !== process.pid) {
      try {
        process.kill(journal.pid, 0);
        throw new Error(
          'Worker process is still alive; stop it before recovery',
        );
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ESRCH') throw e;
      }
    }
    if (journal.directory) await this.deps.stopOwned(journal.directory);
    await this.deps.reset();
    if (journal.lease && journal.outcome)
      try {
        await this.deps.finish(journal.lease, journal.outcome);
      } catch {
        /* Lost leases are recovered through the fenced slot API. */
      }
    await this.deps.recover(
      'Local supervisor confirmed owned process groups terminated and dedicated device reset',
    );
    await pruneSpool(this.options.root, this.options.spoolRetention, directory => this.deps.stopOwned(directory));
    rmSync(lock, { force: true });
  }
}
