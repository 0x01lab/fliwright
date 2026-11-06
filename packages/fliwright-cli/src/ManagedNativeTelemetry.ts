import { createHash, randomUUID } from 'node:crypto';

export type ManagedNativePhase = 'native.acquire' | 'native.build' | 'native.install' | 'native.stop' | 'native.prepare'
  | 'native.launch' | 'native.verify' | 'native.cleanup' | 'native.release';
export type ManagedNativePhaseEvent =
  | { type: 'started'; id: string; phase: ManagedNativePhase; attemptKeyHash?: string; startedAt: string }
  | { type: 'finished'; id: string; phase: ManagedNativePhase; attemptKeyHash?: string; status: 'succeeded' | 'failed' | 'interrupted'; reason?: 'cancelled' | 'timeout' | 'shutdown' | 'lease_lost'; error?: { code: 'native_phase_failed'; message: 'Native phase failed' }; endedAt: string };
export type ManagedNativePhaseObserver = (event: ManagedNativePhaseEvent) => void;

/** Sanitized best-effort host telemetry. Observer failure never changes device work. */
export class ManagedNativeTelemetry {
  constructor(private readonly observe?: ManagedNativePhaseObserver) {}

  start(phase: ManagedNativePhase, options: { attemptKey?: string; signal?: AbortSignal } = {}) {
    const id = randomUUID();
    const attemptKeyHash = options.attemptKey ? createHash('sha256').update(options.attemptKey).digest('hex') : undefined;
    const binding = { id, phase, ...(attemptKeyHash ? { attemptKeyHash } : {}) };
    this.emit({ type: 'started', ...binding, startedAt: new Date().toISOString() });
    let finished = false;
    return { finish: (error?: unknown) => {
      if (finished) return;
      finished = true;
      const reason = options.signal?.aborted ? reasonFor(options.signal.reason) : undefined;
      const failed = error !== undefined && !options.signal?.aborted;
      this.emit({ type: 'finished', ...binding, status: reason ? 'interrupted' : failed ? 'failed' : 'succeeded',
        ...(reason ? { reason } : {}), ...(failed ? { error: { code: 'native_phase_failed', message: 'Native phase failed' } } : {}),
        endedAt: new Date().toISOString() });
    } };
  }

  async run<T>(phase: ManagedNativePhase, action: () => Promise<T>, options: { attemptKey?: string; signal?: AbortSignal } = {}): Promise<T> {
    const handle = this.start(phase, options);
    try { const result = await action(); handle.finish(); return result; }
    catch (error) { handle.finish(error); throw error; }
  }

  private emit(event: ManagedNativePhaseEvent): void {
    try { this.observe?.(event); } catch { /* Timeline is evidence, never an owner dependency. */ }
  }
}

function reasonFor(value: unknown): 'cancelled' | 'timeout' | 'shutdown' | 'lease_lost' {
  if (value instanceof DOMException && value.name === 'TimeoutError') return 'timeout';
  if (value && typeof value === 'object' && 'workerStopReason' in value) {
    const reason = value.workerStopReason;
    if (reason === 'timeout' || reason === 'shutdown' || reason === 'lease_lost' || reason === 'cancelled') return reason;
  }
  return 'cancelled';
}
