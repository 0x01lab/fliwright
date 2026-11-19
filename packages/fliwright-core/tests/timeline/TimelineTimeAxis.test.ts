import { describe, expect, it } from 'vitest';
import { buildTimelineTimeAxis, timelineNodeAtTime, orderedTimelineNodes } from '../../src/timeline/TimelineTimeAxis.js';
import type { TimelineNode } from '../../src/timeline/types.js';

const stamp = (ms: number) => new Date(Date.UTC(2026, 10, 19) + ms).toISOString();
const node = (id: string, start: number, end?: number, parentId?: string): TimelineNode => ({
  id, title: id, kind: 'step', status: 'passed', startedAt: stamp(start),
  endedAt: end === undefined ? undefined : stamp(end), parentId,
});

describe('recorded timeline time axis', () => {
  it('preserves the shared clock, idle time and deepest overlapping operations', () => {
    const axis = buildTimelineTimeAxis([node('parent', 1000, 8000), node('child', 2000, 3000, 'parent'), node('next', 9000, 10000)],
      { startedAt: stamp(0), endedAt: stamp(12000) });
    expect(axis.durationMs).toBe(12000);
    expect(axis.entries.find(e => e.node.id === 'child')).toMatchObject({ startMs: 2000, endMs: 3000, depth: 1 });
    expect(timelineNodeAtTime(axis, 2500)?.id).toBe('child');
    expect(timelineNodeAtTime(axis, 5000)?.id).toBe('parent');
    expect(timelineNodeAtTime(axis, 9500)?.id).toBe('next');
  });

  it('distinguishes missing, unfinished and zero-duration operations', () => {
    const axis = buildTimelineTimeAxis([{ ...node('bad', 0), startedAt: 'invalid' }, node('zero', 0, 0), node('open', 1000)]);
    expect(axis.missing.map(n => n.id)).toEqual(['bad']);
    expect(axis.entries[0]).toMatchObject({ complete: true, startMs: 0, endMs: 0 });
    expect(axis.entries[1]).toMatchObject({ complete: false, startMs: 1000, endMs: 1000 });
    expect(timelineNodeAtTime(buildTimelineTimeAxis([]), 0)).toBeUndefined();
  });

  it('makes orphaned and cyclic nodes inspectable exactly once', () => {
    const rows = orderedTimelineNodes([node('child', 1, 2, 'parent'), node('parent', 0, 3), node('orphan', 4, 5, 'missing'),
      node('a', 6, 7, 'b'), node('b', 6, 7, 'a')]);
    expect(rows.map(r => r.node.id)).toEqual(['parent', 'child', 'orphan', 'a', 'b']);
  });
});
