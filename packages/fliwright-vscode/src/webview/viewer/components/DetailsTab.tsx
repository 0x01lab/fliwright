// packages/fliwright-vscode/src/webview/viewer/components/DetailsTab.tsx
import type { ReactNode } from 'react';
import type { Selection } from '../artifacts.js';
import { formatDuration, formatScalar, formatStamp, valueClass } from '../format.js';
import { Button } from '../../components/ui/button.js';

interface DetailsTabProps {
  selection: Selection;
  onOpenSource: (file: string, line: number, column?: number) => void;
}

function Row({ label, value }: { label: string; value: unknown }): JSX.Element {
  const text = formatScalar(value);
  return (
    <div className="flex items-baseline gap-2 text-[11px]">
      <span className="min-w-[78px] shrink-0 text-muted-foreground">{label}</span>
      <span className={`break-all font-mono ${valueClass(value)}`}>{text || '—'}</span>
    </div>
  );
}

function Block({ title, children }: { title?: string; children: ReactNode }): JSX.Element {
  return (
    <div className="flex flex-col gap-[3px]">
      {title ? <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{title}</div> : null}
      {children}
    </div>
  );
}

export function DetailsTab({ selection, onOpenSource }: DetailsTabProps): JSX.Element {
  if (selection.step) {
    const s = selection.step;
    return (
      <div className="flex flex-col gap-3.5">
        <Block>
          <Row label="Action" value={s.action} />
          <Row label="Selector" value={s.selector || '—'} />
          {s.argument !== undefined ? <Row label="Argument" value={s.argument} /> : null}
          <Row label="Status" value={s.status} />
          <Row label="Duration" value={`${s.durationMs}ms`} />
          <Row label="Time" value={formatStamp(s.timestamp)} />
        </Block>
        <div className="text-[11px] text-muted-foreground">
          {s.widgetTree ? 'Widget snapshot attached — see Widget Tree tab.' : 'No widget snapshot for this action.'}
        </div>
      </div>
    );
  }

  const node = selection.node;
  if (!node) return <div className="text-muted-foreground">No details.</div>;
  const md = node.metadata ?? {};
  const isAssertion = node.kind === 'assertion';

  return (
    <div className="flex flex-col gap-3.5">
      <Block>
        <Row label="Kind" value={node.kind} />
        <Row label="Status" value={node.status} />
        {node.route ? <Row label="Route" value={node.route} /> : null}
        <Row label="Started" value={formatStamp(node.startedAt)} />
        <Row label="Duration" value={formatDuration(node.startedAt, node.endedAt, node.status)} />
        {node.codeRef?.file ? (
          <div className="flex items-baseline gap-2 text-[11px]">
            <span className="min-w-[78px] shrink-0 text-muted-foreground">Source</span>
            <Button
              variant="link"
              size="sm"
              className="h-auto gap-1 px-0 font-mono text-[11px]"
              onClick={() => onOpenSource(node.codeRef!.file, node.codeRef!.line, node.codeRef!.column)}
            >
              {node.codeRef.file}:{node.codeRef.line} ↗
            </Button>
          </div>
        ) : null}
      </Block>

      {isAssertion ? (
        <Block title="Assertion">
          <Row label="Matcher" value={md.matcher} />
          <Row label="Target" value={md.target} />
          {md.negated ? <Row label="Negated" value={md.negated} /> : null}
          {md.expected !== undefined ? <Row label="Expected" value={md.expected} /> : null}
          {md.actual !== undefined ? <Row label="Actual" value={md.actual} /> : null}
        </Block>
      ) : null}

      {Object.keys(md).length ? (
        <Block title="Metadata">
          {Object.entries(md)
            .filter(([k]) => !isAssertion || !['matcher', 'target', 'expected', 'actual', 'negated'].includes(k))
            .map(([k, v]) => <Row key={k} label={k} value={v} />)}
        </Block>
      ) : null}
    </div>
  );
}
