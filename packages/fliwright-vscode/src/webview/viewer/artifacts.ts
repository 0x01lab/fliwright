// packages/fliwright-vscode/src/webview/viewer/artifacts.ts
import type { TimelineNode, FliwrightLogEvent, AgentVisibleFailure, TraceStep } from '@fliwright/core';
import type { SerializableRun } from './types.js';
import type { FlatNode } from './treeFlatten.js';
import {
  TIMELINE_ARTIFACT_KIND_SCREENSHOT,
  TIMELINE_ARTIFACT_KIND_SNAPSHOT,
} from '../../viewer/timelineConstants.js';

export type ListMode = 'timeline' | 'actions';

/** Resolve a node's screenshot artifact to a webview <img src>. */
export function screenshotOfNode(node: TimelineNode, base: string, failure?: AgentVisibleFailure): string | undefined {
  const path = screenshotPathOfNode(node, failure ?? node.error);
  return path ? joinBasePath(base, path) : undefined;
}

/** Resolve a trace step's screenshot file to a webview <img src>. */
export function screenshotOfStep(screenshotFile: string | undefined, base: string): string | undefined {
  return screenshotFile ? joinBasePath(base, screenshotFile) : undefined;
}

export interface Selection {
  key: string;
  mode: ListMode;
  node?: TimelineNode;
  step?: TraceStep;
  stepIndex?: number;
  failure?: AgentVisibleFailure;
  logs: FliwrightLogEvent[];
  screenshotUri?: string;
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
): Selection | undefined {
  if (!key) return undefined;

  if (mode === 'actions') {
    const m = /^trace:(.+)$/.exec(key);
    if (!m) return undefined;
    const idx = Number(m[1]);
    const steps = run.trace?.steps ?? [];
    const step = steps[idx];
    if (!step) return undefined;
    return {
      key,
      mode,
      step,
      stepIndex: idx,
      logs: [],
      screenshotUri: screenshotOfStep(step.screenshotFile, run.traceBaseUrl),
      widgetTree: step.widgetTree,
    };
  }

  const node = run.timeline.nodes.find(n => n.id === key);
  if (!node) return undefined;
  const failure = node.error ?? run.timeline.agentVisibleFailures?.find(f => f.timelineNodeId === node.id);
  const logs = run.logs.filter(l => l.timelineNodeId === node.id);
  return {
    key,
    mode,
    node,
    failure,
    logs,
    screenshotUri: screenshotOfNode(node, run.screenshotBaseUrl, failure),
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

function screenshotPathOfNode(node: TimelineNode, failure?: AgentVisibleFailure): string | undefined {
  return artifactPathOfNode(node, TIMELINE_ARTIFACT_KIND_SCREENSHOT) ?? failure?.appState?.screenshotPath;
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
