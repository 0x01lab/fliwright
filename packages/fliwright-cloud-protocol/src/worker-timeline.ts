import { z } from 'zod';
import { leaseKeySchema, outcomeSchema, type Outcome } from './contracts.js';

export const workerPhaseSchema = z.enum([
  'execution.prepare', 'repository.checkout', 'dependencies.install',
  'device.reset.before', 'app.launch', 'app.verify', 'tests.run',
  'artifacts.export', 'processes.stop', 'report.publish', 'device.reset.after',
  'native.acquire', 'native.build', 'native.install', 'native.stop', 'native.prepare', 'native.launch', 'native.verify', 'native.cleanup', 'native.release',
  'native.attempt',
]);
export const workerTimelineOperationSchema = z.enum(['clone', 'fetch', 'checkout', 'verify_sha', 'command', 'publication.prepare', 'publication.commit']);
export const workerMilestoneSchema = z.enum(['app.process_started', 'app.started', 'vm.endpoint_observed']);
export const workerStopReasonSchema = z.enum(['cancelled', 'timeout', 'shutdown', 'process_exit', 'lease_lost']);
export const workerRecordingIssueSchema = z.enum(['storage_error', 'ipc_timeout', 'capacity', 'delivery_error', 'missing_events', 'open_spans', 'truncated']);
const errorCodeSchema = z.enum(['command_failed', 'launch_failed', 'verification_failed', 'runner_failed', 'export_failed', 'stop_failed', 'publish_failed', 'reset_failed', 'preparation_failed']);
const workerId = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/);
const offset = z.number().finite().nonnegative().max(7 * 86400000);
export const workerTimelinePayloadSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('span.started'), spanId: workerId, parentSpanId: workerId.optional(),
    phase: workerPhaseSchema, attemptOrdinal: z.number().int().positive().max(10000).optional(),
    operation: workerTimelineOperationSchema.optional(), commandIndex: z.number().int().nonnegative().optional() }).strict(),
  z.object({ type: z.literal('span.finished'), spanId: workerId, status: z.enum(['succeeded', 'failed', 'interrupted']),
    reason: workerStopReasonSchema.optional(), error: z.object({ code: errorCodeSchema, message: z.string().max(1024) }).strict().optional(),
    exitCode: z.number().int().optional(), testVerdict: outcomeSchema.shape.verdict.optional(), runId: workerId.optional() }).strict(),
  z.object({ type: z.literal('milestone'), name: workerMilestoneSchema, spanId: workerId.optional() }).strict(),
]);
export const workerTimelineEventSchema = z.object({
  schemaVersion: z.union([z.literal(1), z.literal(2)]), seq: z.number().int().positive().safe(), recordedAt: z.string().datetime(),
  offsetMs: offset, payload: workerTimelinePayloadSchema,
}).strict().refine(event => {
  if (event.payload.type !== 'span.started') return true;
  if (event.schemaVersion === 1) return event.payload.phase !== 'native.attempt' && event.payload.attemptOrdinal === undefined;
  return event.payload.phase === 'native.attempt'
    ? event.payload.attemptOrdinal !== undefined
    : event.payload.attemptOrdinal === undefined;
}, 'Worker attempt groups require schema version 2 and an ordinal')
  .refine(event => new TextEncoder().encode(JSON.stringify(event)).length <= 4096, 'Worker event exceeds 4 KiB');
export const workerTimelineBatchSchema = leaseKeySchema.extend({ originAt: z.string().datetime(), events: z.array(workerTimelineEventSchema).min(1).max(64) }).strict();
export const workerTimelineClockSchema = z.object({ offsetMs: offset, lastProducedSeq: z.number().int().nonnegative().safe(), issues: z.array(workerRecordingIssueSchema).max(16).default([]) }).strict();
export const workerTimelineFinishSchema = workerTimelineClockSchema;

export type WorkerPhase = z.infer<typeof workerPhaseSchema>;
export type WorkerOperation = z.infer<typeof workerTimelineOperationSchema>;
export type WorkerStopReason = z.infer<typeof workerStopReasonSchema>;
export type WorkerRecordingIssue = z.infer<typeof workerRecordingIssueSchema>;
export type WorkerTimelinePayload = z.infer<typeof workerTimelinePayloadSchema>;
export type WorkerTimelineEvent = z.infer<typeof workerTimelineEventSchema>;
export type WorkerTimelineBatch = z.infer<typeof workerTimelineBatchSchema>;
export type WorkerTimelineClock = z.infer<typeof workerTimelineClockSchema>;
export type WorkerTimelineFinish = z.infer<typeof workerTimelineFinishSchema>;
export type WorkerTimelineQuality = 'recording' | 'complete' | 'partial' | 'not_recorded';
export interface WorkerTimelineSummary {
  originAt: string; ackSeq: number; revision: number; quality: WorkerTimelineQuality;
  lastOffsetMs: number; lastProducedSeq: number; issues: WorkerRecordingIssue[];
  endedOffsetMs?: number; expiredAt?: number;
}
export interface WorkerTimelineSpan {
  id: string; parentSpanId?: string; phase: WorkerPhase; attemptOrdinal?: number; operation?: WorkerOperation; commandIndex?: number;
  status: 'running' | 'succeeded' | 'failed' | 'interrupted' | 'unknown';
  startedAt: string; startMs: number; endedAt?: string; endMs?: number; durationMs?: number;
  startSeq: number; endSeq?: number; reason?: WorkerStopReason;
  error?: { code: string; message: string }; exitCode?: number; testVerdict?: Outcome['verdict']; runId?: string;
}
export interface WorkerTimelineView {
  schemaVersion: 1; requestId: string; executionAttemptId: string; workerId: string; slotId: string; deviceId: string;
  executionStatus: 'running' | 'finished' | 'lost'; testVerdict: Outcome['verdict']; outcome?: Outcome;
  quality: WorkerTimelineQuality; issues: WorkerRecordingIssue[]; revision: number; cursor: number;
  originAt?: string; assignedAt?: number; finishedAt?: number; lastReceivedAt?: number; expiredAt?: number;
  observedOffsetMs: number; spans: WorkerTimelineSpan[];
  milestones: Array<{ seq: number; offsetMs: number; recordedAt: string; name: z.infer<typeof workerMilestoneSchema>; spanId?: string }>;
  report?: { bundleId: string; runId: string };
}

export const workerErrorMessages = {
  command_failed: 'Configured command failed', launch_failed: 'Flutter App launch failed',
  verification_failed: 'VM Service or Bridge verification failed', runner_failed: 'Test runner failed',
  export_failed: 'Test report export failed', stop_failed: 'Owned process termination failed',
  publish_failed: 'Test report publication failed', reset_failed: 'Device reset failed', preparation_failed: 'Execution preparation failed',
} as const;

/** Preserve specific safe diagnoses; arbitrary subprocess error strings never enter the timeline. */
export function workerErrorMessage(code: keyof typeof workerErrorMessages, diagnostic?: string): string {
  return code === 'verification_failed' && diagnostic && /^Bridge protocol incompatible \(client=(?:\d+|unknown), bridge=(?:\d+|unknown)\)$/.test(diagnostic)
    ? diagnostic : workerErrorMessages[code];
}

/** Scheduling retains its existing states while timeline phases describe actual work. */
export function workerPhaseStage(phase: WorkerPhase): string {
  if (phase === 'tests.run') return 'running';
  if (phase === 'native.attempt') return 'running';
  if (['processes.stop', 'report.publish', 'device.reset.after'].includes(phase)) return 'finalizing';
  if (phase === 'native.cleanup' || phase === 'native.release') return 'finalizing';
  if (phase.startsWith('native.')) return 'launch';
  return ({ 'execution.prepare': 'assigned', 'repository.checkout': 'checkout', 'dependencies.install': 'install',
    'device.reset.before': 'reset_before', 'app.launch': 'launch', 'app.verify': 'launch', 'artifacts.export': 'export' } as Partial<Record<WorkerPhase, string>>)[phase]!;
}
