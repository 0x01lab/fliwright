// packages/fliwright-vscode/src/webview/viewer/components/LogsTab.tsx
import { useState } from 'react';
import type { FliwrightLogEvent } from '@fliwright/core';
import type { SerializableRun } from '../types.js';
import type { Selection } from '../artifacts.js';
import { formatClock } from '../format.js';
import { ScrollArea } from '../../components/ui/scroll-area.js';
import { Button } from '../../components/ui/button.js';
import { JsonTree } from './JsonTree.js';
import { cn } from '../../lib/utils.js';

const LEVEL_BORDER: Record<string, string> = {
  error: 'border-l-fail',
  warn: 'border-l-warn',
  info: 'border-l-info',
};

export function LogsTab({ run, selection }: { run: SerializableRun; selection: Selection }): JSX.Element {
  const [showAll, setShowAll] = useState(false);
  const scoped = selection.node ? selection.logs : [];
  const logs: FliwrightLogEvent[] = showAll ? run.logs : scoped;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center py-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        <span>{logs.length} event(s)</span>
        <Button variant="ghost" size="sm" className="ml-auto h-6" onClick={() => setShowAll(v => !v)}>
          {showAll ? 'Show scoped' : 'Show all'}
        </Button>
      </div>
      {run.logsTruncated && showAll ? (
        <div className="pb-1.5 text-[11px] text-muted-foreground">Showing last {run.logs.length} of {run.logsTotal} log events.</div>
      ) : null}

      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-1 p-1.5">
          {!logs.length ? (
            <div className="text-muted-foreground">
              {selection.node ? 'No log events for this step.' : 'No logs scoped — toggle “Show all”.'}
            </div>
          ) : (
            logs.map(l => <LogRow key={l.id} log={l} />)
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function LogRow({ log }: { log: FliwrightLogEvent }): JSX.Element {
  const border = LEVEL_BORDER[log.level] ?? 'border-l-muted-foreground';
  return (
    <div className={cn('rounded-r border-l-2 bg-card/40 px-2 py-1', border, (log.level === 'debug' || log.level === 'trace') && 'opacity-80')}>
      <div className="flex items-center gap-1.5">
        <span className="rounded bg-muted px-1 text-[9px] font-semibold uppercase text-muted-foreground">{log.kind}</span>
        <span className={cn('text-[9px] uppercase', log.level === 'error' ? 'text-fail' : 'text-muted-foreground')}>{log.level}</span>
        <span className="text-[10px] text-muted-foreground">{formatClock(log.timestamp)}</span>
        {log.durationMs != null ? <span className="ml-auto text-[10px] text-muted-foreground">{log.durationMs}ms</span> : null}
      </div>
      <div className="mt-0.5 whitespace-pre-wrap break-words text-[11px]">{log.message}</div>
      {log.error ? (
        <details className="mt-1">
          <summary className="cursor-pointer text-[10px] text-muted-foreground">error</summary>
          <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[10px] text-fail">
            {log.error.name ? `${log.error.name}: ` : ''}{log.error.message}{log.error.stack ? `\n${log.error.stack}` : ''}
          </pre>
        </details>
      ) : null}
      {log.data ? (
        <details className="mt-1">
          <summary className="cursor-pointer text-[10px] text-muted-foreground">data</summary>
          <div className="mt-1">
            <JsonTree data={log.data} query="" />
          </div>
        </details>
      ) : null}
    </div>
  );
}
