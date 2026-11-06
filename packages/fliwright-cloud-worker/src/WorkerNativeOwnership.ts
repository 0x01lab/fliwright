import { prepareNativeRun, type ManagedNativeRun, type ManagedNativeGrant, type ManagedNativeLaunch } from '@fliwright/cli/run';
import { resolve } from 'node:path';
import type { ManagedAppAttemptRequest } from '@fliwright/core';
import type { ManagedNativePhaseObserver } from '@fliwright/cli/run';

/** Supervisor-owned device exclusion survives executor exit through final reset. */
export class WorkerNativeOwnership {
  private opening?: Promise<ManagedNativeRun | undefined>;
  private owner?: ManagedNativeRun;
  private project?: string;
  private preparation?: Promise<void>;
  private lifetime = new AbortController();
  private resetting = false;
  private unusable = false;
  private onPhase?: ManagedNativePhaseObserver;
  constructor(private readonly prepare: typeof prepareNativeRun = prepareNativeRun) {}

  async acquire(project: string, options: { deviceId: string; signal: AbortSignal; scenario?: string | null; launch?: ManagedNativeLaunch;
    onPhase?: ManagedNativePhaseObserver }): Promise<ManagedNativeGrant | undefined> {
    if (this.opening || this.project || this.resetting) throw new Error('Worker native device ownership was already requested.');
    if (this.unusable) throw new Error('Worker native cleanup is unconfirmed; explicit recovery is required.');
    this.lifetime = new AbortController();
    this.onPhase = options.onPhase;
    this.project = resolve(project);
    const signal = AbortSignal.any([options.signal, this.lifetime.signal]);
    this.opening = (async () => {
      const acquired = await this.prepare(project, { ...options, signal }, { onPhase: options.onPhase });
      if (signal.aborted) {
        const cancelled = new Error('Worker native ownership acquisition was cancelled during reset.');
        try { await acquired?.dispose({ cleanupConfirmed: false }); }
        catch (cleanup) { this.unusable = true; throw new AggregateError([cancelled, cleanup], 'Cancelled acquisition and late owner cleanup failed.'); }
        throw cancelled;
      }
      this.owner = acquired;
      return acquired;
    })();
    try {
      const acquired = await this.opening;
      return acquired ? { delegation: acquired.delegation, ...(acquired.managedAppControl ? { managedAppControl: acquired.managedAppControl } : {}) } : undefined;
    }
    finally { this.opening = undefined; }
  }

  async prepareAttempt(project: string, request: ManagedAppAttemptRequest, signal: AbortSignal): Promise<void> {
    if (!this.owner || this.opening || this.resetting) throw new Error('Worker native preparation requires live supervisor ownership.');
    if (resolve(project) !== this.project) throw new Error('Worker native preparation belongs to a different project.');
    if (this.preparation) throw new Error('Worker native preparation is already running.');
    const combined = AbortSignal.any([signal, this.lifetime.signal]);
    combined.throwIfAborted();
    const work = this.owner.prepareAttempt(request, combined);
    this.preparation = work;
    try { await work; } finally { if (this.preparation === work) this.preparation = undefined; }
  }

  /** Called only after the supervisor confirmed executor termination. */
  async reset(action: () => Promise<void>): Promise<void> {
    if (this.resetting) throw new Error('Worker native reset is already running.');
    this.resetting = true;
    this.lifetime.abort(new Error('Worker supervisor is resetting native ownership.'));
    const errors: unknown[] = [];
    let cleanupConfirmed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // Do not reset a device across unresolved supervisor platform work.
      await Promise.race([(async () => {
        await this.opening?.catch(() => undefined); await this.preparation?.catch(() => undefined);
        if (this.unusable) throw new Error('Worker native acquisition cleanup is unconfirmed; explicit recovery is required.');
        await this.owner?.quiesce();
      })(), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Worker native preparation did not stop before reset.')), 15000);
      })]);
      if (this.unusable) throw new Error('Worker native acquisition cleanup is unconfirmed; explicit recovery is required.');
      await action(); cleanupConfirmed = true;
    } catch (error) { errors.push(error); }
    finally { clearTimeout(timer); }
    const owner = this.owner;
    this.owner = undefined; this.project = undefined;
    try {
      if (owner) {
        const phase = this.startPhase('native.release');
        try { await owner.dispose({ cleanupConfirmed }); phase.finish(); }
        catch (error) { phase.finish(error); throw error; }
      }
    } catch (error) { errors.push(error); }
    finally { this.resetting = false; }
    if (!cleanupConfirmed || errors.length) this.unusable = true;
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, 'Worker reset and native owner cleanup failed.');
  }

  private startPhase(phase: Parameters<ManagedNativePhaseObserver>[0] extends never ? never : import('@fliwright/cli/run').ManagedNativePhase) {
    const id = `worker-${phase}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const observer = this.onPhase;
    try { observer?.({ type: 'started', id, phase, startedAt: new Date().toISOString() }); } catch { /* Telemetry is best effort. */ }
    let finished = false;
    return { finish(error?: unknown) {
      if (finished) return;
      finished = true;
      try { observer?.({ type: 'finished', id, phase, status: error ? 'failed' : 'succeeded',
        ...(error ? { error: { code: 'native_phase_failed', message: 'Native phase failed' } } : {}), endedAt: new Date().toISOString() }); }
      catch { /* Telemetry is best effort. */ }
    } };
  }
}
