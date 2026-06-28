// packages/fliwright-vscode/src/webview/viewer/components/JsonTree.tsx
// Generic recursive JSON renderer. Collapsing uses native <details>/<summary>
// (stateless). A query filters the visible subtree to matches + ancestors and
// highlights matching leaf values. No assumptions about the JSON shape.

function formatPrimitive(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return `"${value}"`;
  if (typeof value === 'undefined') return 'undefined';
  return String(value);
}

function valueClass(value: unknown): string {
  if (value === null) return 'v-null';
  if (typeof value === 'boolean') return 'v-bool';
  if (typeof value === 'number') return 'v-number';
  if (typeof value === 'string') return 'v-string';
  return 'v-other';
}

function subtreeContainsMatch(value: unknown, name: string, query: string): boolean {
  if (name.toLowerCase().includes(query)) return true;
  if (value === null || typeof value !== 'object') {
    return formatPrimitive(value).toLowerCase().includes(query);
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (subtreeContainsMatch(v, k, query)) return true;
  }
  return false;
}

export function JsonTree({ data, query }: { data: unknown; query: string }): JSX.Element {
  const q = query.trim().toLowerCase();
  if (data === undefined || data === null) {
    return <div className="json-empty">No data</div>;
  }
  return (
    <div className="json-tree">
      <JsonNode name="" value={data} query={q} depth={0} />
    </div>
  );
}

function JsonNode(props: { name: string; value: unknown; query: string; depth: number }): JSX.Element {
  const { name, value, query, depth } = props;
  const isObject = value !== null && typeof value === 'object';

  if (!isObject) {
    const text = formatPrimitive(value);
    const match = query && (name.toLowerCase().includes(query) || text.toLowerCase().includes(query));
    return (
      <div className="json-row">
        {name ? <span className="json-key">{name}: </span> : null}
        <span className={`json-val ${valueClass(value)}${match ? ' match' : ''}`}>{text}</span>
      </div>
    );
  }

  const entries = Object.entries(value as Record<string, unknown>);
  const label = `${name ? name + ': ' : ''}${Array.isArray(value) ? `Array(${entries.length})` : `{${entries.length}}`}`;
  // With no query: expand the root only. With a query: expand any subtree that contains a match.
  const open = query ? subtreeContainsMatch(value, name, query) : depth === 0;

  return (
    <details open={open || undefined} className="json-node">
      <summary className="json-summary">{label}</summary>
      <div className="json-children">
        {entries.map(([k, v], i) => (
          <JsonNode key={`${k}-${i}`} name={k} value={v} query={query} depth={depth + 1} />
        ))}
      </div>
    </details>
  );
}
