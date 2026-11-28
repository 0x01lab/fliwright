import { buildTimelineTimeAxis, parseScreenshotInteraction, type ScreenshotInteraction } from '@fliwright/core/timeline';
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

export interface ReplayScreenshot {
  path: string;
  phase?: 'start' | 'finish' | 'failure';
  overlay?: { interaction: ScreenshotInteraction; pixelRatio: number };
}

export interface ReplayListRow {
  nodes: ReplayNode[];
  depth: number;
}

/** Pair adjacent actions with their result assertion for the compact replay list. */
export function groupReplaySteps(rows: Array<{ node: ReplayNode; depth: number }>): ReplayListRow[] {
  const grouped: ReplayListRow[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    const current = rows[index]!;
    const next = rows[index + 1];
    if (current.node.kind === 'action' && next?.node.kind === 'assertion' &&
      current.node.parentId === next.node.parentId && current.depth === next.depth) {
      grouped.push({ nodes: [current.node, next.node], depth: current.depth });
      index += 1;
    } else {
      grouped.push({ nodes: [current.node], depth: current.depth });
    }
  }
  return grouped;
}

/** Resolve archived images once, preserving the same order in the preview and filmstrip. */
export function replayScreenshots(node: ReplayNode | undefined, base: string, files: string[]): ReplayScreenshot[] {
  const images = new Map<string, ReplayScreenshot>();
  const interaction = parseScreenshotInteraction(node?.metadata?.interaction);
  const add = (path: unknown, metadata?: Record<string, unknown>) => {
    const resolved = artifactPath(base, path, files);
    if (!resolved || !/\.(png|jpe?g|webp)$/i.test(resolved) || images.has(resolved)) return;
    const capturePhase = metadata?.capturePhase;
    const phase = capturePhase === 'start' || capturePhase === 'finish' || capturePhase === 'failure' ? capturePhase : undefined;
    const pixelRatio = metadata?.pixelRatio;
    const overlay = phase === 'start' && interaction && typeof pixelRatio === 'number' && Number.isFinite(pixelRatio) && pixelRatio > 0
      ? { interaction, pixelRatio }
      : undefined;
    images.set(resolved, { path: resolved, phase, overlay });
  };
  for (const artifact of node?.artifacts ?? []) add(artifact.path, artifact.metadata);
  add(node?.error?.appState?.screenshotPath);
  return [...images.values()];
}

export function screenshotPaths(node: ReplayNode | undefined, base: string, files: string[]): string[] {
  return replayScreenshots(node, base, files).map(({ path }) => path);
}

export function groupReplayEvidence(nodes: ReplayNode[], base: string, files: string[]) {
  const steps: ReplayNode[] = [];
  const caseScreenshots: Array<{ phase: 'start' | 'finish'; path: string }> = [];
  for (const node of nodes) {
    const phase = node.metadata?.lifecycle;
    if (node.kind === 'step' && (phase === 'start' || phase === 'finish')) {
      for (const path of screenshotPaths(node, base, files)) {
        caseScreenshots.push({ phase, path });
      }
    } else {
      steps.push(node);
    }
  }
  return { steps, caseScreenshots };
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
