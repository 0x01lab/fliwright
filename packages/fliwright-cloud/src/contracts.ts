import { z } from 'zod';

export const idSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/);
export const commandSchema = z
  .object({ program: z.string().min(1), args: z.array(z.string()).default([]) })
  .strict();
export const targetSchema = z
  .object({
    id: idSchema,
    name: z.string().min(1).max(100),
    repository: z.string().min(1),
    projectPath: z
      .string()
      .refine(
        (path) =>
          !path.startsWith('/') &&
          !path.includes('\\') &&
          !path.split('/').includes('..'),
        'Project must remain inside checkout',
      )
      .default('.'),
    entry: z.string().default('lib/main.dart'),
    suites: z.record(z.string().min(1)),
    scenarios: z.array(z.string().min(1)).min(1),
    requiredCapabilities: z.array(z.string()).default([]),
    install: z.array(commandSchema).default([]),
    flutterArgs: z.array(z.string()).default([]),
    timeoutMs: z.number().int().min(1000).max(7200000).default(1800000),
  })
  .strict();
export const workerSchema = z
  .object({
    id: idSchema,
    slots: z
      .array(
        z
          .object({
            id: idSchema,
            deviceId: z.string().min(1),
            targets: z.array(idSchema).min(1),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();
export const submissionSchema = z
  .object({
    targetId: idSchema,
    commit: z.string().regex(/^[0-9a-f]{40}$/),
    suite: z.string().min(1).max(100),
    scenario: z.string().min(1).max(100),
    source: z
      .object({
        branch: z.string().max(200).optional(),
        pipelineUrl: z.string().url().optional(),
        jobUrl: z.string().url().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export const outcomeSchema = z
  .object({
    verdict: z.enum(['passed', 'failed', 'skipped', 'interrupted', 'unknown']),
    cleanup: z.enum(['clean', 'failed']),
    publication: z.enum(['published', 'publish_failed', 'unavailable']),
    infrastructure: z.enum(['transient', 'permanent']).optional(),
    error: z.string().max(4000).optional(),
  })
  .strict();
export const resultSchema = outcomeSchema.pick({
  verdict: true,
  infrastructure: true,
  error: true,
});
export const leaseKeySchema = z.object({
  workerId: idSchema,
  slotId: idSchema,
  attemptId: idSchema,
  generation: z.number().int().positive(),
});
export const fileSchema = z
  .object({
    path: z.string().min(1).max(500),
    size: z
      .number()
      .int()
      .nonnegative()
      .max(32 * 1024 * 1024),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();
export const publicationSchema = z
  .object({
    runId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,150}$/),
    files: z.array(fileSchema).min(1).max(5000),
  })
  .strict();
export type ApplicationTarget = z.infer<typeof targetSchema>;
export type WorkerConfig = z.infer<typeof workerSchema>;
export type Submission = z.infer<typeof submissionSchema>;
export type Outcome = z.infer<typeof outcomeSchema>;
export type LeaseKey = z.infer<typeof leaseKeySchema>;
export type PublicationInput = z.infer<typeof publicationSchema>;
export type RequestState =
  | 'queued'
  | 'assigned'
  | 'preparing'
  | 'running'
  | 'finalizing'
  | 'cancel_requested'
  | 'completed'
  | 'cancelled'
  | 'infrastructure_failed';
export interface TestRequest {
  id: string;
  input: Submission;
  target: ApplicationTarget;
  actor: string;
  createdAt: number;
  queuedAt: number;
  state: RequestState;
  verdict: Outcome['verdict'];
  attempts: number;
}
export interface ExecutionAttempt extends LeaseKey {
  result?: z.infer<typeof resultSchema>;
  requestId: string;
  number: number;
  expiresAt: number;
  stage: string;
  outcome?: Outcome;
  bundleId?: string;
  finishedAt?: number;
}
export interface ExecutionLease extends LeaseKey {
  request: TestRequest;
  expiresAt: number;
  deviceId: string;
}
export interface ExecutionSlot {
  workerId: string;
  id: string;
  deviceId: string;
  targets: string[];
  state: 'idle' | 'busy' | 'quarantined';
  generation: number;
  attemptId: string | null;
}
export interface ExecutionWorker {
  health: 'healthy' | 'offline' | 'unseen' | 'quarantined';
  id: string;
  paused: boolean;
  seenAt: number;
  slots: ExecutionSlot[];
}
export class CloudError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'CloudError';
  }
}
