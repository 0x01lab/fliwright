import {
  CloudError, workerTimelineBatchSchema, workerTimelineClockSchema, workerErrorMessage,
  type ExecutionAttempt, type WorkerTimelineClock, type WorkerTimelineEvent, type WorkerTimelineFinish,
  type WorkerTimelineSpan, type WorkerTimelineSummary, type WorkerTimelineView,
} from '@fliwright/cloud-protocol';
import type { CloudStore } from './CloudStore.js';

const maxEvents = 10000;
const maxBytes = 16 * 1024 * 1024;
type StoredEvent = WorkerTimelineEvent & { receivedAt: number };
const operationPhases: Record<string, string[]> = {
  clone: ['repository.checkout'], fetch: ['repository.checkout'], checkout: ['repository.checkout'], verify_sha: ['repository.checkout'],
  command: ['dependencies.install', 'device.reset.before', 'device.reset.after'],
  'publication.prepare': ['report.publish'], 'publication.commit': ['report.publish'],
};

function project(events: WorkerTimelineEvent[], terminal: boolean) {
  const spans = new Map<string, WorkerTimelineSpan>();
  const milestones: WorkerTimelineView['milestones'] = [];
  for (const event of events) {
    const p = event.payload;
    if (p.type === 'span.started') {
      if (spans.has(p.spanId)) throw new CloudError(409, 'Duplicate Worker span');
      const parent = p.parentSpanId ? spans.get(p.parentSpanId) : undefined;
      if (p.parentSpanId && (!parent || parent.status !== 'running' || parent.parentSpanId)) throw new CloudError(409, 'Invalid Worker parent span');
      const nativeAttemptChild = parent?.phase === 'native.attempt' && p.phase.startsWith('native.') && p.phase !== 'native.attempt';
      if ((p.operation && (!parent || parent.phase !== p.phase || !operationPhases[p.operation]?.includes(p.phase))) || (parent && !p.operation && !nativeAttemptChild))
        throw new CloudError(409, 'Invalid Worker operation');
      if (p.commandIndex !== undefined && p.operation !== 'command') throw new CloudError(409, 'Command index requires a command operation');
      spans.set(p.spanId, { id: p.spanId, parentSpanId: p.parentSpanId, phase: p.phase, attemptOrdinal: p.attemptOrdinal, operation: p.operation,
        commandIndex: p.commandIndex, status: 'running', startedAt: event.recordedAt, startMs: event.offsetMs, startSeq: event.seq });
    } else if (p.type === 'span.finished') {
      const span = spans.get(p.spanId);
      if (!span || span.status !== 'running') throw new CloudError(409, 'Worker span must start before finishing once');
      if ([...spans.values()].some(child => child.parentSpanId === span.id && child.status === 'running')) throw new CloudError(409, 'Worker parent has open children');
      if ((p.runId || p.testVerdict) && span.phase !== 'tests.run') throw new CloudError(409, 'Test result requires tests.run');
      Object.assign(span, { status: p.status, endedAt: event.recordedAt, endMs: event.offsetMs,
        durationMs: event.offsetMs - span.startMs, endSeq: event.seq, reason: p.reason, error: p.error,
        exitCode: p.exitCode, testVerdict: p.testVerdict, runId: p.runId });
    } else {
      if (p.spanId && !spans.has(p.spanId)) throw new CloudError(409, 'Worker milestone span missing');
      milestones.push({ seq: event.seq, offsetMs: event.offsetMs, recordedAt: event.recordedAt, name: p.name, spanId: p.spanId });
    }
  }
  if (terminal) for (const span of spans.values()) if (span.status === 'running') span.status = 'unknown';
  return { spans: [...spans.values()], milestones };
}

/** Owns lease-fenced Worker evidence, independently of immutable test bundles. */
export class WorkerTimelineStore {
  constructor(private readonly store: CloudStore) {}

  append(input: unknown): { ackSeq: number } {
    const batch = workerTimelineBatchSchema.parse(input);
    return this.store.transaction(() => {
      const attempt = this.store.owned(batch);
      const previous = attempt.workerTimeline;
      if (previous?.originAt && previous.originAt !== batch.originAt) throw new CloudError(409, 'Worker clock origin conflict');
      const existing = this.read(attempt.attemptId);
      const summary: WorkerTimelineSummary = previous ?? { originAt: batch.originAt, ackSeq: 0, revision: 0, quality: 'recording', lastOffsetMs: 0, lastProducedSeq: 0, issues: [] };
      summary.originAt = batch.originAt;
      let seq = summary.ackSeq;
      let lastOffset = existing.at(-1)?.offsetMs ?? 0;
      const fresh: WorkerTimelineEvent[] = [];
      for (const raw of batch.events) {
        const event: WorkerTimelineEvent = { ...raw, payload: raw.payload.type === 'span.finished' && raw.payload.error
          ? { ...raw.payload, error: { code: raw.payload.error.code, message: workerErrorMessage(raw.payload.error.code, raw.payload.error.message) } } : raw.payload };
        if (Math.abs(Date.parse(event.recordedAt) - (Date.parse(batch.originAt) + event.offsetMs)) > 1)
          throw new CloudError(409, 'Worker clock does not match origin');
        if (event.seq <= summary.ackSeq) {
          const old = existing[event.seq - 1];
          if (!old || JSON.stringify(this.withoutReceipt(old)) !== JSON.stringify(event)) throw new CloudError(409, 'Worker event conflict');
          continue;
        }
        if (event.seq !== seq + 1) throw new CloudError(409, `Worker sequence gap; expected ${seq + 1}`);
        if (event.offsetMs < lastOffset) throw new CloudError(409, 'Worker clock moved backwards');
        seq = event.seq; lastOffset = event.offsetMs; fresh.push(event);
      }
      if (!fresh.length) return { ackSeq: summary.ackSeq };
      const combined = [...existing.map(event => this.withoutReceipt(event)), ...fresh];
      if (combined.length > maxEvents || Buffer.byteLength(JSON.stringify(combined)) > maxBytes) throw new CloudError(413, 'Worker timeline capacity exceeded');
      project(combined, false);
      const insert = this.store.db.prepare('INSERT INTO worker_timeline_events(attempt_id,seq,received_at,data) VALUES(?,?,?,?)');
      for (const event of fresh) insert.run(attempt.attemptId, event.seq, this.store.now(), JSON.stringify(event));
      summary.ackSeq = seq; summary.lastProducedSeq = Math.max(summary.lastProducedSeq, seq);
      summary.lastOffsetMs = Math.max(summary.lastOffsetMs, lastOffset); summary.revision++;
      attempt.workerTimeline = summary;
      this.store.saveAttempt(attempt); this.changed(attempt);
      return { ackSeq: seq };
    });
  }

  clock(attempt: ExecutionAttempt, input?: WorkerTimelineClock) {
    if (!input) return;
    attempt.workerTimeline ??= { originAt: '', ackSeq: 0, revision: 0, quality: 'recording', lastOffsetMs: 0, lastProducedSeq: 0, issues: [] };
    const clock = workerTimelineClockSchema.parse(input), summary = attempt.workerTimeline;
    summary.lastOffsetMs = Math.max(summary.lastOffsetMs, clock.offsetMs);
    summary.lastProducedSeq = Math.max(summary.lastProducedSeq, clock.lastProducedSeq);
    summary.issues = [...new Set([...summary.issues, ...clock.issues])];
    if (summary.issues.length) summary.quality = 'partial';
    summary.revision++; this.changed(attempt);
  }

  finalize(attempt: ExecutionAttempt, input?: WorkerTimelineFinish, lost = false) {
    if (!attempt.workerTimeline) {
      if (!input) return;
      attempt.workerTimeline = { originAt: '', ackSeq: 0, revision: 0, quality: 'partial', lastOffsetMs: 0, lastProducedSeq: 0, issues: ['missing_events'] };
    }
    this.clock(attempt, input);
    const summary = attempt.workerTimeline;
    const open = project(this.read(attempt.attemptId), false).spans.some(span => span.status === 'running');
    if (open) summary.issues = [...new Set([...summary.issues, 'open_spans' as const])];
    if (lost || !input || summary.lastProducedSeq !== summary.ackSeq) summary.issues = [...new Set([...summary.issues, 'missing_events' as const])];
    summary.quality = summary.issues.length ? 'partial' : 'complete';
    if (input && !lost) summary.endedOffsetMs = Math.max(input.offsetMs, summary.lastOffsetMs);
    summary.revision++; this.changed(attempt);
  }

  view(requestId: string, executionAttemptId: string): WorkerTimelineView {
    const attempt = this.forRequest(requestId, executionAttemptId), summary = attempt.workerTimeline;
    const events = summary?.expiredAt ? [] : this.read(executionAttemptId);
    const publication = attempt.bundleId ? this.store.db.prepare("SELECT data FROM publications WHERE id=? AND state='published'").get(attempt.bundleId) : undefined;
    const report = publication ? JSON.parse(String(publication.data)) as { input: { runId: string } } : undefined;
    return {
      schemaVersion: 1, requestId, executionAttemptId, workerId: attempt.workerId, slotId: attempt.slotId, deviceId: attempt.deviceId ?? '',
      executionStatus: attempt.stage === 'lost' ? 'lost' : attempt.finishedAt !== undefined ? 'finished' : 'running',
      testVerdict: attempt.outcome?.verdict ?? attempt.result?.verdict ?? 'unknown', outcome: attempt.outcome,
      quality: summary?.quality ?? 'not_recorded', issues: summary?.issues ?? [], revision: summary?.revision ?? 0, cursor: summary?.ackSeq ?? 0,
      originAt: summary?.originAt || undefined, assignedAt: attempt.assignedAt, finishedAt: attempt.finishedAt,
      lastReceivedAt: events.at(-1)?.receivedAt, expiredAt: summary?.expiredAt, observedOffsetMs: summary?.lastOffsetMs ?? 0,
      ...project(events, attempt.finishedAt !== undefined),
      report: report && attempt.bundleId ? { bundleId: attempt.bundleId, runId: report.input.runId } : undefined,
    };
  }

  events(requestId: string, executionAttemptId: string, after: number, limit = 200) {
    const attempt = this.forRequest(requestId, executionAttemptId);
    if (!Number.isSafeInteger(after) || after < 0 || !Number.isInteger(limit) || limit < 1 || limit > 500) throw new CloudError(400, 'Invalid Worker timeline cursor');
    const events = this.read(executionAttemptId, after, limit);
    const nextSeq = events.at(-1)?.seq ?? after;
    return { events, nextSeq, hasMore: !attempt.workerTimeline?.expiredAt && nextSeq < (attempt.workerTimeline?.ackSeq ?? 0), expired: !!attempt.workerTimeline?.expiredAt };
  }

  logs(requestId: string, executionAttemptId: string, spanId?: string) {
    const view = this.view(requestId, executionAttemptId);
    if (view.expiredAt) return { logs: [], association: 'concurrent' };
    const span = spanId ? view.spans.find(s => s.id === spanId) : undefined;
    if (spanId && !span) throw new CloudError(404, 'Worker span not found');
    const rows = this.store.db.prepare("SELECT seq,at,data FROM events WHERE request_id=? AND kind='log' AND json_extract(data,'$.attemptId')=? AND (? IS NULL OR json_extract(data,'$.offsetMs')>=?) AND (? IS NULL OR json_extract(data,'$.offsetMs')<=?) ORDER BY seq DESC LIMIT 100")
      .all(requestId, executionAttemptId, span?.startMs ?? null, span?.startMs ?? null, span?.endMs ?? null, span?.endMs ?? null);
    return { logs: rows.reverse().map(row => ({ seq: Number(row.seq), at: Number(row.at), text: String(JSON.parse(String(row.data)).text) })), association: 'concurrent' };
  }

  sweep(retentionDays = 30) {
    this.store.transaction(() => {
      const attempts = this.store.db.prepare("SELECT data FROM attempts WHERE json_extract(data,'$.finishedAt')<=? AND json_extract(data,'$.workerTimeline') IS NOT NULL AND json_extract(data,'$.workerTimeline.expiredAt') IS NULL LIMIT 100")
        .all(this.store.now() - retentionDays * 86400000);
      for (const row of attempts) {
        const attempt = JSON.parse(String(row.data)) as ExecutionAttempt;
        this.store.db.prepare('DELETE FROM worker_timeline_events WHERE attempt_id=?').run(attempt.attemptId);
        attempt.workerTimeline!.expiredAt = this.store.now(); attempt.workerTimeline!.revision++;
        this.store.saveAttempt(attempt); this.changed(attempt);
      }
    });
  }

  private forRequest(requestId: string, id: string) {
    const attempt = this.store.attempt(id);
    if (attempt.requestId !== requestId) throw new CloudError(404, 'Execution attempt outside request');
    return attempt;
  }
  private read(id: string, after = 0, limit = maxEvents): StoredEvent[] {
    return this.store.db.prepare('SELECT received_at,data FROM worker_timeline_events WHERE attempt_id=? AND seq>? ORDER BY seq LIMIT ?')
      .all(id, after, limit).map(row => ({ ...JSON.parse(String(row.data)), receivedAt: Number(row.received_at) }));
  }
  private withoutReceipt({ receivedAt: _receivedAt, ...event }: StoredEvent): WorkerTimelineEvent { return event; }
  private changed(attempt: ExecutionAttempt) {
    this.store.event(attempt.requestId, 'worker-timeline-updated', { executionAttemptId: attempt.attemptId, revision: attempt.workerTimeline?.revision ?? 0 });
  }
}
