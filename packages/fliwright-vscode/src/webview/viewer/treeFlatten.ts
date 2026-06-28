// packages/fliwright-vscode/src/webview/viewer/treeFlatten.ts
import type { TimelineNode } from '@fliwright/core';

export interface FlatNode {
  id: string;
  node: TimelineNode;
  depth: number;
  hasChildren: boolean;
}

export function buildChildrenMap(nodes: TimelineNode[]): {
  childrenOf: Record<string, TimelineNode[]>;
  roots: TimelineNode[];
} {
  const childrenOf: Record<string, TimelineNode[]> = {};
  const roots: TimelineNode[] = [];
  for (const n of nodes) {
    const key = n.parentId ?? '__roots__';
    (childrenOf[key] ??= []).push(n);
    if (!n.parentId) roots.push(n);
  }
  return { childrenOf, roots };
}

/**
 * Flatten the timeline node tree (nested via parentId) into an ordered list with
 * depth + hasChildren, honoring a collapsed-id set. Children follow their parent
 * in insertion order.
 */
export function flattenTimeline(nodes: TimelineNode[], collapsed: Set<string>): FlatNode[] {
  const { childrenOf, roots } = buildChildrenMap(nodes);
  const out: FlatNode[] = [];
  const walk = (node: TimelineNode, depth: number): void => {
    const kids = childrenOf[node.id] ?? [];
    out.push({ id: node.id, node, depth, hasChildren: kids.length > 0 });
    if (collapsed.has(node.id)) return;
    for (const k of kids) walk(k, depth + 1);
  };
  for (const r of roots) walk(r, 0);
  return out;
}

function nodeMatches(node: TimelineNode, query: string): boolean {
  const hay = `${node.title ?? ''} ${node.kind} ${node.route ?? ''}`.toLowerCase();
  return hay.includes(query);
}

/**
 * Timeline flat list for display. With an empty query, the collapsed set is
 * honored. With a query, the tree is fully expanded and only nodes that match
 * (by title/kind/route) or are ancestors of a match are kept.
 */
export function visibleTimeline(nodes: TimelineNode[], collapsed: Set<string>, query: string): FlatNode[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return flattenTimeline(nodes, collapsed);

  const all = flattenTimeline(nodes, new Set()); // expand all for searching
  const keep = new Set<string>();
  for (const f of all) {
    if (!nodeMatches(f.node, trimmed)) continue;
    // keep this node and all its ancestors
    let cur: string | undefined = f.id;
    while (cur && !keep.has(cur)) {
      keep.add(cur);
      const parent = all.find(x => x.id === cur)?.node.parentId;
      cur = parent;
    }
  }
  return all.filter(f => keep.has(f.id));
}
