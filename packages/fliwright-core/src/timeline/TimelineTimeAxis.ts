import type { TimelineNode } from './types.js';

export type TimedTimelineNode = TimelineNode & { durationMs?: number };

export interface TimelineTimeEntry {
  node: TimedTimelineNode;
  depth: number;
  startMs: number;
  endMs: number;
  complete: boolean;
  lane: number;
}
export interface TimelineTimeAxis {
  durationMs: number;
  entries: TimelineTimeEntry[];
  missing: TimedTimelineNode[];
  lanes: number;
}

/** All actions share a clock; nested durations must never be added together. */
export function buildTimelineTimeAxis(
  nodes: TimedTimelineNode[],
  bounds: { startedAt?: unknown; endedAt?: unknown } = {},
): TimelineTimeAxis {
  const timestamp = (value: unknown) =>
    typeof value === 'string' ? Date.parse(value) : NaN;
  const rows = orderedTimelineNodes(nodes);
  const missing: TimedTimelineNode[] = [];
  const timed = rows.flatMap(({ node, depth }) => {
    const start = timestamp(node.startedAt);
    if (!Number.isFinite(start)) {
      missing.push(node);
      return [];
    }
    const duration = timelineDurationMs(node);
    return [
      {
        node,
        depth,
        start,
        end: start + (duration ?? 0),
        complete: duration !== undefined,
      },
    ];
  });
  const startBound = timestamp(bounds.startedAt),
    endBound = timestamp(bounds.endedAt);
  let origin = Number.isFinite(startBound) ? startBound : Infinity;
  for (const entry of timed) origin = Math.min(origin, entry.start);
  if (!Number.isFinite(origin)) origin = 0;
  let end = Number.isFinite(endBound) ? Math.max(origin, endBound) : origin;
  for (const entry of timed) end = Math.max(end, entry.end);
  const duration = end - origin;
  const laneEnds: number[] = [];
  const entries = timed
    .sort((a, b) => a.start - b.start || a.depth - b.depth || b.end - a.end)
    .map((entry) => {
      const startMs = entry.start - origin,
        endMs = entry.end - origin;
      let lane = laneEnds.findIndex((value) => value <= startMs);
      if (lane < 0) lane = laneEnds.length;
      // Reserve visual room for markers without changing the recorded interval.
      laneEnds[lane] = Math.max(endMs, startMs + Math.max(1, duration / 60));
      return {
        node: entry.node,
        depth: entry.depth,
        startMs,
        endMs,
        complete: entry.complete,
        lane,
      };
    });
  return {
    durationMs: duration,
    entries,
    missing,
    lanes: laneEnds.length,
  };
}

/** At overlapping actions, inspect the deepest, most specific recorded operation. */
export function timelineNodeAtTime(
  axis: TimelineTimeAxis,
  timeMs: number,
): TimedTimelineNode | undefined {
  const distance = (entry: TimelineTimeEntry) =>
    Math.max(entry.startMs - timeMs, timeMs - entry.endMs, 0);
  return [...axis.entries].sort(
    (a, b) =>
      distance(a) - distance(b) ||
      b.depth - a.depth ||
      a.endMs - a.startMs - (b.endMs - b.startMs) ||
      b.startMs - a.startMs,
  )[0]?.node;
}

export function timelineDurationMs(node: TimedTimelineNode): number | undefined {
  const value = Date.parse(node.endedAt ?? '') - Date.parse(node.startedAt);
  if (Number.isFinite(value) && value >= 0) return value;
  if (
    typeof node.durationMs === 'number' &&
    Number.isFinite(node.durationMs) &&
    node.durationMs >= 0
  )
    return node.durationMs;
  return undefined;
}

/** Preserve hierarchy order, including orphaned nodes, without looping on corrupt parents. */
export function orderedTimelineNodes(
  nodes: TimedTimelineNode[],
): Array<{ node: TimedTimelineNode; depth: number }> {
  const result: Array<{ node: TimedTimelineNode; depth: number }> = [];
  const seen = new Set<string>();
  const ids = new Set(nodes.map((n) => n.id));
  const visit = (node: TimedTimelineNode, depth: number) => {
    if (seen.has(node.id)) return;
    seen.add(node.id);
    result.push({ node, depth });
    nodes
      .filter((n) => n.parentId === node.id)
      .forEach((n) => visit(n, depth + 1));
  };
  nodes
    .filter((n) => !n.parentId || !ids.has(n.parentId))
    .forEach((n) => visit(n, 0));
  nodes.forEach((n) => visit(n, 0));
  return result;
}
