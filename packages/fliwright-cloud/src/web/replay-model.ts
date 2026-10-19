import type { TimelineNode } from '@fliwright/core';

export type ReplayNode = TimelineNode & { durationMs?: number };
export type StepFilter = 'all' | 'failed' | 'screenshots' | 'slow';

export interface TimeEntry {
  node: ReplayNode;
  depth: number;
  startMs: number;
  endMs: number;
  complete: boolean;
  lane: number;
}
export interface TimeAxis {
  durationMs: number;
  entries: TimeEntry[];
  missing: ReplayNode[];
  ticks: number[];
  lanes: number;
}

/** All actions share a clock; nested durations must never be added together. */
export function buildTimeAxis(
  nodes: ReplayNode[],
  bounds: { startedAt?: unknown; endedAt?: unknown } = {},
): TimeAxis {
  const timestamp = (value: unknown) =>
    typeof value === 'string' ? Date.parse(value) : NaN;
  const rows = orderedSteps(nodes);
  const missing: ReplayNode[] = [];
  const timed = rows.flatMap(({ node, depth }) => {
    const start = timestamp(node.startedAt);
    if (!Number.isFinite(start)) {
      missing.push(node);
      return [];
    }
    const duration = durationMs(node);
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
  const raw = duration / 6;
  const power = 10 ** Math.floor(Math.log10(raw || 1));
  const interval = ([1, 2, 5, 10].find((n) => n * power >= raw) ?? 10) * power;
  const ticks = [0];
  for (
    let value = interval;
    value <= duration && ticks.length < 20;
    value += interval
  )
    ticks.push(value);
  return {
    durationMs: duration,
    entries,
    missing,
    ticks,
    lanes: laneEnds.length,
  };
}

/** At overlapping actions, inspect the deepest, most specific recorded operation. */
export function stepAtTime(
  axis: TimeAxis,
  timeMs: number,
): ReplayNode | undefined {
  const distance = (entry: TimeEntry) =>
    Math.max(entry.startMs - timeMs, timeMs - entry.endMs, 0);
  return [...axis.entries].sort(
    (a, b) =>
      distance(a) - distance(b) ||
      b.depth - a.depth ||
      a.endMs - a.startMs - (b.endMs - b.startMs) ||
      b.startMs - a.startMs,
  )[0]?.node;
}

export function artifactPath(
  base: string,
  path: unknown,
  files: string[],
): string | undefined {
  if (
    typeof path !== 'string' ||
    path.startsWith('/') ||
    path.includes('\\') ||
    path.includes(':')
  )
    return;
  const parts: string[] = [];
  for (const piece of `${base}/${path}`.split('/')) {
    if (piece === '..') {
      if (!parts.length) return;
      parts.pop();
    } else if (piece && piece !== '.') parts.push(piece);
  }
  const resolved = parts.join('/');
  return files.includes(resolved) ? resolved : undefined;
}

export function durationMs(node: ReplayNode): number | undefined {
  if (
    typeof node.durationMs === 'number' &&
    Number.isFinite(node.durationMs) &&
    node.durationMs >= 0
  )
    return node.durationMs;
  const value = Date.parse(node.endedAt ?? '') - Date.parse(node.startedAt);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function durationLabel(value?: number): string {
  return value === undefined
    ? '—'
    : value < 1000
      ? `${Math.round(value)}ms`
      : `${(value / 1000).toFixed(1)}s`;
}

export function matchesStep(node: ReplayNode, filter: StepFilter): boolean {
  if (filter === 'failed') return node.status === 'failed';
  if (filter === 'screenshots')
    return (
      !!node.artifacts?.some((a) => /\.(png|jpe?g|webp)$/i.test(a.path)) ||
      !!node.error?.appState?.screenshotPath
    );
  if (filter === 'slow') return (durationMs(node) ?? 0) >= 10000;
  return true;
}

/** Preserve hierarchy order, including orphaned nodes, without looping on corrupt parents. */
export function orderedSteps(
  nodes: ReplayNode[],
): Array<{ node: ReplayNode; depth: number }> {
  const result: Array<{ node: ReplayNode; depth: number }> = [];
  const seen = new Set<string>();
  const ids = new Set(nodes.map((n) => n.id));
  const visit = (node: ReplayNode, depth: number) => {
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

export function parseLog(content: string): Array<Record<string, unknown>> {
  return content
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      try {
        const value: unknown = JSON.parse(line);
        return value && typeof value === 'object' && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : { message: line };
      } catch {
        return { message: line };
      }
    });
}
