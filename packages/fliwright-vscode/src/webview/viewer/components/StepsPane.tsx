// packages/fliwright-vscode/src/webview/viewer/components/StepsPane.tsx
import React, { useEffect, useRef } from 'react';
import type { SerializableRun } from '../types.js';
import type { ListMode } from '../artifacts.js';
import type { FlatNode } from '../treeFlatten.js';
import { Input } from '../../components/ui/input.js';
import { ScrollArea } from '../../components/ui/scroll-area.js';
import { cn } from '../../lib/utils.js';

function statusGlyph(status: string): string {
  if (status === 'passed') return '✓';
  if (status === 'failed') return '✗';
  if (status === 'skipped') return '○';
  return '◐';
}

const DOT_BG: Record<string, string> = {
  passed: 'bg-pass',
  failed: 'bg-fail',
  skipped: 'bg-muted-foreground',
  running: 'bg-info',
};

function durationOf(startedAt?: string, endedAt?: string, status?: string): string {
  if (!startedAt) return '';
  const start = Date.parse(startedAt);
  if (!start) return '';
  const end = endedAt ? Date.parse(endedAt) : NaN;
  if (!end) return status === 'running' ? '…' : '';
  const ms = end - start;
  if (!isFinite(ms) || ms < 0) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

interface StepsPaneProps {
  run: SerializableRun;
  mode: ListMode;
  flatNodes: FlatNode[];
  orderedKeys: string[];
  selectedKey: string | null;
  collapsed: Set<string>;
  filter: string;
  onSelect: (key: string) => void;
  onToggle: (id: string) => void;
  onFilter: (text: string) => void;
  onModeChange: (mode: ListMode) => void;
}

export function StepsPane(props: StepsPaneProps): JSX.Element {
  const { run, mode, flatNodes, orderedKeys, selectedKey, collapsed, filter } = props;
  const selectedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedKey]);

  const move = (delta: number): void => {
    if (!orderedKeys.length) return;
    const idx = selectedKey ? orderedKeys.indexOf(selectedKey) : -1;
    const next = Math.min(Math.max(idx + delta, 0), orderedKeys.length - 1);
    const key = orderedKeys[next];
    if (key) props.onSelect(key);
  };

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && mode === 'timeline' && selectedKey) {
      e.preventDefault();
      props.onToggle(selectedKey);
    }
  };

  const hasTrace = !!run.trace;
  const steps = run.trace?.steps ?? [];

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden bg-card">
      <div className="flex shrink-0 flex-col gap-1.5 border-b border-border p-2">
        <div className="flex overflow-hidden rounded-md border border-border">
          <button
            className={cn('flex-1 px-2 py-1 text-[11px]', mode === 'timeline' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent')}
            onClick={() => props.onModeChange('timeline')}
          >Timeline</button>
          <button
            className={cn('flex-1 px-2 py-1 text-[11px] disabled:opacity-40', mode === 'actions' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent')}
            disabled={!hasTrace}
            title={hasTrace ? 'Action trace' : 'No trace recorded (traceMode off)'}
            onClick={() => props.onModeChange('actions')}
          >Actions</button>
        </div>
        <Input type="search" placeholder="Filter…" value={filter} onChange={e => props.onFilter(e.target.value)} />
      </div>

      <ScrollArea className="flex-1">
        <div tabIndex={0} onKeyDown={onKeyDown} className="p-1 outline-none">
          {mode === 'timeline'
            ? flatNodes.map(f => {
                const isSelected = f.id === selectedKey;
                const isCollapsed = collapsed.has(f.id);
                return (
                  <div
                    key={f.id}
                    ref={isSelected ? selectedRef : undefined}
                    onClick={() => props.onSelect(f.id)}
                    style={{ paddingLeft: 6 + f.depth * 14 }}
                    className={cn(
                      'group flex cursor-pointer items-center gap-1.5 rounded-sm py-[3px] pr-2 leading-tight whitespace-nowrap',
                      isSelected ? 'bg-primary text-primary-foreground' : 'hover:bg-accent',
                      !isSelected && f.node.status === 'failed' && 'bg-fail/[0.07]',
                    )}
                  >
                    <span
                      className={cn('w-3 shrink-0 text-center text-[10px]', isSelected ? 'text-primary-foreground' : 'text-muted-foreground')}
                      onClick={f.hasChildren ? (e => { e.stopPropagation(); props.onToggle(f.id); }) : undefined}
                    >{f.hasChildren ? (isCollapsed ? '▸' : '▾') : ''}</span>
                    <span className={cn('flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-full text-[9px] text-white', DOT_BG[f.node.status] ?? 'bg-muted-foreground')}>
                      {statusGlyph(f.node.status)}
                    </span>
                    <span className={cn('shrink-0 rounded px-1 text-[9px] font-semibold uppercase tracking-wide', isSelected ? 'bg-white/20' : 'bg-muted text-muted-foreground')}>
                      {f.node.kind}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{f.node.title || f.id}</span>
                    <span className={cn('shrink-0 text-[10px]', isSelected ? 'opacity-80' : 'text-muted-foreground')}>
                      {durationOf(f.node.startedAt, f.node.endedAt, f.node.status)}
                    </span>
                  </div>
                );
              })
            : steps.map((s, i) => {
                const key = `trace:${i}`;
                const isSelected = key === selectedKey;
                const isFail = s.status === 'fail';
                return (
                  <div
                    key={key}
                    ref={isSelected ? selectedRef : undefined}
                    onClick={() => props.onSelect(key)}
                    className={cn(
                      'flex cursor-pointer items-center gap-1.5 rounded-sm px-2 py-[3px] leading-tight whitespace-nowrap',
                      isSelected ? 'bg-primary text-primary-foreground' : 'hover:bg-accent',
                      !isSelected && isFail && 'bg-fail/[0.07]',
                    )}
                  >
                    <span className={cn('flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-full text-[9px] text-white', isFail ? 'bg-fail' : 'bg-pass')}>
                      {isFail ? '✗' : '✓'}
                    </span>
                    <span className={cn('shrink-0 rounded px-1 text-[9px] font-semibold uppercase tracking-wide', isSelected ? 'bg-white/20' : 'bg-muted text-muted-foreground')}>action</span>
                    <span className="min-w-0 flex-1 truncate">{s.action}</span>
                    <span className={cn('shrink-0 text-[10px]', isSelected ? 'opacity-80' : 'text-muted-foreground')}>{s.durationMs}ms</span>
                  </div>
                );
              })}
          {!orderedKeys.length ? <div className="px-2 py-4 text-center text-muted-foreground">No matching items</div> : null}
        </div>
      </ScrollArea>
    </div>
  );
}
