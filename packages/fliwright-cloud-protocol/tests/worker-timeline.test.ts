import { expect, it } from 'vitest';
import { workerTimelineBatchSchema, workerTimelineEventSchema } from '../src/worker-timeline.js';

const event = {
  schemaVersion: 1,
  seq: 1,
  recordedAt: '2026-10-21T00:00:00.000Z',
  offsetMs: 0,
  payload: { type: 'span.started', spanId: 'launch', phase: 'app.launch' },
};

it('accepts a separate Worker event contract without accepting test nodes or arbitrary metadata', () => {
  expect(workerTimelineEventSchema.parse(event)).toEqual(event);
  for (const payload of [
    { type: 'step', title: 'tap' },
    { ...event.payload, phase: 'arbitrary-command' },
    { ...event.payload, vmUrl: 'ws://private/secret' },
  ]) expect(workerTimelineEventSchema.safeParse({ ...event, payload }).success).toBe(false);
  expect(workerTimelineEventSchema.safeParse({ ...event, offsetMs: -1 }).success).toBe(false);
});

it('accepts versioned native attempt groups while retaining version 1 compatibility', () => {
  const attempt = { ...event, schemaVersion: 2, payload: {
    type: 'span.started', spanId: 'native-attempt-1', phase: 'native.attempt', attemptOrdinal: 1,
  } };
  expect(workerTimelineEventSchema.parse(attempt)).toEqual(attempt);
  expect(workerTimelineEventSchema.safeParse({ ...attempt, schemaVersion: 1 }).success).toBe(false);
  expect(workerTimelineEventSchema.safeParse({ ...attempt, payload: { ...attempt.payload, attemptOrdinal: 0 } }).success).toBe(false);
  expect(workerTimelineEventSchema.safeParse({ ...attempt, payload: { ...attempt.payload, attemptKey: 'private-key' } }).success).toBe(false);
  expect(workerTimelineEventSchema.parse(event)).toEqual(event);
});

it('bounds event batches and keeps a failed test verdict separate from successful runner completion', () => {
  const finished = { ...event, seq: 2, payload: {
    type: 'span.finished', spanId: 'tests', status: 'succeeded', testVerdict: 'failed', runId: 'run',
  } };
  expect(workerTimelineEventSchema.parse(finished).payload).toMatchObject({ status: 'succeeded', testVerdict: 'failed' });
  const batch = { workerId: 'mac', slotId: 'ios', attemptId: 'attempt', generation: 1, originAt: event.recordedAt, events: [event] };
  expect(workerTimelineBatchSchema.parse(batch).events).toHaveLength(1);
  expect(workerTimelineBatchSchema.safeParse({ ...batch, events: Array(65).fill(event) }).success).toBe(false);
});
