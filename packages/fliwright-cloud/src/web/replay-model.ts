import { buildTimelineTimeAxis } from '@fliwright/core/timeline';
export { timelineNodeAtTime as stepAtTime, timelineDurationMs as durationMs, orderedTimelineNodes as orderedSteps } from '@fliwright/core/timeline';
import { timelineDurationMs as durationMs } from '@fliwright/core/timeline';
export type { TimelineTimeEntry as TimeEntry } from '@fliwright/core/timeline';
import type { TimelineTimeAxis } from '@fliwright/core/timeline';
import type { TimelineNode } from '@fliwright/core';
import { scaleLinear } from 'd3-scale';

export type ReplayNode = TimelineNode & { durationMs?: number };
export type TimeAxis = TimelineTimeAxis & { ticks: number[] };
export function evidenceLabel(artifact: { kind: string; metadata?: Record<string, unknown> }): string {
  const surface = artifact.metadata?.surface;
  return `${surface === 'native' ? '原生 ' : surface === 'flutter' ? 'Flutter ' : ''}${artifact.kind}`;
}
export type StepFilter = 'all' | 'failed' | 'screenshots' | 'slow';

/** Map elapsed milliseconds without rounding or extending the recorded domain. */
export function createTimeScale(duration: number) {
  return scaleLinear()
    .domain([0, duration || 1])
    .range([0, 100])
    .clamp(true);
}

/** Shared recorded-time projection with Cloud's existing tick presentation. */
export function buildTimeAxis(nodes: ReplayNode[], bounds: { startedAt?: unknown; endedAt?: unknown } = {}): TimeAxis {
  const axis = buildTimelineTimeAxis(nodes, bounds);
  return { ...axis, ticks: axis.durationMs ? createTimeScale(axis.durationMs).ticks(6) : [0] };
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

/** Resolve only archived images, preserving the preview's screenshot order. */
export function screenshotPaths(node: ReplayNode | undefined, base: string, files: string[]): string[] {
  const paths = [
    ...(node?.artifacts ?? []).map((artifact) => artifact.path),
    node?.error?.appState?.screenshotPath,
  ];
  return [...new Set(paths
    .map((path) => artifactPath(base, path, files))
    .filter((path): path is string => !!path && /\.(png|jpe?g|webp)$/i.test(path)))];
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
