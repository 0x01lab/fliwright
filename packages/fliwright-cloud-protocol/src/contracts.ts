import { z } from 'zod';
import type { WorkerTimelineSummary } from './worker-timeline.js';

export const deviceInventorySchema = z
  .object({
    scannedAt: z.string().datetime(),
    devices: z
      .array(
        z
          .object({
            id: z.string().min(1).max(300),
            name: z.string().min(1).max(300),
            platform: z.enum(['ios', 'android']),
            kind: z.enum(['physical', 'simulator']),
            state: z.enum([
              'online',
              'offline',
              'unauthorized',
              'shutdown',
              'unavailable',
              'unknown',
            ]),
            osVersion: z.string().max(200).optional(),
            model: z.string().max(300).optional(),
            avdName: z.string().max(300).optional(),
            detail: z.string().max(4000).optional(),
          })
          .strict(),
      )
      .max(1000),
    diagnostics: z
      .array(
        z
          .object({
            source: z.enum([
              'adb',
              'android-emulator',
              'ios-simulator',
              'ios-device',
            ]),
            code: z.enum([
              'missing-tool',
              'command-failed',
              'invalid-output',
              'unsupported-host',
            ]),
            message: z.string().max(4000),
          })
          .strict(),
      )
      .max(2000),
  })
  .strict();
export type DeviceInventory = z.infer<typeof deviceInventorySchema>;

export const idSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/);
/** Persistent cloud policy; host discovery never overwrites these values. */
export const deviceSettingsSchema = z
  .object({
    alias: z.string().trim().max(100),
    tags: z.array(z.string().trim().min(1).max(50)).max(30),
    managed: z.boolean(),
    enabled: z.boolean(),
    targets: z.array(idSchema).max(100),
    slotId: idSchema.nullable(),
  })
  .strict();
export type DeviceSettings = z.infer<typeof deviceSettingsSchema>;
export type DeviceBlocker =
  | 'unmanaged'
  | 'disabled'
  | 'missing'
  | 'stale'
  | 'not-online'
  | 'worker-paused'
  | 'no-slot'
  | 'no-targets'
  | 'runtime-missing'
  | 'runtime-mismatch'
  | 'busy'
  | 'quarantined';
export interface ManagedDevice {
  id: string;
  workerId: string;
  nativeId: string;
  observation: DeviceInventory['devices'][number];
  lastSeenAt: number;
  present: boolean;
  stale: boolean;
  settings: DeviceSettings;
  slot?: ExecutionSlot;
  runtimeSeenAt?: number;
  blockers: DeviceBlocker[];
  ready: boolean;
}
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
export const projectSchema = targetSchema
  .extend({
    defaultBranch: z.string().trim().min(1).max(200).default('main'),
    configRevision: z.number().int().positive().default(1),
    repositoryCredentialRef: z.string().trim().min(1).max(200).nullable().default(null),
    webhookSecretDigest: z.string().regex(/^[a-f0-9]{64}$/).nullable().default(null),
    webhookStatus: z.enum(['disabled', 'configured', 'active']).default('disabled'),
    autoRun: z
      .object({
        enabled: z.boolean().default(false),
        branch: z.string().trim().min(1).max(200).default('main'),
        selections: z
          .array(
            z.object({ suite: z.string().min(1).max(100), scenario: z.string().min(1).max(100) }).strict(),
          )
          .max(100)
          .default([]),
        revision: z.number().int().positive().default(1),
      })
      .strict()
      .default({ enabled: false, branch: 'main', selections: [], revision: 1 }),
  })
  .strict()
  .superRefine((project, ctx) => {
    if (project.autoRun.enabled && !project.autoRun.selections.length)
      ctx.addIssue({ code: 'custom', path: ['autoRun', 'selections'], message: 'Select at least one suite/scenario' });
    for (const selection of project.autoRun.selections) {
      if (!Object.hasOwn(project.suites, selection.suite))
        ctx.addIssue({ code: 'custom', path: ['autoRun', 'selections'], message: `Unknown suite ${selection.suite}` });
      if (!project.scenarios.includes(selection.scenario))
        ctx.addIssue({ code: 'custom', path: ['autoRun', 'selections'], message: `Unknown scenario ${selection.scenario}` });
    }
  });
export const workerSchema = z
  .object({
    id: idSchema,
    catalogProjects: z.array(idSchema).max(100).default([]),
    slots: z.array(
      z
        .object({
          id: idSchema,
          deviceId: z.string().min(1),
          targets: z.array(idSchema).min(1),
        })
        .strict(),
    ),
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
export const projectSubmissionSchema = z.object({
  projectId: idSchema,
  commit: z.string().regex(/^[0-9a-f]{40}$/),
  mode: z.enum(['suite', 'case']),
  suite: z.string().min(1).max(100),
  scenario: z.string().min(1).max(100),
  caseId: z.string().regex(/^[a-zA-Z0-9._:/-]{1,300}$/).optional(),
  catalogId: idSchema.optional(),
  source: z.object({
    kind: z.enum(['manual', 'push']).default('manual'),
    branch: z.string().max(200).optional(),
    deliveryId: z.string().max(300).optional(),
    submitter: z.string().max(200).optional(),
    pipelineUrl: z.string().url().optional(),
    jobUrl: z.string().url().optional(),
  }).strict().default({ kind: 'manual' }),
  autoPolicyRevision: z.number().int().positive().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.mode === 'case' && !value.caseId) ctx.addIssue({ code: 'custom', path: ['caseId'], message: 'Case selection requires caseId' });
  if (value.mode === 'suite' && value.caseId) ctx.addIssue({ code: 'custom', path: ['caseId'], message: 'Suite selection cannot include caseId' });
});
export type ProjectSubmission = z.infer<typeof projectSubmissionSchema>;
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
export type Project = z.infer<typeof projectSchema>;
export const catalogCaseSchema = z.object({
  caseId: z.string().regex(/^[a-zA-Z0-9._:/-]{1,300}$/),
  file: z.string().min(1).max(500).refine((value) => !value.startsWith('/') && !value.split('/').includes('..') && !value.includes('\\'), 'Catalog paths must stay inside the checkout'),
  titlePath: z.array(z.string().min(1).max(300)).min(1).max(30),
  duplicateIndex: z.number().int().nonnegative().default(0),
}).strict();
export const catalogSuiteSchema = z.object({
  id: z.string().min(1).max(100),
  pattern: z.string().min(1).max(500),
  files: z.array(z.string().min(1).max(500)).max(1000),
  cases: z.array(catalogCaseSchema).max(10000),
}).strict();
export const catalogScenarioSchema = z.object({
  name: z.string().min(1).max(100),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export const catalogSchema = z.object({
  catalogId: idSchema,
  projectId: idSchema,
  commit: z.string().regex(/^[0-9a-f]{40}$/),
  configRevision: z.number().int().positive(),
  createdAt: z.number().int().nonnegative(),
  status: z.enum(['ready', 'failed']),
  errorSummary: z.string().max(4000).optional(),
  scenarios: z.array(catalogScenarioSchema).max(100),
  suites: z.array(catalogSuiteSchema).max(100),
  scannerVersion: z.string().min(1).max(100),
  fliwrightVersion: z.string().min(1).max(100),
}).strict();
export type TestCatalog = z.infer<typeof catalogSchema>;
export const catalogScanSchema = z.object({
  scanId: idSchema,
  projectId: idSchema,
  commit: z.string().regex(/^[0-9a-f]{40}$/),
  branch: z.string().max(200).optional(),
  configRevision: z.number().int().positive(),
  status: z.enum(['queued', 'running', 'ready', 'failed', 'cancelled']),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  errorSummary: z.string().max(4000).optional(),
}).strict();
export type CatalogScan = z.infer<typeof catalogScanSchema>;
export const catalogResultSchema = z.object({
  scanId: idSchema,
  catalog: catalogSchema,
}).strict();
export const webhookPushSchema = z.object({
  object_kind: z.literal('push'),
  ref: z.string().regex(/^refs\/heads\/[^\s]{1,180}$/),
  checkout_sha: z.string().regex(/^[0-9a-f]{40}$/).nullable(),
  before: z.string().regex(/^[0-9a-f]{40}$/),
  after: z.string().regex(/^[0-9a-f]{40}$/),
  event_created_at: z.string().datetime().optional(),
  project: z.object({ id: z.union([z.string(), z.number()]), web_url: z.string().url().optional(), path_with_namespace: z.string().max(300).optional() }).passthrough(),
  user_username: z.string().max(200).optional(),
}).passthrough();
export type WebhookPush = z.infer<typeof webhookPushSchema>;
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
  | 'superseded'
  | 'infrastructure_failed';
export interface TestRequest {
  id: string;
  input: Submission;
  target: ApplicationTarget;
  projectId?: string;
  actor: string;
  createdAt: number;
  queuedAt: number;
  state: RequestState;
  verdict: Outcome['verdict'];
  attempts: number;
  configRevision?: number;
  catalogId?: string;
  selection?: { mode: 'suite' | 'case'; suite: string; scenario: string; caseId?: string; file?: string; titlePath?: string[]; duplicateIndex?: number };
  source?: ProjectSubmission['source'];
  autoPolicyRevision?: number;
  supersededBy?: string;
}
export interface ExecutionAttempt extends LeaseKey {
  assignedAt?: number;
  deviceId?: string;
  workerTimeline?: WorkerTimelineSummary;
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
  /** Last host scan. Staleness uses server receipt time, independent of worker lease health. */
  inventory?: DeviceInventory & { receivedAt: number; stale: boolean };
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

export interface CatalogScanLease {
  scan: CatalogScan;
  project: Project;
  token: string;
  expiresAt: number;
  push?: { branch: string; deliveryId: string; policyRevision: number };
}
export const scanLeaseKeySchema = z.object({ scanId: idSchema, token: z.string().uuid() }).strict();
