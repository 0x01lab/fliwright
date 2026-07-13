import { describe, expect, it } from 'vitest';
import type { FliwrightLogEvent, TimelineNode, TraceData } from '@fliwright/core';
import type { SerializableRun } from '../../src/webview/viewer/types.js';
import {
  TIMELINE_ARTIFACT_KIND_SCREENSHOT,
  TIMELINE_ARTIFACT_KIND_SNAPSHOT,
} from '../../src/viewer/timelineConstants.js';
import {
  screenshotOfNode,
  screenshotOfStep,
  defaultSelectionKey,
  deriveSelection,
  fallbackScreenshot,
  neighborKeys,
} from '../../src/webview/viewer/artifacts.js';
import { flattenTimeline } from '../../src/webview/viewer/treeFlatten.js';

const NODES: TimelineNode[] = [
  { id: 'page', kind: 'page', title: 'Login', status: 'passed', startedAt: 't', route: '/login' },
  {
    id: 'click',
    kind: 'action',
    title: 'click submit',
    status: 'passed',
    startedAt: 't',
    parentId: 'page',
    artifacts: [{ kind: TIMELINE_ARTIFACT_KIND_SCREENSHOT, path: 'artifacts/screenshots/click.png' }],
  },
  {
    id: 'assert',
    kind: 'assertion',
    title: 'sees dashboard',
    status: 'failed',
    startedAt: 't',
    parentId: 'page',
    artifacts: [{ kind: TIMELINE_ARTIFACT_KIND_SNAPSHOT, path: 'artifacts/snapshots/assert.json' }],
    error: { code: 'assertion_failed', title: 'not visible', message: 'dashboard missing', recoveryHints: [] },
  },
  {
    id: 'step',
    kind: 'step',
    title: 'sort markets',
    status: 'failed',
    startedAt: 't',
    error: {
      code: 'step_failed',
      title: 'sort markets',
      message: 'order mismatch',
      appState: {
        screenshotPath: 'artifacts/screenshots/step.png',
        snapshotPath: 'artifacts/snapshots/step.json',
      },
      recoveryHints: [],
    },
  },
];

const LOGS: FliwrightLogEvent[] = [
  { version: 1, id: 'l1', runId: 'r', mode: 'test' as never, level: 'info' as never, kind: 'step' as never, message: 'a', timestamp: 't', timelineNodeId: 'click' },
  { version: 1, id: 'l2', runId: 'r', mode: 'test' as never, level: 'error' as never, kind: 'node' as never, message: 'b', timestamp: 't', timelineNodeId: 'assert' },
];

const RUN: SerializableRun = {
  timeline: { version: 1, runId: 'r', testName: 't', mode: 'test', status: 'failed', startedAt: 't', nodes: NODES },
  logs: LOGS,
  runId: 'r',
  screenshotBaseUrl: 'vscode-webview://base',
  traceBaseUrl: 'vscode-webview://base/trace',
};

const TRACE: TraceData = {
  meta: { testName: 't', runId: 'r', startedAt: 't', status: 'failed', totalSteps: 3, traceVersion: 1 },
  steps: [
    { index: 0, action: 'fill', selector: 'key=email', status: 'pass', durationMs: 5, timestamp: 't' },
    { index: 1, action: 'click', selector: 'text=Go', status: 'fail', durationMs: 7, timestamp: 't', screenshotFile: 'step-1.png' },
    { index: 2, action: 'navigate', selector: '/home', status: 'pass', durationMs: 3, timestamp: 't' },
  ],
};

describe('screenshot resolvers', () => {
  it('resolves a node screenshot artifact', () => {
    expect(screenshotOfNode(NODES[1], 'B')).toBe('B/artifacts/screenshots/click.png');
  });
  it('returns undefined for nodes without a screenshot', () => {
    expect(screenshotOfNode(NODES[0], 'B')).toBeUndefined();
  });
  it('resolves a trace step screenshot file', () => {
    expect(screenshotOfStep('step-1.png', 'BT')).toBe('BT/step-1.png');
    expect(screenshotOfStep(undefined, 'BT')).toBeUndefined();
  });
  it('falls back to failure app state screenshot paths', () => {
    expect(screenshotOfNode(NODES[3], 'B/')).toBe('B/artifacts/screenshots/step.png');
  });
});

describe('defaultSelectionKey', () => {
  it('selects the first failed node in timeline mode, else the last', () => {
    expect(defaultSelectionKey(RUN, 'timeline')).toBe('assert');
  });
  it('selects the first failed step in actions mode', () => {
    const run = { ...RUN, trace: TRACE };
    expect(defaultSelectionKey(run, 'actions')).toBe('trace:1');
  });
  it('falls back to the last item when nothing failed', () => {
    const passing = { ...RUN, timeline: { ...RUN.timeline, nodes: NODES.map(n => ({ ...n, status: 'passed' as const })), status: 'passed' as const } };
    expect(defaultSelectionKey(passing, 'timeline')).toBe('step');
  });
});

describe('deriveSelection', () => {
  it('derives a timeline node selection with scoped logs and failure', () => {
    const sel = deriveSelection(RUN, 'assert', 'timeline');
    expect(sel?.node?.id).toBe('assert');
    expect(sel?.failure?.code).toBe('assertion_failed');
    expect(sel?.logs.map(l => l.id)).toEqual(['l2']);
    expect(sel?.snapshotPath).toBe('artifacts/snapshots/assert.json');
  });
  it('derives screenshot and snapshot paths from failure app state', () => {
    const sel = deriveSelection(RUN, 'step', 'timeline');
    expect(sel?.screenshotUri).toBe('vscode-webview://base/artifacts/screenshots/step.png');
    expect(sel?.snapshotPath).toBe('artifacts/snapshots/step.json');
  });
  it('derives an action step selection with screenshot uri', () => {
    const run = { ...RUN, trace: TRACE };
    const sel = deriveSelection(run, 'trace:1', 'actions');
    expect(sel?.step?.action).toBe('click');
    expect(sel?.screenshotUri).toBe('vscode-webview://base/trace/step-1.png');
    expect(sel?.logs).toEqual([]);
  });
  it('returns undefined for an unknown key', () => {
    expect(deriveSelection(RUN, 'nope', 'timeline')).toBeUndefined();
  });
});

describe('fallbackScreenshot', () => {
  it('walks backward to the nearest node with a screenshot', () => {
    const flat = flattenTimeline(NODES, new Set()); // page, click, assert
    const idx = flat.findIndex(f => f.id === 'assert'); // assert has no screenshot
    const fb = fallbackScreenshot(flat, idx, 'B');
    expect(fb?.uri).toBe('B/artifacts/screenshots/click.png');
    expect(fb?.sourceTitle).toBe('click submit');
  });
  it('returns undefined when no prior screenshot exists', () => {
    const flat = flattenTimeline(NODES, new Set());
    const idx = flat.findIndex(f => f.id === 'page');
    expect(fallbackScreenshot(flat, idx, 'B')).toBeUndefined();
  });
});

describe('neighborKeys', () => {
  it('returns prev and next around the current key', () => {
    expect(neighborKeys(['a', 'b', 'c'], 'b')).toEqual({ prev: 'a', next: 'c' });
  });
  it('clamps at the ends', () => {
    expect(neighborKeys(['a', 'b', 'c'], 'a')).toEqual({ prev: null, next: 'b' });
    expect(neighborKeys(['a', 'b', 'c'], 'c')).toEqual({ prev: 'b', next: null });
  });
  it('defaults to the first item when current is absent', () => {
    expect(neighborKeys(['a', 'b'], null)).toEqual({ prev: null, next: 'a' });
  });
});
