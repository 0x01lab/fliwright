// packages/fliwright-vscode/src/webview/viewer/components/DetailsTab.tsx
import type { Selection } from '../artifacts.js';
import { formatDuration, formatScalar, formatStamp, valueClass } from '../format.js';

interface DetailsTabProps {
  selection: Selection;
  onOpenSource: (file: string, line: number, column?: number) => void;
}

function Row({ label, value }: { label: string; value: unknown }): JSX.Element {
  const text = formatScalar(value);
  return (
    <div className="meta-row">
      <span className="meta-k">{label}</span>
      <span className={`meta-v ${valueClass(value)}`}>{text || '—'}</span>
    </div>
  );
}

export function DetailsTab({ selection, onOpenSource }: DetailsTabProps): JSX.Element {
  if (selection.step) {
    const s = selection.step;
    return (
      <div className="meta">
        <div className="meta-block">
          <Row label="Action" value={s.action} />
          <Row label="Selector" value={s.selector || '—'} />
          {s.argument !== undefined ? <Row label="Argument" value={s.argument} /> : null}
          <Row label="Status" value={s.status} />
          <Row label="Duration" value={`${s.durationMs}ms`} />
          <Row label="Time" value={formatStamp(s.timestamp)} />
        </div>
        <div className="meta-note">
          {s.widgetTree ? 'Widget snapshot attached — see Widget Tree tab.' : 'No widget snapshot for this action.'}
        </div>
      </div>
    );
  }

  const node = selection.node;
  if (!node) return <div className="tab-empty">No details.</div>;
  const md = node.metadata ?? {};
  const isAssertion = node.kind === 'assertion';

  return (
    <div className="meta">
      <div className="meta-block">
        <Row label="Kind" value={node.kind} />
        <Row label="Status" value={node.status} />
        {node.route ? <Row label="Route" value={node.route} /> : null}
        <Row label="Started" value={formatStamp(node.startedAt)} />
        <Row label="Duration" value={formatDuration(node.startedAt, node.endedAt, node.status)} />
        {node.codeRef?.file ? (
          <div className="meta-row">
            <span className="meta-k">Source</span>
            <button
              className="link-btn"
              onClick={() => onOpenSource(node.codeRef!.file, node.codeRef!.line, node.codeRef!.column)}
            >
              {node.codeRef.file}:{node.codeRef.line} ↗
            </button>
          </div>
        ) : null}
      </div>

      {isAssertion ? (
        <div className="meta-block">
          <div className="meta-title">Assertion</div>
          <Row label="Matcher" value={md.matcher} />
          <Row label="Target" value={md.target} />
          {md.negated ? <Row label="Negated" value={md.negated} /> : null}
          {md.expected !== undefined ? <Row label="Expected" value={md.expected} /> : null}
          {md.actual !== undefined ? <Row label="Actual" value={md.actual} /> : null}
        </div>
      ) : null}

      {Object.keys(md).length ? (
        <div className="meta-block">
          <div className="meta-title">Metadata</div>
          {Object.entries(md)
            .filter(([k]) => !isAssertion || !['matcher', 'target', 'expected', 'actual', 'negated'].includes(k))
            .map(([k, v]) => <Row key={k} label={k} value={v} />)}
        </div>
      ) : null}
    </div>
  );
}
