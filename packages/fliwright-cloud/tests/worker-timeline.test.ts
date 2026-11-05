import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CloudStore } from '../src/CloudStore.js';
import type { WorkerTimelineEvent, WorkerTimelineFinish } from '@fliwright/cloud-protocol';

const clean: Array<() => void> = [];
afterEach(() => { for (const fn of clean.splice(0).reverse()) fn(); });
const originAt = '2026-10-21T00:00:00.000Z';
function event(seq: number, offsetMs: number, payload: WorkerTimelineEvent['payload']): WorkerTimelineEvent {
  return { schemaVersion: 1, seq, offsetMs, recordedAt: new Date(Date.parse(originAt) + offsetMs).toISOString(), payload };
}
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'worker-timeline-'));
  clean.push(() => rmSync(root, { recursive: true, force: true }));
  let now = 1000;
  const store = new CloudStore(join(root, 'db'), () => now);
  clean.push(() => store.close());
  store.configure([{ id: 'app', name: 'App', repository: '/app', suites: { smoke: '*.test.ts' }, scenarios: ['clean'] }],
    [{ id: 'mac', slots: [{ id: 'ios', deviceId: 'device', targets: ['app'] }] }]);
  store.recordDeviceInventory('mac', { scannedAt: originAt, devices: [{ id: 'device', name: 'Phone', platform: 'ios', kind: 'physical', state: 'online' }], diagnostics: [] });
  const request = store.submit({ targetId: 'app', commit: 'a'.repeat(40), suite: 'smoke', scenario: 'clean' }, 'alice', 'key');
  const lease = store.claim('mac', 'ios', 'device')!;
  const start = event(1, 0, { type: 'span.started', spanId: 'launch', phase: 'app.launch' });
  const end = event(2, 120, { type: 'span.finished', spanId: 'launch', status: 'failed', error: { code: 'launch_failed', message: 'secret ws://private/token' } });
  const append = (events: WorkerTimelineEvent[], key = lease) => store.workerTimelines.append({ workerId: key.workerId, slotId: key.slotId, attemptId: key.attemptId, generation: key.generation, originAt, events });
  return { store, lease, request, root, start, end, append, advance: (ms: number) => { now += ms; } };
}

it('records startup failure without a test report, durably and idempotently', () => {
  const { store, lease, request, append, start, end, root } = setup();
  expect(append([start, end])).toEqual({ ackSeq: 2 });
  expect(append([start, end])).toEqual({ ackSeq: 2 });
  const view = store.workerTimelines.view(request.id, lease.attemptId);
  expect(view).toMatchObject({ quality: 'recording', cursor: 2, spans: [{ phase: 'app.launch', status: 'failed', durationMs: 120 }] });
  expect(JSON.stringify(view)).not.toContain('private/token');
  const reopened = new CloudStore(join(root, 'db'));
  try { expect(reopened.workerTimelines.view(request.id, lease.attemptId).spans).toEqual(view.spans); } finally { reopened.close(); }
});

it('projects a native attempt group and its owner phases in order', () => {
  const { store, lease, request, append } = setup();
  append([
    { ...event(1, 0, { type: 'span.started', spanId: 'attempt-1', phase: 'native.attempt', attemptOrdinal: 1 }), schemaVersion: 2 },
    { ...event(2, 2, { type: 'span.started', spanId: 'launch-1', parentSpanId: 'attempt-1', phase: 'native.launch' }), schemaVersion: 2 },
    { ...event(3, 42, { type: 'span.finished', spanId: 'launch-1', status: 'succeeded' }), schemaVersion: 2 },
    { ...event(4, 45, { type: 'span.finished', spanId: 'attempt-1', status: 'succeeded' }), schemaVersion: 2 },
  ]);
  expect(store.workerTimelines.view(request.id, lease.attemptId).spans).toMatchObject([
    { phase: 'native.attempt', attemptOrdinal: 1, status: 'succeeded' },
    { phase: 'native.launch', parentSpanId: 'attempt-1', status: 'succeeded', durationMs: 40 },
  ]);
});

it('preserves allowlisted protocol version diagnostics without accepting arbitrary error text', () => {
  const { store, lease, request, append, start, end } = setup();
  const message = 'Bridge protocol incompatible (client=2, bridge=1)';
  append([start, { ...end, payload: { type: 'span.finished', spanId: 'launch', status: 'failed', error: { code: 'verification_failed', message } } }]);
  expect(store.workerTimelines.view(request.id, lease.attemptId).spans[0].error?.message).toBe(message);
});

it('rejects gaps, conflicts, invalid nesting, different clocks and stale ownership atomically', () => {
  const { store, lease, request, append, start, end, advance } = setup();
  expect(() => append([end])).toThrow(/sequence/i);
  append([start]);
  expect(() => append([{ ...start, offsetMs: 1 }])).toThrow();
  expect(() => append([event(2, 1, { type: 'span.started', spanId: 'child', parentSpanId: 'missing', phase: 'app.launch', operation: 'command' })])).toThrow(/parent|operation/i);
  expect(() => append([{ ...end, recordedAt: originAt }])).toThrow(/clock/i);
  expect(() => append([end], { ...lease, generation: 2 })).toThrow(/lease/i);
  expect(store.workerTimelines.view(request.id, lease.attemptId).cursor).toBe(1);
  advance(31000); store.expireLeases();
  expect(() => append([end])).toThrow(/lease/i);
  expect(store.workerTimelines.view(request.id, lease.attemptId)).toMatchObject({ executionStatus: 'lost', quality: 'partial', spans: [{ status: 'unknown' }] });
  expect(store.workerTimelines.view(request.id, lease.attemptId).spans[0].durationMs).toBeUndefined();
});

it('separates runner completion, test verdict and timeline completeness when cleanup fails', () => {
  const { store, lease, request, append } = setup();
  append([
    event(1, 0, { type: 'span.started', spanId: 'test', phase: 'tests.run' }),
    event(2, 30, { type: 'span.finished', spanId: 'test', status: 'succeeded', testVerdict: 'failed', runId: 'run' }),
    event(3, 31, { type: 'span.started', spanId: 'reset', phase: 'device.reset.after' }),
    event(4, 35, { type: 'span.finished', spanId: 'reset', status: 'failed' }),
  ]);
  const summary: WorkerTimelineFinish = { lastProducedSeq: 4, offsetMs: 35, issues: [] };
  store.finish(lease, { verdict: 'failed', publication: 'unavailable', cleanup: 'failed' }, summary);
  expect(store.workerTimelines.view(request.id, lease.attemptId)).toMatchObject({
    executionStatus: 'finished', testVerdict: 'failed', quality: 'complete',
    spans: [{ status: 'succeeded', testVerdict: 'failed' }, { status: 'failed' }],
  });
  expect(store.slot('mac', 'ios')?.state).toBe('quarantined');
});

it('expires finished timeline details independently of reports and preserves its summary', () => {
  const { store, lease, request, append, start, end, advance } = setup();
  append([start, end]);
  store.finish(lease, { verdict: 'unknown', publication: 'unavailable', cleanup: 'clean' }, { lastProducedSeq: 2, offsetMs: 120, issues: [] });
  advance(31 * 86400000); store.workerTimelines.sweep();
  expect(store.workerTimelines.view(request.id, lease.attemptId)).toMatchObject({ quality: 'complete', cursor: 2, spans: [], expiredAt: expect.any(Number) });
  expect(store.workerTimelines.events(request.id, lease.attemptId, 0)).toMatchObject({ events: [], expired: true });
});

it('records degradation before the first event arrives and still accepts a delayed first batch', () => {
  const { store, lease, request, append, start, end } = setup();
  store.heartbeat(lease, 'launch', undefined, { offsetMs: 20, lastProducedSeq: 2, issues: ['ipc_timeout'] });
  expect(store.workerTimelines.view(request.id, lease.attemptId)).toMatchObject({ quality: 'partial', issues: ['ipc_timeout'], observedOffsetMs: 20 });
  expect(append([start, end])).toEqual({ ackSeq: 2 });
  store.finish(lease, { verdict: 'unknown', publication: 'unavailable', cleanup: 'clean' }, { lastProducedSeq: 2, offsetMs: 120, issues: [] });
  expect(store.workerTimelines.view(request.id, lease.attemptId).quality).toBe('partial');
});

it('reads phase logs from durable execution-scoped evidence beyond the browser event window', () => {
  const { store, lease, request, append, start, end } = setup();
  append([start, end]);
  store.heartbeat(lease, 'launch', 'during-launch', { offsetMs: 50, lastProducedSeq: 2, issues: [] });
  store.heartbeat(lease, 'launch', 'after-launch', { offsetMs: 150, lastProducedSeq: 2, issues: [] });
  for (let i = 0; i < 600; i++) store.event(request.id, 'unrelated', {});
  expect(store.workerTimelines.logs(request.id, lease.attemptId, 'launch')).toMatchObject({ logs: [{ text: 'during-launch' }], association: 'concurrent' });
  expect(() => store.workerTimelines.logs(request.id, lease.attemptId, 'outside')).toThrow();
});

it('paginates complete durable evidence beyond 500 notices without mixing execution identities', () => {
  const { store, lease, request, append, start } = setup();
  append([start]);
  const events = Array.from({ length: 600 }, (_, i) => event(i + 2, i + 1, { type: 'milestone', spanId: 'launch', name: 'vm.endpoint_observed' }));
  for (let i = 0; i < events.length; i += 64) append(events.slice(i, i + 64));
  append([event(602, 601, { type: 'span.finished', spanId: 'launch', status: 'succeeded' })]);
  const first = store.workerTimelines.events(request.id, lease.attemptId, 0, 500);
  expect(first).toMatchObject({ nextSeq: 500, hasMore: true });
  const rest = store.workerTimelines.events(request.id, lease.attemptId, first.nextSeq, 500);
  expect(rest).toMatchObject({ nextSeq: 602, hasMore: false });
  expect(first.events.length + rest.events.length).toBe(602);
  expect(store.workerTimelines.view(request.id, lease.attemptId).milestones).toHaveLength(600);
});
