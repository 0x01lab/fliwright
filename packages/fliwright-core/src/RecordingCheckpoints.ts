import type { SelectorQuery } from './types.js';
import { z } from 'zod';
import { selectorQuerySchema } from './wire-protocol.js';

/** Evidence source captured while reviewing a recording checkpoint. */
export type RecordingCheckpointEvidence = 'screenshot' | 'snapshot' | 'route' | 'runtime';

export interface RecordingCheckpointCandidate {
  id: string;
  position?: { x: number; y: number };
  query?: SelectorQuery;
  matcher: string;
  expected: unknown;
  source: RecordingCheckpointEvidence;
  reason?: string;
  confirmed: boolean;
  /** Zero-based action boundary; -1 means before the first action. Omitted means at the end. */
  afterOperationIndex?: number;
}

/** Shared CLI/IDE checkpoint input. Confirmation must always be explicit. */
export const recordingCheckpointSchema = z.object({
  id: z.string().min(1),
  position: z.object({ x: z.number().finite(), y: z.number().finite() }).strict().optional(),
  query: selectorQuerySchema.optional(),
  matcher: z.string().min(1),
  expected: z.unknown().optional(),
  source: z.enum(['screenshot', 'snapshot', 'route', 'runtime']),
  reason: z.string().optional(),
  confirmed: z.boolean().default(false),
  afterOperationIndex: z.number().int().min(-1).optional(),
}).strict();

export interface PreparedRecordingCheckpoints {
  candidates: RecordingCheckpointCandidate[];
  executable: RecordingCheckpointCandidate[];
  issues: string[];
}

/** Validate complete observed checkpoint data before counting or emitting an assertion. */
export function prepareRecordingCheckpoints(input: unknown, operationCount: number): PreparedRecordingCheckpoints {
  const result: PreparedRecordingCheckpoints = { candidates: [], executable: [], issues: [] };
  if (input === undefined) return result;
  if (!Array.isArray(input)) {
    result.issues.push('Recording checkpoints must be an array.');
    return result;
  }
  const ids = new Set<string>();
  for (let index = 0; index < input.length; index++) {
    const parsed = recordingCheckpointSchema.safeParse(input[index]);
    if (!parsed.success) {
      result.issues.push(`Invalid recording checkpoint ${index + 1}: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`);
      continue;
    }
    const candidate: RecordingCheckpointCandidate = { ...parsed.data, expected: parsed.data.expected };
    result.candidates.push(candidate);
    if (!candidate.confirmed) continue;
    const problems: string[] = [];
    if (ids.has(candidate.id)) problems.push('duplicate checkpoint id');
    ids.add(candidate.id);
    if (!candidate.query || !hasDurableQuery(candidate.query)) problems.push('missing durable target query');
    if (candidate.afterOperationIndex !== undefined && candidate.afterOperationIndex >= operationCount) {
      problems.push('action boundary is outside the recording');
    }
    if (candidate.matcher === 'toHaveText' || candidate.matcher === 'toContainText') {
      if (typeof candidate.expected !== 'string') problems.push('expected must be a string');
    } else if (['toBeVisible', 'toBeEnabled', 'toBeDisabled', 'toBeChecked'].includes(candidate.matcher)) {
      if (candidate.expected !== undefined && typeof candidate.expected !== 'boolean') problems.push('expected must be a boolean');
    } else {
      problems.push(`unsupported matcher '${candidate.matcher}'`);
    }
    if (problems.length) result.issues.push(`Checkpoint '${candidate.id}': ${problems.join('; ')}`);
    else result.executable.push(candidate);
  }
  return result;
}

function hasDurableQuery(query: SelectorQuery): boolean {
  if (query.position || query.match?.id) return false;
  for (const child of [query.within, query.containing, ...(query.and ?? []), ...(query.or ?? [])]) {
    if (child && !hasDurableQuery(child)) return false;
  }
  const match = query.match;
  return Boolean(match && [match.key, match.semanticIdentifier, match.name, match.text,
    match.textContains, match.semanticsLabel, match.tooltip, match.role].some(Boolean))
    || Boolean(query.within || query.containing || query.and?.length || query.or?.length);
}

export interface RecordingCheckpointConfirmation {
  id: string;
  matcher?: string;
  expected?: unknown;
  confirmed: boolean;
}

/** Create a reviewable candidate. Candidates are suggestions until confirmed. */
export function createRecordingCheckpointCandidate(
  input: Omit<RecordingCheckpointCandidate, 'confirmed'> & { confirmed?: boolean },
): RecordingCheckpointCandidate {
  return { ...input, confirmed: input.confirmed === true };
}

/** Apply an explicit human confirmation without inferring business meaning. */
export function confirmRecordingCheckpoint(
  candidate: RecordingCheckpointCandidate,
  confirmation: RecordingCheckpointConfirmation,
): RecordingCheckpointCandidate {
  if (candidate.id !== confirmation.id) {
    throw new Error(`Checkpoint confirmation '${confirmation.id}' does not match candidate '${candidate.id}'.`);
  }
  return {
    ...candidate,
    ...(confirmation.matcher !== undefined ? { matcher: confirmation.matcher } : {}),
    ...(confirmation.expected !== undefined ? { expected: confirmation.expected } : {}),
    confirmed: confirmation.confirmed,
  };
}

export function countConfirmedRecordingCheckpoints(
  candidates: readonly RecordingCheckpointCandidate[],
): number {
  return candidates.filter((candidate) => candidate.confirmed).length;
}
