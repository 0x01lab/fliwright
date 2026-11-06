import { z } from 'zod';

/** Control messages have an explicit operation allowlist; they cannot proxy team APIs. */
export const workerOperationSchema = z.enum([
  '/api/worker/claim', '/api/worker/devices', '/api/worker/heartbeat',
  '/api/worker/result', '/api/worker/finish', '/api/worker/recover',
  '/api/worker/timeline',
  '/api/worker/assignments',
  '/api/worker/diagnostics',
  '/api/worker/scans/claim', '/api/worker/scans/heartbeat',
  '/api/worker/scans/result', '/api/worker/scans/failure',
]);
export const workerControlRequestSchema = z.object({
  type: z.literal('request'), id: z.string().uuid(),
  operation: workerOperationSchema, body: z.unknown(),
}).strict();
export const workerControlMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('response'), id: z.string().uuid(), status: z.number().int(), body: z.unknown() }).strict(),
  z.object({ type: z.literal('wake') }).strict(),
  z.object({ type: z.literal('cancel'), requestId: z.string().min(1) }).strict(),
  z.object({ type: z.literal('scan-cancel'), scanId: z.string().min(1) }).strict(),
]);
export type WorkerControlMessage = z.infer<typeof workerControlMessageSchema>;
export interface CloudRequestClient {
  /** Successful connection/reconnection notifications for clients with a persistent transport. */
  onConnected?(listener: () => void): () => void;
  request<T>(path: string, options?: { method?: string; body?: unknown; signal?: AbortSignal }): Promise<T>;
}
