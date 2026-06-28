// packages/fliwright-vscode/src/webview/viewer/app.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import type { SerializableRun, ViewerInbound, ViewerState } from './types.js';
import { vscode } from './host.js';
import { defaultSelectionKey, deriveSelection } from './artifacts.js';
import { visibleTimeline } from './treeFlatten.js';
import { RunStatusBar } from './components/RunStatusBar.js';
import { StepsPane } from './components/StepsPane.js';
import { Viewport } from './components/Viewport.js';
import { DetailTabs } from './components/DetailTabs.js';

const DEFAULT_STATE: ViewerState = {
  selectedKey: null,
  listMode: 'timeline',
  activeTab: 'details',
  stepsWidth: 280,
  detailWidth: 360,
  filter: '',
};

function ViewerApp(): JSX.Element {
  const [run, setRun] = useState<SerializableRun | null>(null);
  const [viewerState, setViewerState] = useState<ViewerState>(
    () => vscode.getState<ViewerState>() ?? DEFAULT_STATE,
  );
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  // Ready handshake: tell the host we're mounted so it (re)sends the run.
  useEffect(() => {
    const onMessage = (event: MessageEvent<ViewerInbound>) => {
      if (event.data.type === 'run') setRun(event.data.run);
    };
    window.addEventListener('message', onMessage);
    vscode.postMessage({ type: 'ready' });
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // Persist layout/selection state on every change.
  useEffect(() => {
    vscode.setState(viewerState);
  }, [viewerState]);

  const update = (patch: Partial<ViewerState>): void => setViewerState(s => ({ ...s, ...patch }));

  const flatNodes = useMemo(
    () => (run ? visibleTimeline(run.timeline.nodes, collapsed, viewerState.filter) : []),
    [run, collapsed, viewerState.filter],
  );

  const orderedKeys = useMemo<string[]>(() => {
    if (!run) return [];
    if (viewerState.listMode === 'timeline') return flatNodes.map(f => f.id);
    return (run.trace?.steps ?? []).map((_, i) => `trace:${i}`);
  }, [run, viewerState.listMode, flatNodes]);

  // Effective selection: stored key if still valid, else the default (first
  // failed / last). Derived rather than mutated to avoid effect loops.
  const selectedKey = useMemo<string | null>(() => {
    if (!run) return null;
    if (viewerState.selectedKey && orderedKeys.includes(viewerState.selectedKey)) return viewerState.selectedKey;
    return defaultSelectionKey(run, viewerState.listMode);
  }, [run, viewerState.selectedKey, orderedKeys, viewerState.listMode]);

  const selection = useMemo(
    () => (run ? deriveSelection(run, selectedKey, viewerState.listMode) : undefined),
    [run, selectedKey, viewerState.listMode],
  );

  if (!run) {
    return (
      <div className="viewer-shell">
        <div className="viewer-empty">
          <div className="viewer-empty-icon">🧪</div>
          <h3>Loading run…</h3>
          <div>If this persists, run tests with trace enabled and reopen the viewer.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="viewer-shell">
      <RunStatusBar run={run} />
      <div
        className="viewer-body"
        style={{ gridTemplateColumns: `${viewerState.stepsWidth}px 6px 1fr 6px ${viewerState.detailWidth}px` }}
      >
        <StepsPane
          run={run}
          mode={viewerState.listMode}
          flatNodes={flatNodes}
          orderedKeys={orderedKeys}
          selectedKey={selectedKey}
          collapsed={collapsed}
          filter={viewerState.filter}
          onSelect={key => update({ selectedKey: key })}
          onToggle={id => setCollapsed(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
          })}
          onFilter={text => update({ filter: text })}
          onModeChange={mode => update({ listMode: mode })}
        />
        <Divider orientation="h" onDelta={delta => update({ stepsWidth: clamp(viewerState.stepsWidth + delta, 180, 520) })} />
        <Viewport
          run={run}
          selection={selection}
          orderedKeys={orderedKeys}
          flatNodes={flatNodes}
          onSelect={key => update({ selectedKey: key })}
        />
        <Divider orientation="h" onDelta={delta => update({ detailWidth: clamp(viewerState.detailWidth - delta, 260, 640) })} />
        <DetailTabs
          run={run}
          selection={selection}
          activeTab={viewerState.activeTab}
          onTabChange={tab => update({ activeTab: tab })}
          onOpenSource={(file, line, column) => vscode.postMessage({ type: 'openSource', file, line, column })}
          onCopy={text => vscode.postMessage({ type: 'copy', text })}
        />
      </div>
    </div>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function Divider(props: { orientation: 'h'; onDelta: (delta: number) => void }): JSX.Element {
  const startX = useRef<number | null>(null);
  const onDown = (e: React.MouseEvent): void => {
    e.preventDefault();
    startX.current = e.clientX;
    const onMove = (ev: MouseEvent): void => {
      if (startX.current == null) return;
      props.onDelta(ev.clientX - startX.current);
      startX.current = ev.clientX;
    };
    const onUp = (): void => {
      startX.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.classList.remove('resizing');
    };
    document.body.classList.add('resizing');
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  return <div className={`divider ${props.orientation}`} onMouseDown={onDown} />;
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(<ViewerApp />);
}
