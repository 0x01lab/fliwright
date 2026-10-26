import { openSync, closeSync, fsyncSync, writeSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  workerTimelineEventSchema, workerErrorMessages,
  type LeaseKey, type WorkerTimelineBatch, type WorkerTimelineClock, type WorkerTimelineEvent,
  type WorkerTimelinePayload, type WorkerRecordingIssue, type WorkerStopReason,
} from '@fliwright/cloud-protocol';
import { WorkerTimelineChannel } from './WorkerTimelineChannel.js';

type Options = {
  originAt?: string; now?: () => number;
  send?: (batch: WorkerTimelineBatch, signal: AbortSignal) => Promise<{ ackSeq: number }>;
  timeoutMs?: number;
};
/** The supervisor alone assigns sequence numbers and persists sanitized events before ACK. */
export class WorkerTimelineRecorder {
  readonly channel: WorkerTimelineChannel;
  readonly originAt: string;
  private readonly now: () => number;
  private readonly origin: number;
  private fd?: number;
  private events: WorkerTimelineEvent[] = [];
  private active = new Map<string, { source: string; payload: Extract<WorkerTimelinePayload, { type: 'span.started' }> }>();
  private issues = new Set<WorkerRecordingIssue>();
  private ackSeq = 0;
  private lastOffset = 0;
  private bytes = 0;
  private sending?: Promise<void>;
  private stopped = false;
  private disabled = false;
  private sendController?: AbortController;
  private stopReason?: WorkerStopReason;
  constructor(directory: string, private readonly key: LeaseKey, private readonly options: Options = {}) {
    this.now = options.now ?? (() => performance.now()); this.origin = this.now();
    this.originAt = options.originAt ?? new Date().toISOString();
    try { this.fd = openSync(join(directory, 'worker-timeline.jsonl'), 'ax', 0o600); }
    catch { this.issue('storage_error'); this.disabled = true; }
    this.channel = new WorkerTimelineChannel(async payload => this.record(payload, 'supervisor'));
  }

  record(input: WorkerTimelinePayload, source = 'executor'): boolean {
    if (this.disabled) return false;
    try {
      let payload = input.type === 'span.finished' && input.error
        ? { ...input, error: { code: input.error.code, message: workerErrorMessages[input.error.code] } } : input;
      if (payload.type === 'span.finished' && payload.status === 'interrupted' && source === 'executor' && this.stopReason)
        payload = { ...payload, reason: this.stopReason };
      if (payload.type === 'span.started' && payload.parentSpanId && !this.active.has(payload.parentSpanId)) return false;
      if (payload.type === 'span.finished' && !this.active.has(payload.spanId)) return false;
      if (payload.type === 'span.finished' && [...this.active.values()].some(span => span.payload.parentSpanId === payload.spanId)) {
        this.issue('open_spans'); return false;
      }
      if (this.events.length >= 8000 && payload.type === 'span.started' && payload.parentSpanId) { this.issue('capacity'); return false; }
      const offsetMs = this.offset();
      const event = workerTimelineEventSchema.parse({ schemaVersion: 1, seq: this.events.length + 1, recordedAt: new Date(Date.parse(this.originAt) + offsetMs).toISOString(), offsetMs, payload });
      const data = Buffer.from(JSON.stringify(event) + '\n');
      if (this.events.length >= 10000 || this.bytes + data.length > 16 * 1024 * 1024) { this.issue('capacity'); this.disabled = true; return false; }
      if (this.fd === undefined) return false;
      let written = 0;
      while (written < data.length) written += writeSync(this.fd, data, written, data.length - written);
      fsyncSync(this.fd);
      this.events.push(event); this.bytes += data.length;
      if (payload.type === 'span.started') this.active.set(payload.spanId, { source, payload });
      if (payload.type === 'span.finished') this.active.delete(payload.spanId);
      queueMicrotask(() => { void this.flush(); });
      return true;
    } catch { this.issue('storage_error'); this.disabled = true; return false; }
  }

  interrupt(source: string, reason: WorkerStopReason) {
    for (const [spanId, span] of [...this.active].reverse())
      if (span.source === source) this.record({ type: 'span.finished', spanId, status: 'interrupted', reason }, source);
  }
  issue(issue: WorkerRecordingIssue) { this.issues.add(issue); }
  stopping(reason: WorkerStopReason) { this.stopReason = reason; }
  clock(): WorkerTimelineClock { return { offsetMs: this.offset(), lastProducedSeq: this.events.length, issues: [...this.issues] }; }
  summary(): WorkerTimelineClock {
    const issues = new Set(this.issues);
    if (this.ackSeq < this.events.length) issues.add('delivery_error');
    if (this.active.size) issues.add('open_spans');
    return { offsetMs: this.offset(), lastProducedSeq: this.events.length, issues: [...issues] };
  }
  flush(): Promise<void> {
    if (this.sending) return this.sending;
    if (!this.options.send || this.stopped || this.ackSeq >= this.events.length) return Promise.resolve();
    this.sending = this.sendPending().finally(() => { this.sending = undefined; });
    return this.sending;
  }
  stopSending() { this.stopped = true; this.sendController?.abort(); }
  close() {
    this.stopSending();
    if (this.fd !== undefined) { try { closeSync(this.fd); } catch { this.issue('storage_error'); } this.fd = undefined; }
    this.disabled = true;
  }
  private offset() { this.lastOffset = Math.max(this.lastOffset, Math.floor(this.now() - this.origin)); return this.lastOffset; }
  private async sendPending() {
    const deadline = performance.now() + (this.options.timeoutMs ?? 2000);
    while (!this.stopped && this.ackSeq < this.events.length) {
      const remaining = deadline - performance.now();
      if (remaining <= 0) return;
      const events = this.events.slice(this.ackSeq, this.ackSeq + 64);
      const { workerId, slotId, attemptId, generation } = this.key;
      const batch: WorkerTimelineBatch = { workerId, slotId, attemptId, generation, originAt: this.originAt, events };
      const controller = new AbortController(); this.sendController = controller;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const reply = await Promise.race([
          this.options.send!(batch, controller.signal),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => { controller.abort(); reject(new Error('Worker timeline flush timed out')); }, remaining);
          }),
        ]);
        if (reply.ackSeq !== events.at(-1)!.seq) return;
        this.ackSeq = reply.ackSeq;
      } catch { return; }
      finally { if (timer) clearTimeout(timer); this.sendController = undefined; }
    }
  }
}

/** Diagnostics read only complete records; a partial final write never becomes evidence. */
export function readWorkerTimelineLog(path: string): { events: WorkerTimelineEvent[]; issues: WorkerRecordingIssue[] } {
  const events: WorkerTimelineEvent[] = [];
  try {
    const body = readFileSync(path, 'utf8');
    if (Buffer.byteLength(body) > 16 * 1024 * 1024) return { events, issues: ['capacity'] };
    const lines = body.split('\n'), tail = lines.pop();
    for (const line of lines) events.push(workerTimelineEventSchema.parse(JSON.parse(line)));
    return { events, issues: tail ? ['truncated'] : [] };
  } catch { return { events, issues: ['truncated'] }; }
}
