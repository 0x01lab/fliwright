import { z } from 'zod';
import { selectorQuerySchema } from './wire-protocol.js';
import type { RecordedTarget } from './types.js';

export const runStatusSchema = z.enum(['running', 'passed', 'failed', 'skipped', 'interrupted']);
export type RunStatus = z.infer<typeof runStatusSchema>;

export const evidenceStatusSchema = z.enum(['complete', 'partial', 'disabled']);
export type EvidenceStatus = z.infer<typeof evidenceStatusSchema>;

const pointerPayloadSchema = z.object({
  kind: z.literal('pointer'),
  phase: z.enum(['down', 'move', 'up', 'cancel']),
  pointer: z.number().int().nonnegative(),
  x: z.number(),
  y: z.number(),
  viewportWidth: z.number().positive(),
  viewportHeight: z.number().positive(),
  pixelRatio: z.number().positive(),
  durationMs: z.number().nonnegative().optional(),
}).strict();

const textPayloadSchema = z.object({
  kind: z.literal('text'),
  value: z.string(),
  sensitive: z.literal(true).optional(),
  focusSessionId: z.string().min(1),
}).strict();

const focusPayloadSchema = z.object({
  kind: z.literal('focus'),
  focused: z.boolean(),
  focusSessionId: z.string().min(1).optional(),
}).strict();

const routePayloadSchema = z.object({
  kind: z.literal('route'),
  route: z.string(),
}).strict();

export const recordingSelectorCandidateSchema = z.object({
  query: selectorQuerySchema,
  matchCount: z.number().int().nonnegative().safe(),
  matchesTarget: z.boolean(),
  stability: z.enum(['key', 'semantics', 'label', 'ancestor', 'positional']),
}).strict();

export const recordedTargetSchema: z.ZodType<RecordedTarget> = z.object({
  targetId: z.string().min(1),
  status: z.enum(['resolved', 'unresolved']),
  candidates: z.array(recordingSelectorCandidateSchema).max(16),
  issue: z.string().optional(),
  route: z.string().nullable().optional(),
  ancestorPath: z.array(z.object({ type: z.string(), key: z.string().optional() }).strict()).max(16).optional(),
}).passthrough();

export const recordingEventEnvelopeSchema = z.object({
  version: z.literal(2),
  sessionId: z.string().min(1),
  sequence: z.number().int().positive().safe(),
  elapsedUs: z.number().int().nonnegative(),
  frameId: z.string().min(1),
  targetId: z.string().min(1).optional(),
  target: recordedTargetSchema.optional(),
  payload: z.discriminatedUnion('kind', [
    pointerPayloadSchema,
    textPayloadSchema,
    focusPayloadSchema,
    routePayloadSchema,
  ]),
}).strict().refine((event) => event.target === undefined || event.targetId === event.target.targetId, {
  message: 'Recording envelope targetId must identify its frozen target.',
  path: ['targetId'],
}).refine((event) => event.payload.kind !== 'text' || !event.payload.sensitive || event.payload.value === '<masked>', {
  message: 'Sensitive recording input must be masked before transport.',
  path: ['payload', 'value'],
});
export type RecordingEventEnvelope = z.infer<typeof recordingEventEnvelopeSchema>;

export const recordingHandshakeSchema = z.object({
  protocolVersion: z.literal(2),
  compatible: z.literal(true),
  bridgeCapabilities: z.object({
    recordingProtocolVersion: z.literal(2),
    recordingBeforeDispatchTarget: z.literal(true),
    recordingFocusedInputController: z.literal(true),
  }).passthrough(),
}).passthrough();

export const recordingStartResponseSchema = z.object({
  protocolVersion: z.literal(2),
  recording: z.literal(true),
  sessionId: z.string().min(1),
  success: z.literal(true).optional(),
}).strict();

export const recordingStopResponseSchema = z.object({
  protocolVersion: z.literal(2),
  recording: z.literal(false),
  sessionId: z.string().min(1),
  lastSequence: z.number().int().nonnegative().safe(),
  success: z.literal(true).optional(),
}).strict();

const attemptManifestSchema = z.object({
  attemptId: z.string().min(1),
  resultPath: z.string().min(1),
}).strict();

const runErrorSchema = z.object({
  phase: z.string().min(1),
  message: z.string(),
  stack: z.string().optional(),
  file: z.string().optional(),
}).strict();
export type RunError = z.infer<typeof runErrorSchema>;

export const runManifestSchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.string().min(1),
  status: runStatusSchema,
  evidenceStatus: evidenceStatusSchema,
  /** Errors reported outside individual test attempts (collection/suite/worker/process). */
  runnerErrors: z.array(runErrorSchema).optional(),
  tests: z.array(z.object({
    testId: z.string().min(1),
    attempts: z.array(attemptManifestSchema),
  }).strict()),
}).strict();
export type RunManifest = z.infer<typeof runManifestSchema>;
