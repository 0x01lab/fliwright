export interface CollectedTest { kind: 'test'; title: string; }
export interface CollectedGroup { kind: 'group'; title: string; children: CollectedNode[]; }
export type CollectedNode = CollectedGroup | CollectedTest;
export interface CollectedFile { nodes: CollectedNode[]; }

/** Rebuild describe nesting from the authoritative Vitest title paths. */
export function catalogTree(cases: ReadonlyArray<{ titlePath: string[] }>): CollectedFile {
  const nodes: CollectedNode[] = [];
  for (const item of cases) {
    let children = nodes;
    for (const title of item.titlePath.slice(0, -1)) {
      let group = children.find((node): node is CollectedGroup => node.kind === 'group' && node.title === title);
      if (!group) { group = { kind: 'group', title, children: [] }; children.push(group); }
      children = group.children;
    }
    const title = item.titlePath.at(-1);
    if (title !== undefined) children.push({ kind: 'test', title });
  }
  return { nodes };
}
