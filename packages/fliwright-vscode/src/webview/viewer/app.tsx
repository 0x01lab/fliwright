import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ChevronLeft, ChevronRight, CircleAlert, Pause, Play } from 'lucide-react';
import { buildTimelineTimeAxis, orderedTimelineNodes } from '@fliwright/core/timeline';
import type { SerializableRun, ViewerInbound, ViewerState } from './types.js';
import { vscode } from './host.js';
import { defaultSelectionKey, deriveSelection, neighborKeys, screenshotsForNode, timelineNodeForKey } from './artifacts.js';
import { visibleTimeline } from './treeFlatten.js';
import { RunStatusBar } from './components/RunStatusBar.js';
import { StepsPane } from './components/StepsPane.js';
import { Viewport } from './components/Viewport.js';
import { DetailTabs } from './components/DetailTabs.js';
import { ExecutionTimeline } from './components/ExecutionTimeline.js';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '../components/ui/resizable.js';
import { Button } from '../components/ui/button.js';
import { BrandMark } from '../components/BrandMark.js';

const DEFAULT_STATE: ViewerState = {
  selectedKey: null, listMode: 'timeline', activeTab: 'details', filter: '',
  screenshotIndex: 0, screenshotMode: 'failed', zoom: 1, speed: 1,
};
const runIdentity = (run: SerializableRun) => `${run.runId}:${run.timeline.runId}:${run.timeline.testName}:${run.timeline.startedAt}`;

export function ViewerApp(): JSX.Element {
  const [run, setRun] = useState<SerializableRun | null>(null);
  const [generatingReport, setGeneratingReport] = useState(false);
  const [viewerState, setViewerState] = useState<ViewerState>(() => ({ ...DEFAULT_STATE, ...vscode.getState<ViewerState>() }));
  const identity = useRef(viewerState.runId);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [playing, setPlaying] = useState(false);
  const [cursorToken, setCursorToken] = useState(0);
  const [stacked, setStacked] = useState(false);
  const content = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onMessage = (event: MessageEvent<ViewerInbound>) => {
      if (event.data.type === 'run') {
        const next = event.data.run;
        if (identity.current !== runIdentity(next)) {
          identity.current = runIdentity(next);
          setPlaying(false);
          setCollapsed(new Set());
          setCursorToken(token => token + 1);
          setViewerState(state => ({ ...state, runId: identity.current, selectedKey: null, screenshotIndex: 0, filter: '' }));
        }
        setRun(next);
      }
      if (event.data.type === 'reportState') setGeneratingReport(event.data.generating);
    };
    window.addEventListener('message', onMessage);
    vscode.postMessage({ type: 'ready' });
    return () => window.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => { vscode.setState(viewerState); }, [viewerState]);
  useEffect(() => {
    if (!content.current) return;
    const element = content.current;
    const measure = () => setStacked(element.clientWidth > 0 && element.clientWidth < 620);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [!!run]);

  const update = (patch: Partial<ViewerState>): void => setViewerState(state => ({ ...state, ...patch }));
  const flatNodes = useMemo(() => run ? visibleTimeline(run.timeline.nodes, collapsed, viewerState.filter) : [], [run, collapsed, viewerState.filter]);
  const allKeys = useMemo(() => !run ? [] : viewerState.listMode === 'timeline'
    ? orderedTimelineNodes(run.timeline.nodes).map(row => row.node.id)
    : (run.trace?.steps ?? []).map((_, i) => `trace:${i}`), [run, viewerState.listMode]);
  const visibleKeys = viewerState.listMode === 'timeline' ? flatNodes.map(row => row.id) : allKeys;
  const selectedKey = run && viewerState.selectedKey && allKeys.includes(viewerState.selectedKey)
    ? viewerState.selectedKey : run ? defaultSelectionKey(run, viewerState.listMode) : null;
  const selection = useMemo(() => run ? deriveSelection(run, selectedKey, viewerState.listMode, viewerState.screenshotIndex) : undefined,
    [run, selectedKey, viewerState.listMode, viewerState.screenshotIndex]);
  const axis = useMemo(() => run ? buildTimelineTimeAxis(run.timeline.nodes, run.timeline) : undefined, [run]);
  const screenshots = useMemo(() => (node: SerializableRun['timeline']['nodes'][number]) => run ? screenshotsForNode(run, node) : [], [run]);

  // Reveal any selected timeline node without letting search/collapse invalidate selection.
  const reveal = (id: string): void => {
    if (!run) return;
    const parents = new Set<string>();
    let parent = run.timeline.nodes.find(node => node.id === id)?.parentId;
    while (parent && !parents.has(parent)) {
      parents.add(parent);
      parent = run.timeline.nodes.find(node => node.id === parent)?.parentId;
    }
    setCollapsed(previous => new Set([...previous].filter(key => !parents.has(key))));
  };
  const chooseKey = (key: string): void => {
    setPlaying(false);
    setCursorToken(token => token + 1);
    update({ selectedKey: key, screenshotIndex: 0, filter: '' });
    if (viewerState.listMode === 'timeline') reveal(key);
  };
  const chooseNode = (id: string, screenshotIndex = 0): void => {
    if (!run) return;
    const operationId = run.timeline.nodes.find(node => node.id === id)?.metadata?.operationId;
    const actionIndex = operationId ? run.trace?.steps.findIndex(step => step.operationId === operationId) ?? -1 : -1;
    const mode = viewerState.listMode === 'actions' && actionIndex >= 0 ? 'actions' : 'timeline';
    update({ selectedKey: mode === 'actions' ? `trace:${actionIndex}` : id, listMode: mode, screenshotIndex, filter: '' });
    reveal(id);
  };

  if (!run) return <div className="flex h-screen flex-col items-center justify-center gap-2 text-center text-muted-foreground">
    <BrandMark thinking className="mb-2 size-20" /><h3 className="text-base font-semibold text-foreground">Loading run…</h3>
    <div className="text-[11px]">If this persists, run tests with trace enabled and reopen the viewer.</div>
  </div>;

  const selectedNode = timelineNodeForKey(run, selectedKey, viewerState.listMode);
  const timedSelection = axis?.entries.some(entry => entry.node.id === selectedNode?.id);
  const neighbors = neighborKeys(allKeys, selectedKey);
  const failureId = run.timeline.nodes.find(node => node.status === 'failed')?.id;
  const selectMode = (mode: ViewerState['listMode']): void => {
    setPlaying(false);
    setCursorToken(token => token + 1);
    let key: string | null = null;
    if (mode === 'timeline') key = selectedNode?.id ?? null;
    else if (selectedNode?.metadata?.operationId) {
      const index = run.trace?.steps.findIndex(step => step.operationId === selectedNode.metadata?.operationId) ?? -1;
      if (index >= 0) key = `trace:${index}`;
    }
    update({ listMode: mode, selectedKey: key, screenshotIndex: 0, filter: '' });
    if (mode === 'timeline' && key) reveal(key);
  };

  return <div className="flex h-screen flex-col">
    <RunStatusBar run={run} generatingReport={generatingReport} onGenerateReport={() => vscode.postMessage({ type: 'generateReport' })} />
    <ResizablePanelGroup direction="horizontal" autoSaveId="fliwright-viewer-timeline-panels" className="min-h-0 flex-1">
      <ResizablePanel defaultSize={20} minSize={12} maxSize={36}>
        <StepsPane run={run} mode={viewerState.listMode} flatNodes={flatNodes} orderedKeys={visibleKeys} selectedKey={selectedKey}
          collapsed={collapsed} filter={viewerState.filter} onSelect={chooseKey}
          onToggle={id => setCollapsed(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; })}
          onFilter={filter => { setPlaying(false); update({ filter }); }} onModeChange={selectMode} />
      </ResizablePanel>
      <ResizableHandle aria-label="调整步骤列表与回放区域大小" />
      <ResizablePanel defaultSize={80} minSize={50}>
        <div className="flex h-full min-h-0 min-w-0 flex-col" ref={content}>
          {viewerState.listMode === 'actions' && !selectedNode && <p className="shrink-0 px-3 py-1 text-[11px] text-muted-foreground">此动作缺少可关联的时间记录，可在 Actions 中查看已有证据。</p>}
          <ResizablePanelGroup direction="vertical" autoSaveId="fliwright-viewer-timeline-evidence" className="min-h-0 flex-1">
            <ResizablePanel defaultSize={35} minSize={20} maxSize={70}>
              <ExecutionTimeline key={runIdentity(run)} nodes={run.timeline.nodes} bounds={run.timeline}
                selectedId={selectedNode?.id} selectedScreenshotIndex={viewerState.screenshotIndex ?? 0}
                resetCursorToken={cursorToken} screenshots={screenshots}
                zoom={viewerState.zoom ?? 1} onZoomChange={zoom => update({ zoom })}
                screenshotMode={viewerState.screenshotMode ?? 'failed'} onScreenshotModeChange={screenshotMode => update({ screenshotMode })}
                onSelect={(id, imageIndex) => { setPlaying(false); chooseNode(id, imageIndex); }}
                playback={{ playing, speed: viewerState.speed ?? 1, onSelect: chooseNode, onPause: () => setPlaying(false), onEnd: () => setPlaying(false) }}
                controls={<>
                  <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 [&_svg]:size-3" aria-label="上一步" title="上一步" disabled={!neighbors.prev} onClick={() => neighbors.prev && chooseKey(neighbors.prev)}><ChevronLeft /></Button>
                  <Button size="icon" className="h-6 w-6 shrink-0 [&_svg]:size-3" aria-label={playing ? '暂停' : '播放'} title={playing ? '暂停' : '播放'} disabled={!timedSelection || !axis?.durationMs} onClick={() => setPlaying(value => !value)}>{playing ? <Pause /> : <Play />}</Button>
                  <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 [&_svg]:size-3" aria-label="下一步" title="下一步" disabled={!neighbors.next} onClick={() => neighbors.next && chooseKey(neighbors.next)}><ChevronRight /></Button>
                  <select className="box-border h-6 shrink-0 rounded border border-border bg-card px-1.5 py-0 text-[11px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="回放速度" value={viewerState.speed ?? 1} onChange={event => update({ speed: Number(event.target.value) })}>
                    {[0.5, 1, 2].map(speed => <option key={speed} value={speed}>{speed}×</option>)}
                  </select>
                  <Button variant="secondary" size="icon" className="h-6 w-6 shrink-0 [&_svg]:size-3" aria-label="跳到失败步骤" title="跳到失败步骤" disabled={!failureId} onClick={() => { setPlaying(false); setCursorToken(token => token + 1); if (failureId) chooseNode(failureId); }}><CircleAlert /></Button>
                </>} />
            </ResizablePanel>
            <ResizableHandle aria-label="调整时间轴与详情区域大小" />
            <ResizablePanel defaultSize={65} minSize={30}>
              <ResizablePanelGroup direction={stacked ? 'vertical' : 'horizontal'} autoSaveId={stacked ? 'fliwright-viewer-evidence-stacked' : 'fliwright-viewer-evidence'} className="min-h-0">
                <ResizablePanel defaultSize={65} minSize={25}><Viewport key={runIdentity(run)} run={run} selection={selection} /></ResizablePanel>
                <ResizableHandle aria-label="调整回放画面与信息面板大小" />
                <ResizablePanel defaultSize={35} minSize={24}>
                  <DetailTabs run={run} selection={selection} activeTab={viewerState.activeTab} onTabChange={activeTab => update({ activeTab })}
                    onOpenSource={(file, line, column) => vscode.postMessage({ type: 'openSource', file, line, column })}
                    onCopy={text => vscode.postMessage({ type: 'copy', text })} />
                </ResizablePanel>
              </ResizablePanelGroup>
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  </div>;
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<ViewerApp />);
