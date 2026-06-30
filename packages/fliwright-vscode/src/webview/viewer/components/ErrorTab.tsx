// packages/fliwright-vscode/src/webview/viewer/components/ErrorTab.tsx
import type { ReactNode } from 'react';
import { Copy } from 'lucide-react';
import type { AgentVisibleFailure } from '@fliwright/core';
import type { Selection } from '../artifacts.js';
import { formatScalar } from '../format.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';

interface ErrorTabProps {
  selection: Selection;
  onCopy: (text: string) => void;
  onOpenSource: (file: string, line: number, column?: number) => void;
}

/** Serialize a failure into a markdown prompt for the tdd-repair flow. */
export function formatFailurePrompt(f: AgentVisibleFailure, title: string): string {
  const lines: string[] = [`# Failure: ${title}`, `- code: ${f.code}`, `- title: ${f.title}`, '', '## Message', f.message];
  const ac = f.actionContext;
  if (ac?.action || ac?.target !== undefined) {
    lines.push('', '## Action context');
    if (ac?.action) lines.push(`- action: ${ac.action}`);
    if (ac?.target !== undefined) lines.push(`- target: ${formatScalar(ac.target)}`);
    if (ac?.valueMasked) lines.push('- value: <masked>');
  }
  const st = f.appState;
  if (st && (st.route || st.screenshotPath || st.snapshotPath || st.diagnosticsPath)) {
    lines.push('', '## App state');
    if (st.route) lines.push(`- route: ${st.route}`);
    if (st.screenshotPath) lines.push(`- screenshot: ${st.screenshotPath}`);
    if (st.snapshotPath) lines.push(`- snapshot: ${st.snapshotPath}`);
    if (st.diagnosticsPath) lines.push(`- diagnostics: ${st.diagnosticsPath}`);
  }
  if (f.recoveryHints.length) {
    lines.push('', '## Recovery hints');
    for (const h of f.recoveryHints) lines.push(`- [${h.kind}] ${h.description}`);
  }
  return lines.join('\n');
}

function Block({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <div className="flex flex-col gap-[3px]">
      <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{title}</div>
      {children}
    </div>
  );
}

function Kv({ k, v }: { k: string; v: string }): JSX.Element {
  return (
    <div className="flex items-baseline gap-2 text-[11px]">
      <span className="min-w-[64px] text-muted-foreground">{k}</span>
      <code className="break-all font-mono">{v}</code>
    </div>
  );
}

export function ErrorTab({ selection, onCopy, onOpenSource }: ErrorTabProps): JSX.Element {
  const failure = selection.failure;
  if (!failure) {
    return <div className="text-muted-foreground">No failure recorded for this step.</div>;
  }
  const title = selection.node?.title ?? selection.step?.action ?? selection.key;
  const loc = failure.scriptLocation;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Badge variant="destructive">{failure.code}</Badge>
        <div className="ml-auto flex gap-2">
          {loc?.file ? (
            <Button variant="link" size="sm" className="h-auto gap-1 px-0 font-mono text-[11px]" onClick={() => onOpenSource(loc.file, loc.line, loc.column)}>
              {loc.file}:{loc.line} ↗
            </Button>
          ) : null}
          <Button variant="outline" size="sm" className="gap-1" onClick={() => onCopy(formatFailurePrompt(failure, title))}>
            <Copy /> Copy prompt
          </Button>
        </div>
      </div>
      <div className="text-[13px] font-semibold text-fail">{failure.title}</div>
      <pre className="whitespace-pre-wrap break-words rounded border border-fail/20 bg-fail/[0.06] p-2 font-mono text-[11px] text-fail">{failure.message}</pre>

      {failure.actionContext ? (
        <Block title="Action context">
          {failure.actionContext.action ? <Kv k="action" v={failure.actionContext.action} /> : null}
          {failure.actionContext.target !== undefined ? <Kv k="target" v={formatScalar(failure.actionContext.target)} /> : null}
          {failure.actionContext.valueMasked ? <Kv k="value" v="<masked>" /> : null}
        </Block>
      ) : null}

      {failure.appState && (failure.appState.route || failure.appState.screenshotPath) ? (
        <Block title="App state">
          {failure.appState.route ? <Kv k="route" v={failure.appState.route} /> : null}
          {failure.appState.screenshotPath ? <Kv k="screenshot" v={failure.appState.screenshotPath} /> : null}
        </Block>
      ) : null}

      {failure.recoveryHints.length ? (
        <Block title="Recovery hints">
          {failure.recoveryHints.map((h, i) => (
            <div key={i} className="flex items-baseline gap-1.5 py-0.5 text-[11px]">
              <Badge variant="secondary" className="shrink-0">{h.kind}</Badge>
              <span>{h.description}</span>
            </div>
          ))}
        </Block>
      ) : null}
    </div>
  );
}
