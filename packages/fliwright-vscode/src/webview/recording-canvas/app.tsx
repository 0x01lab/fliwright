import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './styles.css';
import type { RecordingFrame } from '@fliwright/core';
import type { CanvasToExtensionMessage, ExtensionToCanvasMessage, RecordingCanvasSession } from './types.js';
import {
  badgeLabel,
  coordLabel,
  kindColor,
  markerEndPercent,
  markerPercent,
} from './marker-utils.js';

declare const acquireVsCodeApi: () => {
  postMessage(message: CanvasToExtensionMessage): void;
};

const vscode = acquireVsCodeApi();

const EMPTY_SESSION: RecordingCanvasSession = {
  status: 'idle',
  rawEventCount: 0,
  operationCount: 0,
  frames: [],
};

interface RecordingNodeData extends Record<string, unknown> {
  frame: RecordingFrame;
}

const NODE_WIDTH = 248;
const NODE_X_GAP = 328;
const NODE_Y = 112;

const nodeTypes = {
  recordingFrame: memo(RecordingFrameNode),
};

function RecordingCanvasApp(): JSX.Element {
  const [session, setSession] = useState<RecordingCanvasSession>(EMPTY_SESSION);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    const onMessage = (event: MessageEvent<ExtensionToCanvasMessage>) => {
      if (event.data.type === 'session') {
        setSession({
          ...event.data.session,
          frames: event.data.session.frames ?? [],
        });
      }
    };
    window.addEventListener('message', onMessage);
    vscode.postMessage({ type: 'ready' });
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const nodes = useMemo<Array<Node<RecordingNodeData>>>(() => (
    session.frames.map((frame, index) => ({
      id: frame.id,
      type: 'recordingFrame',
      position: { x: index * NODE_X_GAP, y: NODE_Y + (index % 2) * 28 },
      data: { frame },
      draggable: true,
      selected: frame.id === selectedId,
    }))
  ), [session.frames, selectedId]);

  const edges = useMemo<Edge[]>(() => (
    session.frames.slice(1).map((frame, index) => ({
      id: `edge-${session.frames[index].id}-${frame.id}`,
      source: session.frames[index].id,
      target: frame.id,
      type: 'smoothstep',
      animated: session.status === 'recording',
      label: `${index + 1} -> ${index + 2}`,
      style: { stroke: 'var(--flow-edge)', strokeWidth: 2 },
      labelStyle: { fill: 'var(--vscode-descriptionForeground)', fontSize: 10 },
    }))
  ), [session.frames, session.status]);

  const stopRecording = useCallback(() => vscode.postMessage({ type: 'stopRecording' }), []);
  const openSavedRecording = useCallback(() => vscode.postMessage({ type: 'openSavedRecording' }), []);
  const insertTest = useCallback(() => vscode.postMessage({ type: 'insertRecordedTest' }), []);

  return (
    <ReactFlowProvider>
      <div className="canvas-shell">
        <Toolbar
          session={session}
          onStop={stopRecording}
          onInsertTest={insertTest}
          onOpenSavedRecording={openSavedRecording}
        />
        <div className="canvas-body">
          <FlowViewport session={session} nodes={nodes} edges={edges} selectedId={selectedId} onSelect={setSelectedId} />
          <OperationsSidebar frames={session.frames} selectedId={selectedId} onSelect={setSelectedId} />
        </div>
      </div>
    </ReactFlowProvider>
  );
}

function FlowViewport({
  session,
  nodes,
  edges,
  selectedId,
  onSelect,
}: {
  session: RecordingCanvasSession;
  nodes: Array<Node<RecordingNodeData>>;
  edges: Edge[];
  selectedId: string | null;
  onSelect(id: string): void;
}): JSX.Element {
  const { fitView, getNode, setCenter } = useReactFlow();

  useEffect(() => {
    window.requestAnimationFrame(() => {
      fitView({ padding: 0.24, duration: 220, maxZoom: 1.15 });
    });
  }, [fitView, nodes.length]);

  useEffect(() => {
    if (!selectedId) return;
    const node = getNode(selectedId);
    if (!node) return;
    setCenter(node.position.x + NODE_WIDTH / 2, node.position.y + 56, { zoom: 1.1, duration: 280 });
  }, [selectedId, getNode, setCenter]);

  if (nodes.length === 0) {
    return (
      <div className="empty-canvas">
        <div className="empty-kicker">Recording canvas</div>
        <h1>{session.status === 'recording' ? 'Waiting for the first interaction' : 'Ready to capture app frames'}</h1>
        <p>Tap, swipe, long-press and text input will appear as frames as the session records.</p>
      </div>
    );
  }

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodeClick={(event, node) => onSelect(node.id)}
      fitView
      minZoom={0.18}
      maxZoom={1.8}
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="var(--flow-grid)" />
      <MiniMap
        pannable
        zoomable
        nodeColor={(node) => {
          const frame = node.data?.frame as RecordingFrame | undefined;
          if (frame?.status === 'error') return '#d95f4b';
          if (!frame) return '#8a8f98';
          return kindColor(frame.kind);
        }}
      />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}

function Toolbar({
  session,
  onStop,
  onInsertTest,
  onOpenSavedRecording,
}: {
  session: RecordingCanvasSession;
  onStop(): void;
  onInsertTest(): void;
  onOpenSavedRecording(): void;
}): JSX.Element {
  const isPreview = session.status === 'preview';
  const canOpenSavedRecording = isPreview && Boolean(session.recordingDir);

  return (
    <header className="toolbar">
      <div>
        <div className="eyebrow">{title(session.status)}</div>
        <div className="stats">
          <span>{session.rawEventCount} raw events</span>
          <span>{session.operationCount} operations</span>
          <span>{session.frames.length} frames</span>
        </div>
      </div>
      <div className="actions">
        {session.status === 'recording' ? (
          <button className="danger" type="button" onClick={onStop}>Stop Recording</button>
        ) : null}
        {isPreview ? (
          <button type="button" onClick={onInsertTest}>Insert Test</button>
        ) : null}
        {canOpenSavedRecording ? (
          <button type="button" onClick={onOpenSavedRecording}>Open Saved Recording</button>
        ) : null}
      </div>
    </header>
  );
}

function OperationsSidebar({
  frames,
  selectedId,
  onSelect,
}: {
  frames: RecordingFrame[];
  selectedId: string | null;
  onSelect(id: string): void;
}): JSX.Element {
  return (
    <aside className="ops-sidebar">
      <div className="ops-sidebar__head">操作列表 · {frames.length}</div>
      <div className="ops-sidebar__list">
        {frames.length === 0 ? (
          <div className="ops-empty">还没有录制的操作</div>
        ) : (
          frames.map((frame) => {
            const color = kindColor(frame.kind);
            const isIgnored = frame.operationStatus === 'ignored';
            return (
              <div
                key={frame.id}
                className={`ops-row${frame.id === selectedId ? ' ops-row--selected' : ''}${isIgnored ? ' ops-row--ignored' : ''}`}
                onClick={() => onSelect(frame.id)}
              >
                <span className="ops-row__idx">{frame.index + 1}</span>
                <span className="ops-row__tag" style={{ background: `color-mix(in srgb, ${color} 22%, transparent)`, color }}>
                  {frame.kind}
                </span>
                <span className="ops-row__meta">{rowMeta(frame)}</span>
                <span className="ops-row__status">{isIgnored ? '忽略' : '✓'}</span>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}

function rowMeta(frame: RecordingFrame): string {
  const badge = badgeLabel(frame);
  const coord = coordLabel(frame);
  const selector = frame.selector ? ` · ${frame.selector}` : '';
  return [badge, coord].filter(Boolean).join(' · ') + selector;
}

function RecordingFrameNode({ data }: NodeProps<Node<RecordingNodeData>>): JSX.Element {
  const frame = data.frame;
  const imageSrc = frame.screenshot ? `data:image/${frame.screenshot.format};base64,${frame.screenshot.base64}` : undefined;
  const color = kindColor(frame.kind);
  const start = markerPercent(frame);
  const end = markerEndPercent(frame);
  const badge = badgeLabel(frame);
  const isIgnored = frame.operationStatus === 'ignored';
  const canToggle = frame.operationIndex != null;
  const setIncluded = useCallback((included: boolean) => {
    vscode.postMessage({ type: 'setFrameIncluded', frameId: frame.id, included });
  }, [frame.id]);

  return (
    <article className={`frame-node frame-node--${frame.status}${isIgnored ? ' frame-node--ignored' : ''}`}>
      <Handle type="target" position={Position.Left} />
      <div className="frame-meta">
        <span className="frame-index" style={{ background: color }}>{frame.index + 1}</span>
        <span className="frame-kind">{isIgnored ? 'ignored' : frame.kind}</span>
        <span className="frame-coord">{coordLabel(frame)}</span>
      </div>
      <div className="screen-wrap" style={{ aspectRatio: screenshotAspectRatio(frame) }}>
        {imageSrc ? (
          <img src={imageSrc} alt={`Frame ${frame.index + 1}`} draggable={false} />
        ) : (
          <div className="screen-placeholder">
            {frame.status === 'error' ? 'Screenshot failed' : 'Capturing screen'}
          </div>
        )}
        {end ? (
          <svg className="swipe-arrow" viewBox="0 0 100 100" preserveAspectRatio="none" style={{ color }}>
            <defs>
              <marker id={`ah-${frame.index}`} markerWidth="5" markerHeight="5" refX="2.5" refY="2.5" orient="auto">
                <path d="M0,0 L5,2.5 L0,5 z" fill="currentColor" />
              </marker>
            </defs>
            <line
              x1={start.x} y1={start.y} x2={end.x} y2={end.y}
              stroke="currentColor" strokeWidth={1.6} vectorEffect="non-scaling-stroke"
              markerEnd={`url(#ah-${frame.index})`}
            />
          </svg>
        ) : null}
        {frame.kind === 'longPress' && !frame.synthetic ? (
          <span className="marker-ring" style={{ left: `${start.x}%`, top: `${start.y}%`, ['--marker-color' as string]: color }} />
        ) : null}
        {!frame.synthetic ? (
          <span
            className="tap-marker"
            style={{ left: `${start.x}%`, top: `${start.y}%`, ['--marker-color' as string]: color }}
          >
            <span>{frame.index + 1}</span>
          </span>
        ) : null}
        {badge ? (
          <span
            className="marker-chip"
            style={{ left: `${start.x}%`, top: `${start.y}%`, ['--chip-color' as string]: color }}
          >
            {badge}
          </span>
        ) : null}
      </div>
      {frame.selector ? <div className="selector">{frame.selector}</div> : null}
      {frame.ignoreReason ? <div className="ignore-text">{ignoreReasonLabel(frame.ignoreReason)}</div> : null}
      {frame.screenshotError ? <div className="error-text">{frame.screenshotError}</div> : null}
      {canToggle ? (
        <div className="frame-actions" onPointerDown={(event) => event.stopPropagation()}>
          {isIgnored ? (
            <button type="button" onClick={(event) => { event.stopPropagation(); setIncluded(true); }}>Include</button>
          ) : (
            <button type="button" onClick={(event) => { event.stopPropagation(); setIncluded(false); }}>Ignore</button>
          )}
        </div>
      ) : null}
      <Handle type="source" position={Position.Right} />
    </article>
  );
}

function ignoreReasonLabel(reason: NonNullable<RecordingFrame['ignoreReason']>): string {
  switch (reason) {
    case 'duplicate':
      return 'Ignored: duplicate tap';
    case 'mergedIntoType':
      return 'Ignored: merged into typing';
    case 'nonActionable':
      return 'Ignored: non-actionable tap';
    case 'duringTransition':
      return 'Ignored: during transition';
    case 'noEffect':
      return 'Ignored: no visible effect';
  }
}

function screenshotAspectRatio(frame: RecordingFrame): string {
  const width = frame.screenshot?.width;
  const height = frame.screenshot?.height;
  if (!width || !height) return '9 / 16';
  return `${width} / ${height}`;
}

function title(status: RecordingCanvasSession['status']): string {
  if (status === 'recording') return 'Recording live';
  if (status === 'preview') return 'Recording preview';
  return 'Ready to record';
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(<RecordingCanvasApp />);
}
