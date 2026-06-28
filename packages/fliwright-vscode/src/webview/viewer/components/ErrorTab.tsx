// packages/fliwright-vscode/src/webview/viewer/components/ErrorTab.tsx
import type { AgentVisibleFailure } from '@fliwright/core';
import type { Selection } from '../artifacts.js';
import { formatScalar } from '../format.js';

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

export function ErrorTab({ selection, onCopy, onOpenSource }: ErrorTabProps): JSX.Element {
  const failure = selection.failure;
  if (!failure) {
    return <div className="tab-empty">No failure recorded for this step.</div>;
  }
  const title = selection.node?.title ?? selection.step?.action ?? selection.key;
  const loc = failure.scriptLocation;

  return (
    <div className="error-tab">
      <div className="error-head">
        <span className="err-code">{failure.code}</span>
        <div className="error-actions">
          {loc?.file ? (
            <button className="link-btn" onClick={() => onOpenSource(loc.file, loc.line, loc.column)}>
              {loc.file}:{loc.line} ↗
            </button>
          ) : null}
          <button className="ghost-btn" onClick={() => onCopy(formatFailurePrompt(failure, title))}>
            Copy prompt
          </button>
        </div>
      </div>
      <div className="error-title">{failure.title}</div>
      <pre className="error-msg">{failure.message}</pre>

      {failure.actionContext ? (
        <div className="meta-block">
          <div className="meta-title">Action context</div>
          {failure.actionContext.action ? <div className="kv"><span>action</span><code>{failure.actionContext.action}</code></div> : null}
          {failure.actionContext.target !== undefined ? <div className="kv"><span>target</span><code>{formatScalar(failure.actionContext.target)}</code></div> : null}
          {failure.actionContext.valueMasked ? <div className="kv"><span>value</span><code>&lt;masked&gt;</code></div> : null}
        </div>
      ) : null}

      {failure.appState && (failure.appState.route || failure.appState.screenshotPath) ? (
        <div className="meta-block">
          <div className="meta-title">App state</div>
          {failure.appState.route ? <div className="kv"><span>route</span><code>{failure.appState.route}</code></div> : null}
          {failure.appState.screenshotPath ? <div className="kv"><span>screenshot</span><code>{failure.appState.screenshotPath}</code></div> : null}
        </div>
      ) : null}

      {failure.recoveryHints.length ? (
        <div className="meta-block">
          <div className="meta-title">Recovery hints</div>
          {failure.recoveryHints.map((h, i) => (
            <div className="hint" key={i}>
              <span className="hint-kind">{h.kind}</span>
              <span>{h.description}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
