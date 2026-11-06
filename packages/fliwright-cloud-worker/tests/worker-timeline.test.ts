import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { workerTimelineBatchSchema, type WorkerTimelineBatch } from '@fliwright/cloud-protocol';
import { WorkerTimelineRecorder, readWorkerTimelineLog } from '../src/WorkerTimelineRecorder.js';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
function setup(send?: (batch: WorkerTimelineBatch) => Promise<{ ackSeq: number }>) {
  const root = mkdtempSync(join(tmpdir(), 'worker-recording-')); roots.push(root);
  let clock = 100;
  const recorder = new WorkerTimelineRecorder(root, { workerId: 'mac', slotId: 'ios', attemptId: 'attempt', generation: 1 }, {
    originAt: '2026-10-21T00:00:00.000Z', now: () => clock, send,
  });
  return { root, recorder, advance: () => { clock += 25; } };
}

it('persists events before acknowledging operations and records monotonic duration and safe errors', async () => {
  const batches: WorkerTimelineBatch[] = [];
  const { root, recorder, advance } = setup(async batch => { batches.push(batch); return { ackSeq: batch.events.at(-1)!.seq }; });
  const span = await recorder.channel.startSpan('app.launch');
  expect(readWorkerTimelineLog(join(root, 'worker-timeline.jsonl')).events).toHaveLength(1);
  advance();
  await recorder.channel.finishSpan(span, 'failed', { error: { code: 'launch_failed', message: 'secret ws://private/token' } });
  await recorder.flush();
  expect(recorder.summary()).toMatchObject({ lastProducedSeq: 2, offsetMs: 25, issues: [] });
  expect(readFileSync(join(root, 'worker-timeline.jsonl'), 'utf8')).not.toContain('private/token');
  expect(batches.flatMap(batch => batch.events).at(-1)).toMatchObject({ offsetMs: 25, payload: { status: 'failed' } });
  recorder.close();
});

it('keeps a protocol diagnosis through durable recording and upload', async () => {
  const { root, recorder } = setup();
  const error = Object.assign(new Error('protocol mismatch'), { workerDiagnostic: 'Bridge protocol incompatible (client=2, bridge=1)' });
  await expect(recorder.channel.run('app.verify', async () => { throw error; })).rejects.toBe(error);
  expect(readFileSync(join(root, 'worker-timeline.jsonl'), 'utf8')).toContain('Bridge protocol incompatible (client=2, bridge=1)');
  recorder.close();
});

it('keeps an unacknowledged tail and never blocks business work when delivery fails', async () => {
  const { recorder, root } = setup(async () => { throw new Error('offline'); });
  expect(await recorder.channel.run('tests.run', async () => 42)).toBe(42);
  await recorder.flush();
  expect(recorder.summary().issues).toContain('delivery_error');
  expect(readWorkerTimelineLog(join(root, 'worker-timeline.jsonl')).events).toHaveLength(2);
  recorder.close();
});

it('retains complete records from a truncated log and marks it incomplete', async () => {
  const { root, recorder } = setup();
  await recorder.channel.startSpan('app.launch'); recorder.close();
  const file = join(root, 'worker-timeline.jsonl');
  writeFileSync(file, readFileSync(file, 'utf8') + '{"seq":2');
  expect(readWorkerTimelineLog(file)).toMatchObject({ events: [expect.objectContaining({ seq: 1 })], issues: ['truncated'] });
});

it('uploads only the fenced key when constructed with a full execution lease', async () => {
  const root = mkdtempSync(join(tmpdir(), 'worker-lease-')); roots.push(root);
  let accepted = 0;
  const lease = { workerId: 'mac', slotId: 'ios', attemptId: 'attempt', generation: 1, deviceId: 'phone', request: {}, expiresAt: 100 };
  const recorder = new WorkerTimelineRecorder(root, lease, { send: async batch => {
    workerTimelineBatchSchema.parse(batch);
    accepted += batch.events.length;
    return { ackSeq: batch.events.at(-1)!.seq };
  } });
  await recorder.channel.run('execution.prepare', async () => {});
  await recorder.flush();
  expect(accepted).toBe(2);
  expect(recorder.summary().issues).toEqual([]);
  recorder.close();
});

it('runs child work without emitting orphan spans when the parent was not recorded', async () => {
  const { recorder, root } = setup();
  expect(await recorder.channel.run('repository.checkout', async () => 42, { operation: 'clone' })).toBe(42);
  expect(readWorkerTimelineLog(join(root, 'worker-timeline.jsonl')).events).toEqual([]);
  recorder.close();
});

it('keeps the stream valid when a child acknowledgement was lost before the parent closes', async () => {
  const { recorder, root } = setup();
  const parent = await recorder.channel.startSpan('repository.checkout');
  await recorder.channel.startSpan('repository.checkout', { parentSpanId: parent, operation: 'clone' });
  await recorder.channel.finishSpan(parent, 'failed');
  expect(readWorkerTimelineLog(join(root, 'worker-timeline.jsonl')).events).toHaveLength(2);
  recorder.interrupt('supervisor', 'process_exit');
  expect(recorder.summary().issues).toContain('open_spans');
  recorder.close();
});

it('preserves business work and reports partial recording if the local spool cannot be opened', async () => {
  const { root, recorder } = setup(); recorder.close();
  const broken = new WorkerTimelineRecorder(join(root, 'missing'), { workerId: 'mac', slotId: 'ios', attemptId: 'attempt', generation: 1 });
  expect(await broken.channel.run('app.launch', async () => 42)).toBe(42);
  expect(broken.summary()).toMatchObject({ lastProducedSeq: 0, issues: ['storage_error'] });
  broken.close();
});
