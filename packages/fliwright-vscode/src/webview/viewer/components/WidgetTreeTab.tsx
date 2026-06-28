// packages/fliwright-vscode/src/webview/viewer/components/WidgetTreeTab.tsx
import { useEffect, useState } from 'react';
import type { ViewerInbound } from '../types.js';
import type { Selection } from '../artifacts.js';
import { vscode } from '../host.js';
import { JsonTree } from './JsonTree.js';

// Per-path snapshot cache for the lifetime of the webview.
const snapshotCache = new Map<string, unknown>();

export function WidgetTreeTab({ selection }: { selection: Selection }): JSX.Element {
  const [query, setQuery] = useState('');
  const inline = selection.step?.widgetTree;
  const path = selection.snapshotPath;
  const [fetched, setFetched] = useState<{ path: string; data: unknown } | null>(null);

  // Action steps carry the widget tree inline; timeline snapshots are fetched
  // lazily from the host (keeps the initial run payload lean).
  useEffect(() => {
    if (inline !== undefined || !path) { setFetched(null); return; }
    if (snapshotCache.has(path)) { setFetched({ path, data: snapshotCache.get(path) }); return; }
    setFetched(null);
    const onMsg = (e: MessageEvent<ViewerInbound>) => {
      const m = e.data;
      if (m?.type === 'snapshot' && m.path === path) {
        snapshotCache.set(path, m.data);
        setFetched({ path, data: m.data });
      }
    };
    window.addEventListener('message', onMsg);
    vscode.postMessage({ type: 'requestSnapshot', path });
    return () => window.removeEventListener('message', onMsg);
  }, [inline, path]);

  const data = inline !== undefined ? inline : (fetched && fetched.path === path ? fetched.data : undefined);

  return (
    <div className="widget-tab">
      <input
        className="filter-input"
        type="search"
        placeholder="Search tree…"
        value={query}
        onChange={e => setQuery(e.target.value)}
      />
      {data === undefined || data === null ? (
        <div className="tab-empty">No widget snapshot captured for this step.</div>
      ) : (
        <JsonTree data={data} query={query} />
      )}
    </div>
  );
}
