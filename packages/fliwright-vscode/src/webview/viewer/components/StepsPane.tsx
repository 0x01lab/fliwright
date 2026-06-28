// packages/fliwright-vscode/src/webview/viewer/components/StepsPane.tsx
import React, { useEffect, useRef } from 'react';
import type { SerializableRun } from '../types.js';
import type { ListMode } from '../artifacts.js';
import type { FlatNode } from '../treeFlatten.js';

function statusGlyph(status: string): string {
  if (status === 'passed') return '✓';
  if (status === 'failed') return '✗';
  if (status === 'skipped') return '○';
  return '◐';
}

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
  const listRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLDivElement>(null);

  // Scroll the selected row into view when it changes.
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

  return (
    <div className="steps-pane">
      <div className="steps-toolbar">
        <div className="mode-toggle">
          <button
            className={mode === 'timeline' ? 'mode-btn active' : 'mode-btn'}
            onClick={() => props.onModeChange('timeline')}
          >Timeline</button>
          <button
            className={mode === 'actions' ? 'mode-btn active' : 'mode-btn'}
            disabled={!hasTrace}
            title={hasTrace ? 'Action trace' : 'No trace recorded (traceMode off)'}
            onClick={() => props.onModeChange('actions')}
          >Actions</button>
        </div>
        <input
          className="filter-input"
          type="search"
          placeholder="Filter…"
          value={filter}
          onChange={e => props.onFilter(e.target.value)}
        />
      </div>

      <div className="steps-list" ref={listRef} tabIndex={0} onKeyDown={onKeyDown}>
        {mode === 'timeline'
          ? renderTimeline(flatNodes, selectedKey, collapsed, selectedRef, props)
          : renderActions(run, selectedKey, selectedRef, props)}
        {!orderedKeys.length ? <div className="steps-empty">No matching items</div> : null}
      </div>
    </div>
  );
}

function renderTimeline(
  flat: FlatNode[],
  selectedKey: string | null,
  collapsed: Set<string>,
  selectedRef: { current: HTMLDivElement | null },
  props: StepsPaneProps,
): JSX.Element[] {
  return flat.map(f => {
    const isSelected = f.id === selectedKey;
    const isCollapsed = collapsed.has(f.id);
    const cls = `step-row${isSelected ? ' selected' : ''}${f.node.status === 'failed' ? ' failed' : ''}`;
    return (
      <div
        key={f.id}
        ref={isSelected ? selectedRef : undefined}
        className={cls}
        style={{ paddingLeft: 6 + f.depth * 14 }}
        onClick={() => props.onSelect(f.id)}
      >
        <span
          className={`arrow${f.hasChildren ? '' : ' placeholder'}`}
          onClick={f.hasChildren ? (e => { e.stopPropagation(); props.onToggle(f.id); }) : undefined}
        >{f.hasChildren ? (isCollapsed ? '▸' : '▾') : ''}</span>
        <span className={`dot ${f.node.status}`}>{statusGlyph(f.node.status)}</span>
        <span className="kind">{f.node.kind}</span>
        <span className="step-title">{f.node.title || f.id}</span>
        <span className="step-dur">{durationOf(f.node.startedAt, f.node.endedAt, f.node.status)}</span>
      </div>
    );
  });
}

function renderActions(
  run: SerializableRun,
  selectedKey: string | null,
  selectedRef: { current: HTMLDivElement | null },
  props: StepsPaneProps,
): JSX.Element[] {
  const steps = run.trace?.steps ?? [];
  return steps.map((s, i) => {
    const key = `trace:${i}`;
    const isSelected = key === selectedKey;
    const cls = `step-row${isSelected ? ' selected' : ''}${s.status === 'fail' ? ' failed' : ''}`;
    return (
      <div
        key={key}
        ref={isSelected ? selectedRef : undefined}
        className={cls}
        onClick={() => props.onSelect(key)}
      >
        <span className={`dot ${s.status === 'fail' ? 'failed' : 'passed'}`}>{s.status === 'fail' ? '✗' : '✓'}</span>
        <span className="kind">action</span>
        <span className="step-title">{s.action}</span>
        <span className="step-dur">{s.durationMs}ms</span>
      </div>
    );
  });
}
