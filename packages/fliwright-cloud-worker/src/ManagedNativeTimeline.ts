import type { ManagedNativePhaseEvent } from '@fliwright/cli/run';
import { workerErrorMessages } from '@fliwright/cloud-protocol';
import type { WorkerTimelineChannel } from './WorkerTimelineChannel.js';

/** Converts owner observations into supervisor-owned, attempt-grouped timeline spans. */
export class ManagedNativeTimeline {
  private readonly phases = new Map<string, string>();
  private readonly attempts = new Map<string, { spanId?: string; ordinal: number }>();
  private ordinal = 0;
  private queue = Promise.resolve();

  constructor(private readonly channel?: WorkerTimelineChannel) {}

  observe(event: ManagedNativePhaseEvent): void {
    this.queue = this.queue.then(() => this.record(event)).catch(() => {});
  }

  flush(): Promise<void> { return this.queue; }

  private async record(event: ManagedNativePhaseEvent): Promise<void> {
    const hash = event.attemptKeyHash && /^[a-f0-9]{64}$/.test(event.attemptKeyHash) ? event.attemptKeyHash : undefined;
    if (event.type === 'started') {
      let attempt = hash ? this.attempts.get(hash) : undefined;
      if (hash && !attempt) {
        attempt = { ordinal: ++this.ordinal };
        attempt.spanId = await this.channel?.startSpan('native.attempt', { attemptOrdinal: attempt.ordinal });
        this.attempts.set(hash, attempt);
      }
      const span = await this.channel?.startSpan(event.phase, { parentSpanId: attempt?.spanId });
      if (span) this.phases.set(event.id, span);
      return;
    }

    const span = this.phases.get(event.id);
    if (span) {
      this.phases.delete(event.id);
      await this.channel?.finishSpan(span, event.status, {
        ...(event.reason ? { reason: event.reason } : {}),
        ...(event.error ? { error: { code: phaseErrorCode(event.phase), message: workerErrorMessages[phaseErrorCode(event.phase)] } } : {}),
      });
    }
    const attempt = hash ? this.attempts.get(hash) : undefined;
    if (attempt && (event.status !== 'succeeded' || event.phase === 'native.verify')) {
      await this.channel?.finishSpan(attempt.spanId, event.status, {
        ...(event.reason ? { reason: event.reason } : {}),
        ...(event.error ? { error: { code: 'preparation_failed', message: workerErrorMessages.preparation_failed } } : {}),
      });
      this.attempts.delete(hash!);
    }
  }
}

function phaseErrorCode(phase: ManagedNativePhaseEvent['phase']): keyof typeof workerErrorMessages {
  if (phase === 'native.launch') return 'launch_failed';
  if (phase === 'native.verify') return 'verification_failed';
  if (phase === 'native.cleanup' || phase === 'native.release') return 'stop_failed';
  return 'preparation_failed';
}
