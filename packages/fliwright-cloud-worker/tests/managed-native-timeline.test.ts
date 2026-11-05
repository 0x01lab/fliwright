import { expect, it } from 'vitest';
import type { WorkerTimelinePayload } from '@fliwright/cloud-protocol';
import { WorkerTimelineChannel } from '../src/WorkerTimelineChannel.js';
import { ManagedNativeTimeline } from '../src/ManagedNativeTimeline.js';
import { WorkerNativeOwnership } from '../src/WorkerNativeOwnership.js';

it('groups owner phases by attempt without persisting the attempt key hash', async () => {
  const events: WorkerTimelinePayload[] = [];
  const channel = new WorkerTimelineChannel(async event => { events.push(event); return true; });
  const timeline = new ManagedNativeTimeline(channel);
  const first = 'a'.repeat(64), second = 'b'.repeat(64);
  const emit = (id: string, phase: 'native.stop' | 'native.launch' | 'native.verify', status?: 'succeeded' | 'failed') => {
    timeline.observe(status
      ? { type: 'finished', id, phase, attemptKeyHash: id.startsWith('first') ? first : second, status, endedAt: new Date().toISOString() }
      : { type: 'started', id, phase, attemptKeyHash: id.startsWith('first') ? first : second, startedAt: new Date().toISOString() });
  };

  emit('first-stop', 'native.stop'); emit('first-stop', 'native.stop', 'succeeded');
  emit('first-launch', 'native.launch'); emit('first-launch', 'native.launch', 'succeeded');
  emit('first-verify', 'native.verify'); emit('first-verify', 'native.verify', 'succeeded');
  emit('second-stop', 'native.stop'); emit('second-stop', 'native.stop', 'failed');
  await timeline.flush();

  const starts = events.filter((event): event is Extract<WorkerTimelinePayload, { type: 'span.started' }> => event.type === 'span.started');
  const attemptGroups = starts.filter(event => event.phase === 'native.attempt');
  expect(attemptGroups.map(event => event.attemptOrdinal)).toEqual([1, 2]);
  expect(starts.filter(event => event.phase === 'native.stop').map(event => event.parentSpanId)).toEqual(attemptGroups.map(event => event.spanId));
  expect(starts.find(event => event.phase === 'native.launch')?.parentSpanId).toBe(attemptGroups[0]?.spanId);
  expect(starts.find(event => event.phase === 'native.verify')?.parentSpanId).toBe(attemptGroups[0]?.spanId);
  expect(events.filter(event => event.type === 'span.finished').map(event => event.spanId)).toContain(attemptGroups[0]?.spanId);
  expect(events.find(event => event.type === 'span.finished' && event.spanId === attemptGroups[1]?.spanId)).toMatchObject({ status: 'failed' });
  expect(JSON.stringify(events)).not.toContain(first);
  expect(JSON.stringify(events)).not.toContain(second);
});

it('continues supervisor reset and owner release when timeline recording rejects events', async () => {
  const channel = new WorkerTimelineChannel(async () => { throw new Error('recorder unavailable'); });
  const timeline = new ManagedNativeTimeline(channel);
  const calls: string[] = [];
  const owner = new WorkerNativeOwnership(async (_project, options) => {
    options.onPhase?.({ type: 'started', id: 'attempt-stop', phase: 'native.stop', startedAt: new Date().toISOString(), attemptKeyHash: 'c'.repeat(64) });
    options.onPhase?.({ type: 'finished', id: 'attempt-stop', phase: 'native.stop', status: 'interrupted', reason: 'shutdown', endedAt: new Date().toISOString(), attemptKeyHash: 'c'.repeat(64) });
    return {
      delegation: { rootDir: '/lease', key: 'a'.repeat(64), token: 'b'.repeat(64) },
      dispose: async () => { calls.push('release'); },
      quiesce: async () => { calls.push('quiesce'); },
    } as never;
  });

  await owner.acquire('/project', { deviceId: 'device', signal: new AbortController().signal, onPhase: event => timeline.observe(event) });
  await timeline.flush();
  await owner.reset(async () => { calls.push('reset'); });
  await timeline.flush();

  expect(calls).toEqual(['quiesce', 'reset', 'release']);
});
