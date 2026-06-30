// packages/fliwright-vscode/src/webview/viewer/components/JsonTree.tsx
// Generic recursive JSON renderer. Collapsing uses native <details>/<summary>
// (stateless). A query filters the visible subtree to matches + ancestors and
// highlights matching leaf values. No assumptions about the JSON shape.

import { formatScalar, valueClass } from '../format.js';
import { cn } from '../../lib/utils.js';

function subtreeContainsMatch(value: unknown, name: string, query: string): boolean {
  if (name.toLowerCase().includes(query)) return true;
  if (value === null || typeof value !== 'object') {
    return formatScalar(value).toLowerCase().includes(query);
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (subtreeContainsMatch(v, k, query)) return true;
  }
  return false;
}

export function JsonTree({ data, query }: { data: unknown; query: string }): JSX.Element {
  const q = query.trim().toLowerCase();
  if (data === undefined || data === null) {
    return <div className="text-muted-foreground">No data</div>;
  }
  return (
    <div className="font-mono text-[11px] leading-relaxed">
      <JsonNode name="" value={data} query={q} depth={0} />
    </div>
  );
}

function JsonNode(props: { name: string; value: unknown; query: string; depth: number }): JSX.Element {
  const { name, value, query, depth } = props;
  const isObject = value !== null && typeof value === 'object';

  if (!isObject) {
    const text = formatScalar(value);
    const match = query && (name.toLowerCase().includes(query) || text.toLowerCase().includes(query));
    return (
      <div className="pl-3">
        {name ? <span className="text-value-key">{name}: </span> : null}
        <span className={cn('break-all', valueClass(value), match && 'rounded bg-match')}>{text}</span>
      </div>
    );
  }

  const entries = Object.entries(value as Record<string, unknown>);
  const label = `${name ? name + ': ' : ''}${Array.isArray(value) ? `Array(${entries.length})` : `{${entries.length}}`}`;
  const open = query ? subtreeContainsMatch(value, name, query) : depth === 0;

  return (
    <details open={open || undefined} className="pl-3">
      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">{label}</summary>
      <div>
        {entries.map(([k, v], i) => (
          <JsonNode key={`${k}-${i}`} name={k} value={v} query={query} depth={depth + 1} />
        ))}
      </div>
    </details>
  );
}
