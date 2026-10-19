import { describe, expect, it } from 'vitest';
import {
  artifactPath,
  durationMs,
  matchesStep,
  orderedSteps,
  parseLog,
  buildTimeAxis,
  stepAtTime,
  type ReplayNode,
} from '../src/web/replay-model.js';

const step = (id: string, extra: Partial<ReplayNode> = {}): ReplayNode => ({
  id,
  kind: 'step',
  title: id,
  status: 'passed',
  startedAt: '2026-10-19T01:00:00Z',
  ...extra,
});

describe('report replay evidence', () => {
  it('places nested and overlapping steps on a shared elapsed-time axis', () => {
    const nodes = [
      step('parent', { endedAt: '2026-10-19T01:00:10Z' }),
      step('child', {
        parentId: 'parent',
        startedAt: '2026-10-19T01:00:02Z',
        endedAt: '2026-10-19T01:00:04Z',
      }),
      step('parallel', {
        startedAt: '2026-10-19T01:00:03Z',
        endedAt: '2026-10-19T01:00:06Z',
      }),
      step('point', {
        startedAt: '2026-10-19T01:00:10Z',
        endedAt: '2026-10-19T01:00:10Z',
      }),
    ];
    const axis = buildTimeAxis(nodes, {
      startedAt: '2026-10-19T01:00:00Z',
      endedAt: '2026-10-19T01:00:12Z',
    });
    expect(axis.durationMs).toBe(12000);
    expect(axis.entries.find((e) => e.node.id === 'child')).toMatchObject({
      startMs: 2000,
      endMs: 4000,
      depth: 1,
    });
    const parent = axis.entries.find((e) => e.node.id === 'parent')!;
    const child = axis.entries.find((e) => e.node.id === 'child')!;
    const parallel = axis.entries.find((e) => e.node.id === 'parallel')!;
    expect(new Set([parent.lane, child.lane, parallel.lane]).size).toBe(3);
    expect(stepAtTime(axis, 2500)?.id).toBe('child');
    expect(stepAtTime(axis, 5000)?.id).toBe('parallel');
    expect(stepAtTime(axis, 10000)?.id).toBe('point');
    expect(axis.ticks[0]).toBe(0);
    expect(axis.ticks.at(-1)).toBeLessThanOrEqual(12000);
  });

  it('keeps missing, zero and incomplete timings distinct without inventing elapsed durations', () => {
    const nodes = [
      step('invalid', { startedAt: 'bad' }),
      step('zero', { endedAt: '2026-10-19T01:00:00Z' }),
      step('open', { startedAt: '2026-10-19T01:00:02Z' }),
    ];
    const axis = buildTimeAxis(nodes);
    expect(axis.missing.map((n) => n.id)).toEqual(['invalid']);
    expect(axis.entries.find((e) => e.node.id === 'zero')).toMatchObject({
      startMs: 0,
      endMs: 0,
      complete: true,
    });
    expect(axis.entries.find((e) => e.node.id === 'open')).toMatchObject({
      startMs: 2000,
      endMs: 2000,
      complete: false,
    });
    expect(stepAtTime(axis, 2000)?.id).toBe('open');
    const empty = buildTimeAxis([nodes[0]]);
    expect(empty.entries).toEqual([]);
    expect(stepAtTime(empty, 0)).toBeUndefined();
    const zero = buildTimeAxis([nodes[1]]);
    expect(zero.durationMs).toBe(0);
    expect(zero.ticks).toEqual([0]);
  });
  it('keeps children next to their parent and makes orphaned or cyclic nodes inspectable', () => {
    const nodes = [
      step('child', { parentId: 'root' }),
      step('other'),
      step('root'),
      step('orphan', { parentId: 'missing' }),
      step('a', { parentId: 'b' }),
      step('b', { parentId: 'a' }),
    ];
    const result = orderedSteps(nodes);
    expect(result.map(({ node }) => node.id)).toEqual([
      'other',
      'root',
      'child',
      'orphan',
      'a',
      'b',
    ]);
    expect(result.find(({ node }) => node.id === 'child')?.depth).toBe(1);
  });

  it('distinguishes missing timings from zero and filters slow, failed and screenshot steps', () => {
    expect(durationMs(step('open'))).toBeUndefined();
    expect(durationMs(step('invalid', { endedAt: 'bad' }))).toBeUndefined();
    expect(durationMs(step('zero', { endedAt: '2026-10-19T01:00:00Z' }))).toBe(
      0,
    );
    const slow = step('slow', {
      endedAt: '2026-10-19T01:00:12Z',
      status: 'failed',
      artifacts: [{ kind: 'screenshot', path: 'shots/failure.PNG' }],
    });
    expect(durationMs(slow)).toBe(12000);
    expect(matchesStep(slow, 'slow')).toBe(true);
    expect(matchesStep(slow, 'failed')).toBe(true);
    expect(matchesStep(slow, 'screenshots')).toBe(true);
    expect(matchesStep(step('fast', { durationMs: 9999 }), 'slow')).toBe(false);
  });

  it('resolves only archived files and rejects absolute, escaped and external paths', () => {
    const files = ['tests/a/one/shots/1.png', 'sources/test.ts'];
    expect(artifactPath('tests/a/one', 'shots/1.png', files)).toBe(files[0]);
    expect(artifactPath('tests/a/one', '../../../sources/test.ts', files)).toBe(
      files[1],
    );
    for (const path of [
      '/sources/test.ts',
      '../../../../sources/test.ts',
      'https://evil/image.png',
      'shots\\1.png',
      'missing.png',
    ]) {
      expect(artifactPath('tests/a/one', path, files)).toBeUndefined();
    }
  });

  it('preserves mixed plain-text and structured logs with their step association', () => {
    const rows = parseLog(
      '{"timelineNodeId":"s1","message":"clicked"}\nplain log\nnull\n\n',
    );
    expect(rows).toEqual([
      { timelineNodeId: 's1', message: 'clicked' },
      { message: 'plain log' },
      { message: 'null' },
    ]);
  });
});
