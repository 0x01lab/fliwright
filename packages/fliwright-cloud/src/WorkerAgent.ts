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
import { identifier } from './CloudStore.js';
import type { ExecutionLease, Outcome } from './contracts.js';

export interface ExecutionResult {
  verdict: Outcome['verdict'];
  bundleDir?: string;
  infrastructure?: Outcome['infrastructure'];
  error?: string;
}
export interface WorkerDependencies {
  claim(): Promise<ExecutionLease | null>;
  heartbeat(
    lease: ExecutionLease,
    stage: string,
  ): Promise<{ cancelRequested: boolean }>;
  execute(
    lease: ExecutionLease,
    directory: string,
    signal: AbortSignal,
    onStage: (stage: string) => void,
  ): Promise<ExecutionResult>;
  stopOwned(directory: string): Promise<void>;
  reset(): Promise<void>;
  publish(lease: ExecutionLease, directory: string): Promise<string>;
  finish(lease: ExecutionLease, outcome: Outcome): Promise<unknown>;
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
}
interface Journal {
  pid: number;
  lease?: ExecutionLease;
  directory?: string;
  stage: string;
  outcome?: Outcome;
}
export function writeJournal(path: string, value: unknown) {
  const temp = `${path}.tmp-${identifier()}`;
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
    let lease: ExecutionLease | null;
    try {
      lease = await this.deps.claim();
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
    const heartbeat = async (stage: string) => {
      if (lost) return;
      try {
        const response = await this.deps.heartbeat(lease!, stage);
        if (response.cancelRequested) {
          cancelled = true;
          controller.abort();
        }
      } catch {
        lost = true;
        controller.abort();
      }
    };
    const recordStage = (stage: string) => {
      journal.stage = stage;
      writeJournal(lock, journal);
      stageWrites = stageWrites.then(() => heartbeat(stage));
    };
    const stop = () => {
      stopPromise ??= this.deps.stopOwned(directory).catch((e) => {
        stopError = e;
      });
    };
    controller.signal.addEventListener('abort', stop, { once: true });
    const outerAbort = () => controller.abort();
    signal?.addEventListener('abort', outerAbort, { once: true });
    if (signal?.aborted) controller.abort();
    const timer = setTimeout(() => {
      timeout = true;
      controller.abort();
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
        controller.abort();
      }
    await stopPromise;
    // Always verify process termination, including after a successful executor exit.
    try {
      await this.deps.stopOwned(directory);
    } catch (e) {
      stopError = e;
    }
    let publication: Outcome['publication'] = 'unavailable';
    recordStage('finalizing');
    await stageWrites;
    if (!lost && result.bundleDir)
      try {
        await this.deps.publish(lease, result.bundleDir);
        publication = 'published';
      } catch {
        publication = 'publish_failed';
      }
    let cleanup: Outcome['cleanup'] = 'failed';
    if (!stopError)
      try {
        await this.deps.reset();
        cleanup = 'clean';
      } catch {
        /* quarantine */
      }
    heartbeatStop.abort();
    await beats;
    signal?.removeEventListener('abort', outerAbort);
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
    await this.deps.finish(lease, outcome);
    if (cleanup === 'failed')
      throw new Error(
        'Device cleanup failed; slot remains locked for recovery',
      );
    rmSync(lock, { force: true });
    return true;
  }
  async recover() {
    const lock = join(this.options.root, 'slot.lock');
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
    rmSync(lock, { force: true });
  }
}
