import { randomUUID } from 'node:crypto';
import {
  workerErrorMessages, workerErrorMessage, type WorkerPhase, type WorkerTimelinePayload, type WorkerOperation, type WorkerStopReason,
} from '@fliwright/cloud-protocol';

type Finished = Extract<WorkerTimelinePayload, { type: 'span.finished' }>;
export type SpanOptions = { parentSpanId?: string; operation?: WorkerOperation; commandIndex?: number; attemptOrdinal?: number; signal?: AbortSignal };
const phaseErrors: Record<WorkerPhase, keyof typeof workerErrorMessages> = {
  'execution.prepare': 'preparation_failed', 'repository.checkout': 'command_failed', 'dependencies.install': 'command_failed',
  'device.reset.before': 'reset_failed', 'app.launch': 'launch_failed', 'app.verify': 'verification_failed',
  'tests.run': 'runner_failed', 'artifacts.export': 'export_failed', 'processes.stop': 'stop_failed',
  'report.publish': 'publish_failed', 'device.reset.after': 'reset_failed',
  'native.acquire': 'preparation_failed', 'native.build': 'preparation_failed', 'native.install': 'preparation_failed',
  'native.stop': 'preparation_failed', 'native.prepare': 'preparation_failed', 'native.launch': 'launch_failed',
  'native.verify': 'verification_failed', 'native.cleanup': 'stop_failed', 'native.release': 'stop_failed', 'native.attempt': 'preparation_failed',
};

/** Small interface shared by the supervisor and its acknowledged executor IPC channel. */
export class WorkerTimelineChannel {
  constructor(private readonly emit: (payload: WorkerTimelinePayload) => Promise<boolean>) {}
  async startSpan(phase: WorkerPhase, options: SpanOptions = {}): Promise<string | undefined> {
    if (options.operation && !options.parentSpanId) return undefined;
    const spanId = randomUUID();
    return await this.emit({ type: 'span.started', spanId, phase, parentSpanId: options.parentSpanId,
      ...(phase === 'native.attempt' ? { attemptOrdinal: options.attemptOrdinal } : {}), operation: options.operation, commandIndex: options.commandIndex }) ? spanId : undefined;
  }
  async finishSpan(spanId: string | undefined, status: Finished['status'], details: Omit<Partial<Finished>, 'spanId' | 'type' | 'status'> = {}) {
    if (spanId) await this.emit({ ...details, type: 'span.finished', spanId, status });
  }
  async milestone(name: Extract<WorkerTimelinePayload, { type: 'milestone' }>['name'], spanId?: string) {
    await this.emit({ type: 'milestone', name, spanId });
  }
  async run<T>(phase: WorkerPhase, action: (spanId?: string) => Promise<T>, options: SpanOptions = {}): Promise<T> {
    const spanId = await this.startSpan(phase, options);
    try {
      const result = await action(spanId);
      await this.finishSpan(spanId, 'succeeded');
      return result;
    } catch (error) {
      const code = phaseErrors[phase];
      const reason = options.signal?.aborted ? (options.signal.reason?.workerStopReason as WorkerStopReason | undefined) ?? 'shutdown' : undefined;
      const exitCode = error && typeof error === 'object' && 'exitCode' in error && Number.isInteger(error.exitCode) ? error.exitCode as number : undefined;
      const diagnostic = error && typeof error === 'object' && 'workerDiagnostic' in error && typeof error.workerDiagnostic === 'string' ? error.workerDiagnostic : undefined;
      await this.finishSpan(spanId, reason ? 'interrupted' : 'failed', { reason, exitCode, error: { code, message: workerErrorMessage(code, diagnostic) } });
      throw error;
    }
  }
}
