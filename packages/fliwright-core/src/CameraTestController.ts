import type { AppCapabilityDescriptor } from './AppInstance.js';
import type { RunSession } from './RunSession.js';

export type CameraTestResult =
  | { kind: 'image'; fixtureId: string }
  | { kind: 'cancel' }
  | { kind: 'error'; code: string; message?: string };

export interface CameraTestStatus {
  schemaVersion: 1;
  surface: 'app-test-seam';
  generation: string;
  pending: number;
  consumed: number;
  enqueued: number;
  loading: boolean;
  consumedResults: Array<{ kind: 'image'; fixtureId: string } | { kind: 'cancel' } | { kind: 'error'; code: string }>;
  discarded?: number;
}

export interface CameraTestApp {
  listCapabilities(): Promise<AppCapabilityDescriptor[]>;
  invoke(capability: string, method: string, input?: unknown): Promise<unknown>;
}

export interface CameraTestControllerOptions {
  runSession?: RunSession;
  timeoutMs?: number;
}

/** One app-owned camera queue per attempt; never injects a real camera frame. */
export class CameraTestController {
  private generation = '';
  private tail: Promise<unknown> = Promise.resolve();
  private closing?: Promise<void>;
  private tainted = false;
  private cleanupSignal?: AbortSignal;

  private constructor(private readonly app: CameraTestApp, private readonly options: CameraTestControllerOptions) {}

  /** Explicit opt-in: require the app capability, then start an empty generation. */
  static async create(app: CameraTestApp, options: CameraTestControllerOptions = {}): Promise<CameraTestController> {
    if (options.timeoutMs !== undefined && (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)) throw new Error('Camera test timeout must be positive and finite.');
    const camera = new CameraTestController(app, options);
    await camera.perform('Camera test capability', async () => {
      const capability = (await camera.bounded(() => app.listCapabilities())).find(item => item.name === 'cameraTest');
      if (!capability || ['reset', 'enqueueResult', 'getStatus'].some(method => !capability.methods.includes(method))) {
        throw new Error('Register a complete cameraTest capability in the app test entrypoint before requesting cameraTest.');
      }
    });
    const status = await camera.invoke('reset');
    camera.generation = status.generation;
    if (status.pending || status.consumed || status.enqueued || status.loading) throw new Error('Camera test reset did not produce an empty ready queue.');
    return camera;
  }

  async enqueueResult(result: CameraTestResult): Promise<CameraTestStatus> {
    const declaration = validateResult(result);
    return this.schedule(async () => {
      if (this.tainted) throw new Error('Camera test write outcome is unknown; dispose this controller before continuing.');
      return this.invoke('enqueueResult', { generation: this.generation, result: declaration });
    });
  }

  getStatus(): Promise<CameraTestStatus> {
    return this.schedule(() => this.invoke('getStatus', { generation: this.generation }));
  }

  /** Fail on unconsumed results instead of letting a later test use them. */
  assertConsumed(): Promise<void> {
    return this.schedule(() => this.verifyConsumed());
  }

  /** Verify consumption and invalidate this generation even when verification fails. */
  dispose(options: { signal?: AbortSignal } = {}): Promise<void> {
    return this.closing ??= this.schedule(async () => {
      this.cleanupSignal = options.signal;
      const errors: unknown[] = [];
      try { await this.verifyConsumed(); } catch (error) { errors.push(error); }
      try { await this.invoke('reset', { generation: this.generation }, false); }
      catch (error) { errors.push(error); }
      if (errors.length === 1) throw errors[0];
      if (errors.length) throw new AggregateError(errors, 'Camera test verification and generation cleanup failed.');
    });
  }

  private async verifyConsumed(): Promise<void> {
    const status = await this.invoke('getStatus', { generation: this.generation });
    await this.perform('Camera test consumption', async () => {
      if (status.loading || status.pending) throw new Error(`${status.pending} camera test results remain unconsumed${status.loading ? ' and fixture loading is active' : ''}.`);
    }, { pending: status.pending, consumed: status.consumed, enqueued: status.enqueued, loading: status.loading });
  }

  private schedule<T>(work: () => Promise<T>): Promise<T> {
    if (this.closing) return Promise.reject(new Error('Camera test controller is closed.'));
    const result = this.tail.then(work);
    this.tail = result.catch(() => undefined);
    return result;
  }

  private async invoke(method: string, input?: unknown, sameGeneration = true): Promise<CameraTestStatus> {
    return this.perform(`Camera test ${method}`, async () => {
      try {
        const status = validateStatus(await this.bounded(() => this.app.invoke('cameraTest', method, input)));
        if (sameGeneration && this.generation && status.generation !== this.generation) throw new Error('Camera test generation belongs to a different attempt.');
        return status;
      } catch (error) {
        if (method !== 'getStatus') this.tainted = true;
        throw error;
      }
    });
  }

  private perform<T>(title: string, work: () => Promise<T>, metadata: Record<string, unknown> = {}): Promise<T> {
    return this.options.runSession ? this.options.runSession.perform({ kind: 'raw', title, metadata: {
      surface: 'flutter', coverage: 'app-test-seam', testSeam: 'camera', cameraGeneration: this.generation || undefined, ...metadata,
    } }, work) : work();
  }

  private async bounded<T>(work: () => Promise<T>): Promise<T> {
    const signal = this.cleanupSignal;
    signal?.throwIfAborted();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    try {
      return await Promise.race([Promise.resolve().then(() => { signal?.throwIfAborted(); return work(); }), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Camera test capability request timed out; its write outcome may be unknown.')), this.options.timeoutMs ?? 5000);
        abort = () => reject(signal?.reason ?? new Error('Camera test cleanup cancelled.'));
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
      })]);
    } finally {
      clearTimeout(timer);
      if (abort) signal?.removeEventListener('abort', abort);
    }
  }
}

const reference = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function validateResult(value: unknown): CameraTestResult {
  if (!object(value)) throw new Error('Camera test result must be an object.');
  const keys = value.kind === 'image' ? ['kind', 'fixtureId'] : value.kind === 'error' ? ['kind', 'code', 'message'] : ['kind'];
  if (Object.keys(value).some(key => !keys.includes(key))) throw new Error('Unexpected camera test result fields.');
  if (value.kind === 'cancel') return { kind: 'cancel' };
  if (value.kind === 'image' && typeof value.fixtureId === 'string' && reference.test(value.fixtureId)) return { kind: 'image', fixtureId: value.fixtureId };
  if (value.kind === 'error' && typeof value.code === 'string' && value.code.length <= 128 && reference.test(value.code)
    && (value.message === undefined || (typeof value.message === 'string' && value.message.length <= 1024))) {
    return { kind: 'error', code: value.code, ...(value.message !== undefined ? { message: value.message } : {}) };
  }
  throw new Error('Camera test result requires image with a portable fixtureId, cancel, or a bounded error.');
}

function validateStatus(value: unknown): CameraTestStatus {
  if (!object(value) || value.schemaVersion !== 1 || value.surface !== 'app-test-seam' || typeof value.generation !== 'string' || !value.generation
    || typeof value.loading !== 'boolean' || !Array.isArray(value.consumedResults)) throw new Error('Invalid camera test status protocol.');
  for (const key of ['pending', 'consumed', 'enqueued'] as const) {
    if (!Number.isInteger(value[key]) || Number(value[key]) < 0 || Number(value[key]) > 32) throw new Error('Invalid camera test status counts.');
  }
  if (Number(value.pending) + Number(value.consumed) !== value.enqueued || value.consumedResults.length !== value.consumed) throw new Error('Inconsistent camera test status counts.');
  for (const result of value.consumedResults) validateResult(result);
  return value as unknown as CameraTestStatus;
}
