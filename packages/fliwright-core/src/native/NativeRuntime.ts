import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { RunSession } from '../RunSession.js';
import { NativePage } from './NativePage.js';
import { DeviceController } from './DeviceController.js';
import { createNativeEvidenceProvider, type NativeEvidenceOptions } from './NativeEvidence.js';
import { NativeError, type NativeCommand, type NativeOperationContext, type NativeOperationOptions,
  type NativeSessionAdapter, type NativeSnapshot, type NativeQuery } from './types.js';

export interface NativeRuntimeOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
  systemAppIds?: string[];
  externalAppIds?: string[];
  signal?: AbortSignal;
  runSession?: RunSession;
}

/** Owns ordering, deadlines and operation reporting for one platform adapter. */
export class NativeRuntime {
  readonly native: NativePage;
  readonly device: DeviceController;
  private tail: Promise<unknown> = Promise.resolve();
  private readonly lifetime = new AbortController();
  private closing?: Promise<void>;
  private tainted = false;
  private readonly deviceKey: string;
  private unregisterEvidence?: () => void;
  readonly options: NativeRuntimeOptions;

  constructor(readonly adapter: NativeSessionAdapter, options: NativeRuntimeOptions = {}) {
    this.options = { ...options };
    this.deviceKey = createHash('sha256').update(`${adapter.identity.platform}\0${adapter.identity.deviceId}`).digest('hex');
    for (const value of [options.timeoutMs, options.pollIntervalMs]) {
      if (value !== undefined && (!Number.isFinite(value) || value <= 0)) throw new NativeError('precondition_failed', 'Timeout and polling interval must be positive finite numbers.');
    }
    this.native = new NativePage(this);
    this.device = new DeviceController(this);
  }

  /** Bind owned evidence storage once the attempt timeline fixture is ready. */
  configureEvidence(options: NativeEvidenceOptions): void {
    if (!this.options.runSession) throw new NativeError('precondition_failed', 'Native evidence requires a RunSession.');
    if (this.unregisterEvidence) throw new NativeError('precondition_failed', 'Native evidence is already configured.');
    this.unregisterEvidence = this.options.runSession.registerEvidenceProvider('native', createNativeEvidenceProvider(this, options,
      this.lifetime.signal, () => { this.tainted = true; }));
  }

  async run<T>(action: string, kind: 'action' | 'assertion' | 'raw', options: NativeOperationOptions,
    body: (context: NativeOperationContext) => Promise<T>, extra: { query?: NativeQuery; title?: string; sensitiveValues?: string[] } = {}): Promise<T> {
    return this.schedule(action, kind, options, body, extra, true);
  }

  /** Read-only setup inspection, before the attempt's recording/evidence fixtures exist. */
  preflightCapabilities(options: NativeOperationOptions = {}) {
    return this.schedule('capabilities', 'raw', options, context => this.adapter.capabilities(context), {}, false);
  }

  private async schedule<T>(action: string, kind: 'action' | 'assertion' | 'raw', options: NativeOperationOptions,
    body: (context: NativeOperationContext) => Promise<T>, extra: { query?: NativeQuery; title?: string; sensitiveValues?: string[] }, record: boolean): Promise<T> {
    const timeout = options.timeout ?? this.options.timeoutMs ?? (kind === 'action' ? 10_000 : 5_000);
    if (!Number.isFinite(timeout) || timeout <= 0) throw new NativeError('precondition_failed', 'Timeout must be a positive finite number.');
    const deadline = Date.now() + timeout;
    const local = new AbortController();
    const signal = AbortSignal.any([local.signal, this.lifetime.signal, ...(options.signal ? [options.signal] : []), ...(this.options.signal ? [this.options.signal] : [])]);
    if (signal.aborted) throw this.abortError(signal);
    const context: NativeOperationContext = { requestId: randomUUID(), deadline, signal };
    let started = false;
    const work = async (): Promise<T> => {
      started = true;
      clearTimeout(queueTimer);
      signal.removeEventListener('abort', abortQueued);
      if (signal.aborted) throw this.abortError(signal);
      if (this.tainted) throw new NativeError('precondition_failed', 'Native session has unfinished or unknown work; dispose and prepare a new session.');
      const execute = async () => {
        try { return await this.withDeadline(context, body); }
        finally { local.abort(new NativeError('cancelled', 'Native action body completed.')); }
      };
      return this.options.runSession && record
        ? this.options.runSession.perform({ kind, title: extra.title ?? `Native ${action}`, sensitiveValues: extra.sensitiveValues,
          metadata: { surface: 'native', backend: this.adapter.identity.backend, action, query: extra.query,
            scope: extra.query?.scope, deviceKey: this.deviceKey, generation: this.adapter.identity.generation,
            timeoutMs: timeout, requestId: context.requestId } }, execute)
        : execute();
    };
    // Queuing time counts against the same deadline, including cancellation while queued.
    let queueTimer: ReturnType<typeof setTimeout> | undefined;
    let abortQueued = () => {};
    const queueWait = new Promise<never>((_, reject) => {
      abortQueued = () => { if (!started) reject(this.abortError(signal)); };
      signal.addEventListener('abort', abortQueued, { once: true });
      queueTimer = setTimeout(() => local.abort(new NativeError('timeout', 'Native operation deadline exceeded while queued.')), timeout);
    });
    const queued = this.tail.then(work);
    // A queue entry may reject after its caller's deadline/cancellation race ends.
    void queued.catch(() => undefined);
    // The body owns its deadline. Evidence has a separate bounded budget and
    // must finish before this queue advances to another action.
    const result = Promise.race([queued, queueWait]);
    this.tail = queued.then(() => undefined, () => undefined);
    try { return await result; }
    finally {
      clearTimeout(queueTimer);
      signal.removeEventListener('abort', abortQueued);
      local.abort(new NativeError('cancelled', 'Native operation completed.'));
    }
  }

  private async withDeadline<T>(context: NativeOperationContext, body: (context: NativeOperationContext) => Promise<T>): Promise<T> {
    if (context.signal.aborted) throw this.abortError(context.signal);
    const remaining = context.deadline - Date.now();
    if (remaining <= 0) throw new NativeError('timeout', 'Native operation deadline exceeded.');
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    try {
      return await Promise.race([
        Promise.resolve().then(() => body(context)),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            this.tainted = true;
            reject(new NativeError('timeout', 'Native operation deadline exceeded; the session must be prepared again.'));
          }, remaining);
          abort = () => {
            this.tainted = true;
            reject(this.abortError(context.signal));
          };
          context.signal.addEventListener('abort', abort, { once: true });
          if (context.signal.aborted) abort();
        }),
      ]);
    } finally {
      clearTimeout(timer);
      if (abort) context.signal.removeEventListener('abort', abort);
    }
  }

  private abortError(signal: AbortSignal): NativeError {
    return signal.reason instanceof NativeError ? signal.reason : new NativeError('cancelled', 'Native operation cancelled.');
  }

  async requireCapability(name: string, context: NativeOperationContext): Promise<void> {
    const capability = (await this.adapter.capabilities(context))[name];
    if (!capability || capability.support !== 'supported') throw new NativeError('unsupported_capability', `${name}: ${capability?.reason ?? 'not supported by this device/backend'}`);
    if (!capability.ready) throw new NativeError('precondition_failed', `${name}: ${capability.reason ?? 'device is not ready'}`);
  }

  async readSnapshot(context: NativeOperationContext, query?: NativeQuery): Promise<NativeSnapshot> {
    await this.requireCapability('native.query', context);
    if (query) this.allowedAppIds(query);
    const snapshot = await this.adapter.snapshot(context, query);
    for (const field of ['platform', 'deviceId', 'appId', 'backend', 'generation'] as const) {
      if (snapshot.identity[field] !== this.adapter.identity[field]) throw new NativeError('device_mismatch', `Native snapshot ${field} does not match the active session.`);
    }
    return snapshot;
  }

  matches(snapshot: NativeSnapshot, query: NativeQuery): NativeSnapshot['nodes'] {
    const appIds = this.allowedAppIds(query);
    return snapshot.nodes.filter(node => appIds.includes(node.appId) && typeof node[query.field] === 'string'
      && (query.exact ? node[query.field] === query.value : node[query.field]!.includes(query.value)));
  }

  private allowedAppIds(query: NativeQuery): string[] {
    const scope = query.scope;
    const appIds = scope === 'app' ? [this.adapter.identity.appId]
      : scope === 'system' ? this.options.systemAppIds ?? [] : [scope.appId];
    if (scope !== 'app' && scope !== 'system' && ![this.adapter.identity.appId, ...(this.options.externalAppIds ?? [])].includes(scope.appId)) {
      throw new NativeError('precondition_failed', 'External application is not allowlisted for this session.');
    }
    return appIds;
  }

  async write(command: NativeCommand, context: NativeOperationContext): Promise<unknown> {
    context.signal.throwIfAborted();
    try { return await this.adapter.execute(command, context); }
    catch (error) {
      if (error instanceof NativeError) {
        if (error.code === 'action_outcome_unknown') this.tainted = true;
        if (!['transport_lost', 'timeout', 'cancelled'].includes(error.code)) throw error;
      }
      this.tainted = true;
      throw new NativeError('action_outcome_unknown', `Native ${command.kind} response was lost; the action will not be repeated.`, { cause: error });
    }
  }

  async pause(context: NativeOperationContext): Promise<void> {
    const remaining = context.deadline - Date.now();
    if (remaining <= 0) throw new NativeError('timeout', 'Native condition was not met before the deadline.');
    try { await delay(Math.min(this.options.pollIntervalMs ?? 100, remaining), undefined, { signal: context.signal }); }
    catch { throw this.abortError(context.signal); }
  }

  dispose(): Promise<void> {
    if (!this.closing) {
      this.lifetime.abort(new NativeError('cancelled', 'Native session closed.'));
      this.closing = this.tail.then(() => this.adapter.dispose()).finally(() => this.unregisterEvidence?.());
    }
    return this.closing;
  }
}
