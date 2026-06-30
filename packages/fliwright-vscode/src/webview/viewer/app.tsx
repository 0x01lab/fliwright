// packages/fliwright-vscode/src/webview/viewer/app.tsx
import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { SerializableRun, ViewerInbound, ViewerState } from './types.js';
import { vscode } from './host.js';
import { defaultSelectionKey, deriveSelection } from './artifacts.js';
import { visibleTimeline } from './treeFlatten.js';
import { RunStatusBar } from './components/RunStatusBar.js';
import { StepsPane } from './components/StepsPane.js';
import { Viewport } from './components/Viewport.js';
import { DetailTabs } from './components/DetailTabs.js';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '../components/ui/resizable.js';

const DEFAULT_STATE: ViewerState = {
  selectedKey: null,
  listMode: 'timeline',
  activeTab: 'details',
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
      <div className="flex h-screen flex-col items-center justify-center gap-2 text-center text-muted-foreground">
        <div className="text-4xl">🧪</div>
        <h3 className="text-base font-semibold text-foreground">Loading run…</h3>
        <div className="text-[11px]">If this persists, run tests with trace enabled and reopen the viewer.</div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col">
      <RunStatusBar run={run} />
      <ResizablePanelGroup
        direction="horizontal"
        autoSaveId="fliwright-viewer-panels"
        className="min-h-0 flex-1"
      >
        <ResizablePanel defaultSize={20} minSize={12} maxSize={36}>
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
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel defaultSize={55} minSize={28}>
          <Viewport
            run={run}
            selection={selection}
            orderedKeys={orderedKeys}
            flatNodes={flatNodes}
            onSelect={key => update({ selectedKey: key })}
          />
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel defaultSize={25} minSize={16} maxSize={44}>
          <DetailTabs
            run={run}
            selection={selection}
            activeTab={viewerState.activeTab}
            onTabChange={tab => update({ activeTab: tab })}
            onOpenSource={(file, line, column) => vscode.postMessage({ type: 'openSource', file, line, column })}
            onCopy={text => vscode.postMessage({ type: 'copy', text })}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(<ViewerApp />);
}
