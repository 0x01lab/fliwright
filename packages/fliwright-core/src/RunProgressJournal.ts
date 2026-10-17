import { z } from 'zod';
import { evidenceStatusSchema, runStatusSchema } from './RunContracts.js';
import type { ReadEventsResult, RunArtifactStore } from './RunArtifactStore.js';
import type { RunSessionOperation, RunSessionResult } from './RunSession.js';
import type { TimelineData, TimelineNode } from './timeline/types.js';
import { parseTimelineData } from './timeline/TimelineReader.js';

type ResultHeader = Omit<RunSessionResult, 'operations' | 'evidence'>;
type TimelineHeader = Omit<TimelineData, 'nodes'>;

export interface RunProgressEvent {
  version: 1;
  kind: 'progress';
  sequence: number;
  runId: string;
  testId: string;
  attemptId: string;
  result: ResultHeader;
  operations: RunSessionOperation[];
  evidence: Array<{ index: number; value: RunSessionResult['evidence'][number] }>;
  timeline?: TimelineHeader;
  nodes: TimelineNode[];
  finalized: boolean;
}

const resultHeaderSchema = z.object({
  runId: z.string(), testId: z.string(), testName: z.string(), attemptId: z.string().optional(),
  status: runStatusSchema, attemptOutcome: runStatusSchema, testOutcome: runStatusSchema,
  expectedFailure: z.boolean(), flaky: z.boolean(), evidenceStatus: evidenceStatusSchema,
}).passthrough();
const operationSchema = z.object({
  operationId: z.string(), kind: z.enum(['action', 'assertion', 'step', 'raw']), title: z.string(),
  outcome: runStatusSchema, startedAt: z.string(),
}).passthrough();
const evidenceSchema = z.object({
  kind: z.enum(['screenshot', 'snapshot', 'diagnostics']), reason: z.enum(['start', 'finish', 'failure', 'explicit']),
  result: z.object({ status: z.enum(['captured', 'unavailable', 'timeout', 'disabled']),
    artifactPaths: z.array(z.string()).optional(),
  }).passthrough(),
}).passthrough();
const timelineHeaderSchema = z.custom<TimelineHeader>((value) => (
  typeof value === 'object' && value !== null
  && parseTimelineData(JSON.stringify({ ...value, nodes: [] })) !== undefined
));
const nodeSchema = z.object({
  id: z.string(), kind: z.enum(['script', 'page', 'frame', 'manual', 'step', 'branch', 'optional', 'assertion', 'action', 'mock', 'ai-call', 'failure']),
  title: z.string(), status: runStatusSchema, startedAt: z.string(),
}).passthrough();
const progressSchema = z.object({
  version: z.literal(1), kind: z.literal('progress'), sequence: z.number().int().positive().safe(),
  runId: z.string(), testId: z.string(), attemptId: z.string(),
  result: resultHeaderSchema,
  operations: z.array(operationSchema),
  evidence: z.array(z.object({ index: z.number().int().nonnegative().safe(), value: evidenceSchema })),
  timeline: timelineHeaderSchema.optional(), nodes: z.array(nodeSchema),
  finalized: z.boolean(),
});

/** Append changed facts after their binary evidence exists; never embed binary data in the journal. */
export class RunProgressJournal {
  private sequence = 0;
  private readonly operations = new Map<string, string>();
  private readonly nodes = new Map<string, string>();
  private evidenceCount = 0;
  private pending: Promise<void> = Promise.resolve();

  constructor(private readonly store: RunArtifactStore, private readonly testId: string, private readonly attemptId: string) {}

  /** Serializes concurrent callers and snapshots mutable data at the call boundary. */
  append(result: RunSessionResult, timeline?: TimelineData, finalized = false, options: { signal?: AbortSignal } = {}): Promise<void> {
    const snapshot = JSON.parse(JSON.stringify({ result, timeline })) as { result: RunSessionResult; timeline?: TimelineData };
    const write = this.pending.then(() => this.write(snapshot.result, snapshot.timeline, finalized, options.signal));
    this.pending = write.catch(() => {});
    return write;
  }

  private async write(result: RunSessionResult, timeline: TimelineData | undefined, finalized: boolean, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    if (result.testId !== this.testId || (result.attemptId && result.attemptId !== this.attemptId)) {
      throw new Error('Progress journal attempt identity mismatch.');
    }
    const { operations, evidence, ...header } = result;
    const { nodes = [], ...timelineHeader } = timeline ?? {};
    const changedOperations = operations.filter((operation) => this.operations.get(operation.operationId) !== JSON.stringify(operation));
    const changedNodes = nodes.filter((node) => this.nodes.get(node.id) !== JSON.stringify(node));
    const event: RunProgressEvent = {
      version: 1, kind: 'progress', sequence: this.sequence + 1,
      runId: result.runId, testId: this.testId, attemptId: this.attemptId,
      result: header, operations: changedOperations,
      evidence: evidence.slice(this.evidenceCount).map((value, index) => ({ index: this.evidenceCount + index, value })),
      ...(timeline ? { timeline: timelineHeader as TimelineHeader } : {}), nodes: changedNodes, finalized,
    };
    await this.store.appendEvent(this.testId, this.attemptId, event, { signal });
    this.sequence = event.sequence;
    for (const operation of changedOperations) this.operations.set(operation.operationId, JSON.stringify(operation));
    for (const node of changedNodes) this.nodes.set(node.id, JSON.stringify(node));
    this.evidenceCount = evidence.length;
  }
}

export interface RecoveredRunProgress {
  result?: RunSessionResult;
  timeline?: TimelineData;
  issues: string[];
  finalized: boolean;
}

/** Replay valid journal deltas while retaining diagnostics for every gap or corrupt line. */
export function recoverRunProgress(
  log: ReadEventsResult,
  identity: { runId: string; testId: string; attemptId: string },
): RecoveredRunProgress {
  const issues = log.corruptLines.map((line) => `Progress journal corrupt line ${line}.`);
  if (log.incompleteTrailingLine) issues.push('Progress journal has an incomplete trailing line.');
  const operations = new Map<string, RunSessionOperation>();
  const nodes = new Map<string, TimelineNode>();
  const evidence = new Map<number, RunSessionResult['evidence'][number]>();
  let header: ResultHeader | undefined;
  let timelineHeader: TimelineHeader | undefined;
  let sequence = 0;
  let finalized = false;
  for (const [index, value] of log.events.entries()) {
    const parsed = progressSchema.safeParse(value);
    if (!parsed.success) { issues.push(`Progress journal invalid event ${index + 1}.`); continue; }
    const event = parsed.data as RunProgressEvent;
    if (event.runId !== identity.runId || event.testId !== identity.testId || event.attemptId !== identity.attemptId
      || event.result.runId !== identity.runId || event.result.testId !== identity.testId
      || (event.result.attemptId !== undefined && event.result.attemptId !== identity.attemptId)
      || (event.timeline !== undefined && event.timeline.runId !== identity.runId)) {
      issues.push(`Progress journal identity mismatch at sequence ${event.sequence}.`);
      continue;
    }
    if (event.sequence <= sequence) {
      issues.push(`Progress journal out-of-order sequence ${event.sequence}.`);
      continue;
    }
    if (event.sequence !== sequence + 1) issues.push(`Progress journal missing sequence ${sequence + 1} before ${event.sequence}.`);
    sequence = event.sequence;
    header = event.result;
    finalized = event.finalized;
    for (const operation of event.operations) operations.set(operation.operationId, operation);
    for (const node of event.nodes) nodes.set(node.id, node);
    for (const item of event.evidence) evidence.set(item.index, item.value);
    if (event.timeline) timelineHeader = event.timeline;
  }
  return {
    ...(header ? { result: { ...header, operations: [...operations.values()],
      evidence: [...evidence.entries()].sort(([a], [b]) => a - b).map(([, value]) => value) } } : {}),
    ...(timelineHeader ? { timeline: { ...timelineHeader, nodes: [...nodes.values()] } } : {}),
    issues, finalized,
  };
}
