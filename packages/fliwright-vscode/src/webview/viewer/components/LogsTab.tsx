// packages/fliwright-vscode/src/webview/viewer/components/LogsTab.tsx
import { useState } from 'react';
import type { FliwrightLogEvent } from '@fliwright/core';
import type { SerializableRun } from '../types.js';
import type { Selection } from '../artifacts.js';
import { formatClock } from '../format.js';
import { JsonTree } from './JsonTree.js';

export function LogsTab({ run, selection }: { run: SerializableRun; selection: Selection }): JSX.Element {
  const [showAll, setShowAll] = useState(false);
  const scoped = selection.node ? selection.logs : [];
  const logs: FliwrightLogEvent[] = showAll ? run.logs : scoped;

  return (
    <div className="logs-tab">
      <div className="logs-head">
        <span>{logs.length} event(s)</span>
        <button className={`toggle-btn${showAll ? ' active' : ''}`} onClick={() => setShowAll(v => !v)}>
          {showAll ? 'Show scoped' : 'Show all'}
        </button>
      </div>
      {run.logsTruncated && showAll ? (
        <div className="logs-note">Showing last {run.logs.length} of {run.logsTotal} log events.</div>
      ) : null}

      <div className="logs-list">
        {!logs.length ? (
          <div className="tab-empty">
            {selection.node ? 'No log events for this step.' : 'No logs scoped — toggle “Show all”.'}
          </div>
        ) : (
          logs.map(l => <LogRow key={l.id} log={l} />)
        )}
      </div>
    </div>
  );
}

function LogRow({ log }: { log: FliwrightLogEvent }): JSX.Element {
  return (
    <div className={`log ${log.level}`}>
      <div className="log-top">
        <span className="log-kind">{log.kind}</span>
        <span className={`log-level ${log.level}`}>{log.level}</span>
        <span className="log-time">{formatClock(log.timestamp)}</span>
        {log.durationMs != null ? <span className="log-dur">{log.durationMs}ms</span> : null}
      </div>
      <div className="log-msg">{log.message}</div>
      {log.error ? (
        <details className="log-data">
          <summary>error</summary>
          <pre className="log-stack">{log.error.name ? `${log.error.name}: ` : ''}{log.error.message}{log.error.stack ? `\n${log.error.stack}` : ''}</pre>
        </details>
      ) : null}
      {log.data ? (
        <details className="log-data">
          <summary>data</summary>
          <JsonTree data={log.data} query="" />
        </details>
      ) : null}
    </div>
  );
}
