import { describe, expect, it } from 'vitest';
import type { TimelineNode } from '@fliwright/core';
import { flattenTimeline, visibleTimeline, buildChildrenMap } from '../../src/webview/viewer/treeFlatten.js';

function node(partial: Partial<TimelineNode> & { id: string }): TimelineNode {
  return {
    kind: 'step',
    title: partial.id,
    status: 'passed',
    startedAt: '2026-01-01T00:00:00Z',
    ...partial,
  } as TimelineNode;
}

const TREE: TimelineNode[] = [
  node({ id: 'script', kind: 'script', title: 'run' }),
  node({ id: 'page', kind: 'page', title: 'Login', parentId: 'script' }),
  node({ id: 'fill', kind: 'action', title: 'fill email', parentId: 'page' }),
  node({ id: 'assert', kind: 'assertion', title: 'sees dashboard', status: 'failed', parentId: 'page' }),
];

describe('buildChildrenMap', () => {
  it('groups children by parent and collects roots', () => {
    const { childrenOf, roots } = buildChildrenMap(TREE);
    expect(roots.map(r => r.id)).toEqual(['script']);
    expect(childrenOf['script'].map(n => n.id)).toEqual(['page']);
    expect(childrenOf['page'].map(n => n.id)).toEqual(['fill', 'assert']);
  });
});

describe('flattenTimeline', () => {
  it('walks depth-first with correct depths and hasChildren flags', () => {
    const flat = flattenTimeline(TREE, new Set());
    expect(flat.map(f => [f.id, f.depth, f.hasChildren])).toEqual([
      ['script', 0, true],
      ['page', 1, true],
      ['fill', 2, false],
      ['assert', 2, false],
    ]);
  });

  it('hides descendants of collapsed nodes but keeps the node itself', () => {
    const flat = flattenTimeline(TREE, new Set(['page']));
    expect(flat.map(f => f.id)).toEqual(['script', 'page']);
  });
});

describe('visibleTimeline', () => {
  it('honors collapsed when query is empty', () => {
    const flat = visibleTimeline(TREE, new Set(['page']), '');
    expect(flat.map(f => f.id)).toEqual(['script', 'page']);
  });

  it('expands all and keeps matches plus their ancestors when filtering', () => {
    const flat = visibleTimeline(TREE, new Set(['page']), 'dashboard');
    expect(flat.map(f => f.id)).toEqual(['script', 'page', 'assert']);
  });

  it('matches on kind and route too', () => {
    const flat = visibleTimeline(TREE, new Set(), 'assertion');
    expect(flat.map(f => f.id)).toEqual(['script', 'page', 'assert']);
  });
});
