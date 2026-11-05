import { z } from 'zod';

export const workerLogLevelSchema = z.enum(['info', 'warn', 'error', 'fatal']);
export const workerLogSchema = z.object({
  sessionId: z.string().uuid(), seq: z.number().int().positive().safe(), at: z.string().datetime(),
  level: workerLogLevelSchema, event: z.string().regex(/^[a-z][a-z0-9_.-]{0,99}$/),
  message: z.string().max(4000), stack: z.string().max(8000).optional(),
  slotId: z.string().max(100).optional(), requestId: z.string().max(100).optional(),
  attemptId: z.string().max(100).optional(), spanId: z.string().max(100).optional(),
}).strict();
export const workerServiceReportSchema = z.object({
  sessionId: z.string().uuid(), startedAt: z.string().datetime(), pid: z.number().int().positive(),
  nodeVersion: z.string().max(40), state: z.enum(['healthy', 'degraded', 'failed', 'stopped']),
  uptimeMs: z.number().finite().nonnegative(), rssBytes: z.number().finite().nonnegative(),
  eventLoopLagMs: z.number().finite().nonnegative(),
  components: z.record(z.string().max(100), z.enum(['running', 'failed', 'stopped'])).refine(value => Object.keys(value).length <= 100),
  logs: z.array(workerLogSchema).max(100),
}).strict();
export type WorkerLog = z.infer<typeof workerLogSchema>;
export type WorkerServiceReport = z.infer<typeof workerServiceReportSchema>;
export interface WorkerDiagnosticsView {
  sessions: Array<Omit<WorkerServiceReport, 'logs'> & { receivedAt: number; status: WorkerServiceReport['state'] | 'unreachable' }>;
  logs: Array<WorkerLog & { id: number; receivedAt: number }>;
  nextCursor: number;
}

/** Apply the same credential redaction before local persistence and before publication. */
export function redactDiagnostic(value: string, secrets: string[] = []): string {
  let text = value;
  for (const secret of secrets) if (secret) text = text.split(secret).join('[redacted]');
  return text
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [redacted]')
    .replace(/(?:wss?|https?|ssh):\/\/[^\s"'<>]+/gi, '[endpoint]')
    .replace(/((?:["']?)(?:[\w-]*(?:token|password|secret|authorization|cookie|api[_-]?key)[\w-]*)(?:["']?)\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;}]+)/gi, '$1[redacted]');
}
