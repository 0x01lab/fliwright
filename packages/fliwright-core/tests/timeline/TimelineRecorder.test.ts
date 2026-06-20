import { describe, expect, it } from 'vitest';
import { MemoryLogSink, StructuredLogger, TimelineRecorder } from '../../src/index.js';

describe('TimelineRecorder', () => {
  it('records nested page step and frame nodes', () => {
    const recorder = new TimelineRecorder({
      runId: 'run-1',
      testName: 'register flow',
      mode: 'script',
      startedAt: '2026-06-18T00:00:00.000Z',
    });

    const page = recorder.startNode('page', 'Register', { route: '/register' });
    const step = recorder.startNode('step', 'Fill credentials');
    recorder.passNode(step.id);
    const frame = recorder.startNode('frame', 'Filled form');
    recorder.passNode(frame.id);
    recorder.passNode(page.id);

    const data = recorder.complete('passed');

    expect(data).toMatchObject({
      version: 1,
      runId: 'run-1',
      testName: 'register flow',
      mode: 'script',
      status: 'passed',
    });
    expect(data.nodes.map((node) => [node.kind, node.title, node.parentId])).toEqual([
      ['page', 'Register', undefined],
      ['step', 'Fill credentials', page.id],
      ['frame', 'Filled form', page.id],
    ]);
    expect(data.nodes.every((node) => node.status === 'passed')).toBe(true);
  });

  it('stores structured agent visible failures on failed nodes', () => {
    const recorder = new TimelineRecorder({ runId: 'run-2', testName: 'failure test' });
    const step = recorder.startNode('step', 'Tap submit');

    recorder.failNode(step.id, {
      code: 'actionability_failed',
      title: 'Tap submit',
      message: 'Target is obscured',
      recoveryHints: [{ kind: 'close-overlay', description: 'Dismiss the modal first.' }],
    });

    const data = recorder.toJSON();
    expect(data.status).toBe('failed');
    expect(data.nodes[0].error).toMatchObject({
      code: 'actionability_failed',
      timelineNodeId: step.id,
    });
    expect(data.agentVisibleFailures).toHaveLength(1);
  });

  it('marks optional nodes as skipped', () => {
    const recorder = new TimelineRecorder({ runId: 'run-3', testName: 'skip test' });
    const optional = recorder.startNode('optional', 'Submit', { metadata: { when: false } });

    recorder.skipNode(optional.id);

    expect(recorder.toJSON().nodes[0]).toMatchObject({
      kind: 'optional',
      status: 'skipped',
    });
  });

  it('emits structured log events for node lifecycle changes', () => {
    const sink = new MemoryLogSink();
    const logger = new StructuredLogger({
      runId: 'run-4',
      testName: 'log test',
      mode: 'test',
      level: 'debug',
      sinks: [sink],
    });
    const recorder = new TimelineRecorder({ runId: 'run-4', testName: 'log test', logger });

    const step = recorder.startNode('step', 'Tap submit', { metadata: { selector: 'text=Submit' } });
    recorder.passNode(step.id);

    expect(sink.events).toEqual([
      expect.objectContaining({
        level: 'debug',
        kind: 'step',
        status: 'running',
        timelineNodeId: step.id,
        message: 'Tap submit',
      }),
      expect.objectContaining({
        level: 'success',
        kind: 'step',
        status: 'passed',
        timelineNodeId: step.id,
        data: { selector: 'text=Submit' },
      }),
    ]);
  });
});
