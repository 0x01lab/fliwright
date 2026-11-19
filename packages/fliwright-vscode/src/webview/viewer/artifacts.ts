// packages/fliwright-vscode/src/webview/viewer/artifacts.ts
import type { TimelineNode, FliwrightLogEvent, AgentVisibleFailure, TraceStep } from '@fliwright/core';
import type { SerializableRun } from './types.js';
import type { FlatNode } from './treeFlatten.js';
import { buildTimelineTimeAxis } from '@fliwright/core/timeline';
import {
  TIMELINE_ARTIFACT_KIND_SCREENSHOT,
  TIMELINE_ARTIFACT_KIND_SNAPSHOT,
} from '../../viewer/timelineConstants.js';

export type ListMode = 'timeline' | 'actions';

/** Resolve a node's screenshot artifact to a webview <img src>. */
export function screenshotOfNode(node: TimelineNode, base: string, failure?: AgentVisibleFailure): string | undefined {
  return screenshotsOfNode(node, base, failure)[0];
}

/** All captured images, including failure evidence, in stable artifact order. */
export function screenshotsOfNode(node: TimelineNode, base: string, failure?: AgentVisibleFailure): string[] {
  const paths = [...(node.artifacts ?? []).filter(a => a.kind === TIMELINE_ARTIFACT_KIND_SCREENSHOT).map(a => a.path),
    (failure ?? node.error)?.appState?.screenshotPath];
  return [...new Set(paths.filter((path): path is string => !!path))].map(path => joinBasePath(base, path));
}

export function screenshotsForNode(run: SerializableRun, node: TimelineNode): string[] {
  const failure = node.error ?? run.timeline.agentVisibleFailures?.find(f => f.timelineNodeId === node.id);
  const images = screenshotsOfNode(node, run.screenshotBaseUrl, failure);
  if (images.length) return images;
  const operationId = node.metadata?.operationId;
  const action = operationId ? run.trace?.steps.find(step => step.operationId === operationId) : undefined;
  const uri = screenshotOfStep(action?.screenshotFile, run.traceBaseUrl);
  return uri ? [uri] : [];
}

/** Trace timestamps have two historical meanings; only explicit operation identity links clocks. */
export function timelineNodeForKey(run: SerializableRun, key: string | null, mode: ListMode): TimelineNode | undefined {
  if (!key) return;
  if (mode === 'timeline') return run.timeline.nodes.find(node => node.id === key);
  const index = /^trace:(\d+)$/.exec(key)?.[1];
  const operationId = index === undefined ? undefined : run.trace?.steps[Number(index)]?.operationId;
  return operationId ? run.timeline.nodes.find(node => node.metadata?.operationId === operationId) : undefined;
}

/** Resolve a previous captured frame from the full recorded clock, independent of list filtering. */
export function precedingScreenshot(run: SerializableRun, node: TimelineNode): { uri: string; sourceTitle: string; time?: string; anchor: 'start' | 'end' } | undefined {
  const axis = buildTimelineTimeAxis(run.timeline.nodes, run.timeline);
  const current = axis.entries.find(entry => entry.node.id === node.id);
  if (!current) return;
  const previous = axis.entries.filter(entry => entry.node.id !== node.id && entry.endMs <= current.startMs)
    .sort((a, b) => b.endMs - a.endMs || b.depth - a.depth);
  for (const entry of previous) {
    const uri = screenshotsForNode(run, entry.node).at(-1);
    if (uri) return {
      uri, sourceTitle: entry.node.title,
      time: entry.complete ? entry.node.endedAt : entry.node.startedAt,
      anchor: entry.complete ? 'end' : 'start',
    };
  }
}

/** Resolve a trace step's screenshot file to a webview <img src>. */
export function screenshotOfStep(screenshotFile: string | undefined, base: string): string | undefined {
  return screenshotFile ? joinBasePath(base, screenshotFile) : undefined;
}

export interface Selection {
  key: string;
  mode: ListMode;
  surface?: 'flutter' | 'native';
  node?: TimelineNode;
  step?: TraceStep;
  stepIndex?: number;
  failure?: AgentVisibleFailure;
  logs: FliwrightLogEvent[];
  screenshotUri?: string;
  screenshotUris?: string[];
  /** Snapshot artifact path (relative to run dir) — content is fetched lazily in Phase C. */
  snapshotPath?: string;
  /** Inline widget tree for action steps (trace steps carry this in trace.json). */
  widgetTree?: unknown;
}

/**
 * Derive the master-detail selection object for a key. `trace:<index>` keys
 * address action steps; any other key addresses a timeline node by id.
 */
export function deriveSelection(
  run: SerializableRun,
  key: string | null,
  mode: ListMode,
  screenshotIndex = 0,
): Selection | undefined {
  if (!key) return undefined;

  if (mode === 'actions') {
    const m = /^trace:(.+)$/.exec(key);
    if (!m) return undefined;
    const idx = Number(m[1]);
    const steps = run.trace?.steps ?? [];
    const step = steps[idx];
    if (!step) return undefined;
    const node = timelineNodeForKey(run, key, mode);
    const linked = node ? deriveSelection(run, node.id, 'timeline', screenshotIndex) : undefined;
    const screenshotUri = screenshotOfStep(step.screenshotFile, run.traceBaseUrl);
    return {
      ...linked,
      key,
      mode,
      step,
      stepIndex: idx,
      logs: linked?.logs ?? [],
      screenshotUris: linked?.screenshotUris?.length ? linked.screenshotUris : screenshotUri ? [screenshotUri] : [],
      screenshotUri: linked?.screenshotUri ?? screenshotUri,
      widgetTree: step.widgetTree,
    };
  }

  const node = run.timeline.nodes.find(n => n.id === key);
  if (!node) return undefined;
  const failure = node.error ?? run.timeline.agentVisibleFailures?.find(f => f.timelineNodeId === node.id);
  const logs = run.logs.filter(l => l.timelineNodeId === node.id);
  const images = screenshotsForNode(run, node);
  return {
    key,
    mode,
    surface: node.metadata?.surface === 'native' || node.artifacts?.some(artifact => artifact.metadata?.surface === 'native') ? 'native' : 'flutter',
    node,
    failure,
    logs,
    screenshotUris: images,
    screenshotUri: images[Math.max(0, Math.min(screenshotIndex, images.length - 1))],
    snapshotPath: snapshotPathOfNode(node, failure),
  };
}

/**
 * Default selection key: the first failed item, else the last item. Lands the
 * user on the interesting moment immediately (Playwright default).
 */
export function defaultSelectionKey(run: SerializableRun, mode: ListMode): string | null {
  if (mode === 'actions') {
    const steps = run.trace?.steps ?? [];
    if (!steps.length) return null;
    const failed = steps.findIndex(s => s.status === 'fail');
    return `trace:${failed >= 0 ? failed : steps.length - 1}`;
  }
  const nodes = run.timeline.nodes;
  if (!nodes.length) return null;
  const failed = nodes.find(n => n.status === 'failed');
  return (failed ?? nodes[nodes.length - 1]).id;
}

/**
 * Walk the flattened timeline list backward from `currentIndex` to find the
 * nearest node that has a screenshot. Used as the "before" fallback when the
 * selected node has no screenshot (there is no real before/after pairing).
 */
export function fallbackScreenshot(
  flat: FlatNode[],
  currentIndex: number,
  base: string,
): { uri: string; sourceTitle: string } | undefined {
  for (let i = currentIndex; i >= 0; i--) {
    const uri = screenshotOfNode(flat[i].node, base, flat[i].node.error);
    if (uri) return { uri, sourceTitle: flat[i].node.title };
  }
  return undefined;
}

/** Prev/next keys among an ordered key list (the currently visible items). */
export function neighborKeys(
  keys: string[],
  currentKey: string | null,
): { prev: string | null; next: string | null } {
  const idx = currentKey ? keys.indexOf(currentKey) : -1;
  if (idx < 0) return { prev: null, next: keys.length ? keys[0] : null };
  return {
    prev: idx > 0 ? keys[idx - 1] : null,
    next: idx < keys.length - 1 ? keys[idx + 1] : null,
  };
}

function snapshotPathOfNode(node: TimelineNode, failure?: AgentVisibleFailure): string | undefined {
  return artifactPathOfNode(node, TIMELINE_ARTIFACT_KIND_SNAPSHOT) ?? failure?.appState?.snapshotPath;
}

function artifactPathOfNode(node: TimelineNode, kind: string): string | undefined {
  return (node.artifacts ?? []).find(a => a.kind === kind)?.path;
}

function joinBasePath(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}
