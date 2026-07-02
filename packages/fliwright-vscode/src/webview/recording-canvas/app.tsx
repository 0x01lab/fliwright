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
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { FlowCleanPlan, FliwrightFlowDocument, FliwrightFlowNode, RecordingFrame } from '@fliwright/core';
import type { FliwrightFlowEdge } from '@fliwright/core';
import type { CanvasToExtensionMessage, ExtensionToCanvasMessage, RecordingCanvasSession } from './types.js';
import {
  badgeLabel,
  coordLabel,
  kindColor,
  markerEndPercent,
  markerPercent,
} from './marker-utils.js';
import { Button } from '../components/ui/button.js';
import { ScrollArea } from '../components/ui/scroll-area.js';
import { GitBranch, Square, Plus, FolderOpen, Palette, StickyNote, Trash2, Sparkles, Link2, Unlink, Circle } from 'lucide-react';
import { cn } from '../lib/utils.js';

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

interface FlowNodeData extends Record<string, unknown> {
  flowNode: FliwrightFlowNode;
  frame?: RecordingFrame;
}

const NODE_WIDTH = 248;
const NODE_X_GAP = 328;
const NODE_Y = 112;
const INSPECTOR_INPUT_CLASS = 'w-full rounded-md border border-border bg-background px-2 py-1.5 text-[12px] text-foreground outline-none focus:ring-2 focus:ring-ring';

const nodeTypes = {
  recordingFrame: memo(RecordingFrameNode),
  flowNode: memo(FlowNodeCard),
};

function RecordingCanvasApp(): JSX.Element {
  const [session, setSession] = useState<RecordingCanvasSession>(EMPTY_SESSION);
  const [draftFlow, setDraftFlow] = useState<FliwrightFlowDocument | undefined>();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [cleanState, setCleanState] = useState<{
    pending: boolean;
    requestId?: string;
    plan?: FlowCleanPlan;
    error?: string;
    applied?: boolean;
  }>({ pending: false });

  useEffect(() => {
    const onMessage = (event: MessageEvent<ExtensionToCanvasMessage>) => {
      if (event.data.type === 'session') {
        setSession({
          ...event.data.session,
          frames: event.data.session.frames ?? [],
        });
        setDraftFlow(event.data.session.flow);
      }
      if (event.data.type === 'flowCleanResult') {
        const message = event.data;
        setCleanState((current) => {
          if (current.requestId && current.requestId !== message.requestId) return current;
          if (message.error) {
            return { pending: false, requestId: message.requestId, error: message.error };
          }
          if (message.result?.applied) setDraftFlow(message.result.flow);
          return {
            pending: false,
            requestId: message.requestId,
            plan: message.result?.plan,
            applied: message.result?.applied,
          };
        });
      }
    };
    window.addEventListener('message', onMessage);
    vscode.postMessage({ type: 'ready' });
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const frameById = useMemo(() => new Map(session.frames.map((frame) => [frame.id, frame])), [session.frames]);

  const nodes = useMemo<Array<Node<RecordingNodeData | FlowNodeData>>>(() => {
    if (draftFlow) {
      return draftFlow.nodes.map((flowNode, index) => ({
        id: flowNode.id,
        type: 'flowNode',
        position: flowNode.position ?? { x: index * NODE_X_GAP, y: NODE_Y + (index % 2) * 28 },
        data: {
          flowNode,
          frame: flowNode.recordingFrameId ? frameById.get(flowNode.recordingFrameId) : undefined,
        },
        draggable: true,
        selected: flowNode.id === selectedId,
      }));
    }
    return session.frames.map((frame, index) => ({
      id: frame.id,
      type: 'recordingFrame',
      position: { x: index * NODE_X_GAP, y: NODE_Y + (index % 2) * 28 },
      data: { frame },
      draggable: true,
      selected: frame.id === selectedId,
    }));
  }, [draftFlow, frameById, session.frames, selectedId]);

  const edges = useMemo<Edge[]>(() => {
    if (draftFlow) {
      return draftFlow.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: 'smoothstep',
        label: edge.label ?? edge.condition,
        selected: edge.id === selectedEdgeId,
        style: { stroke: edge.id === selectedEdgeId ? 'var(--vscode-focusBorder)' : 'var(--color-flow-edge)', strokeWidth: edge.id === selectedEdgeId ? 3 : 2 },
        labelStyle: { fill: 'var(--vscode-descriptionForeground)', fontSize: 10 },
      }));
    }
    return session.frames.slice(1).map((frame, index) => ({
      id: `edge-${session.frames[index].id}-${frame.id}`,
      source: session.frames[index].id,
      target: frame.id,
      type: 'smoothstep',
      animated: session.status === 'recording',
      label: `${index + 1} -> ${index + 2}`,
      style: { stroke: 'var(--color-flow-edge)', strokeWidth: 2 },
      labelStyle: { fill: 'var(--vscode-descriptionForeground)', fontSize: 10 },
    }));
  }, [draftFlow, selectedEdgeId, session.frames, session.status]);

  const stopRecording = useCallback(() => vscode.postMessage({ type: 'stopRecording' }), []);
  const startRecording = useCallback(() => vscode.postMessage({ type: 'startRecording' }), []);
  const openSavedRecording = useCallback(() => vscode.postMessage({ type: 'openSavedRecording' }), []);
  const insertTest = useCallback(() => vscode.postMessage({ type: 'insertRecordedTest' }), []);
  const cleanFlow = useCallback((apply: boolean) => {
    const requestId = `clean-${Date.now()}`;
    setCleanState({ pending: true, requestId });
    vscode.postMessage({ type: 'cleanFlow', requestId, apply });
  }, []);
  const updateFlow = useCallback((updater: (flow: FliwrightFlowDocument) => FliwrightFlowDocument) => {
    setDraftFlow((current) => {
      const base = current ?? createEmptyFlow(session);
      const next = {
        ...updater(base),
        updatedAt: new Date().toISOString(),
      };
      vscode.postMessage({ type: 'updateFlow', flow: next });
      return next;
    });
  }, [session]);
  const addDraftNode = useCallback((type: 'note' | 'figma' | 'decision') => {
    updateFlow((flow) => {
      const index = flow.nodes.length;
      const node: FliwrightFlowNode = {
        id: `${type}-${Date.now()}`,
        type,
        title: titleForNewFlowNode(type),
        position: { x: index * NODE_X_GAP, y: NODE_Y + 188 },
        ...(type === 'note' ? { notes: 'Add business context here.' } : {}),
        ...(type === 'decision' ? {
          decisionRules: [
            { id: `rule-${Date.now()}`, label: 'Default', when: 'else' },
          ],
          notes: 'Describe the business condition that splits this flow.',
        } : {}),
        ...(type === 'figma' ? {
          figma: {
            fileKey: '',
            nodeId: '',
            name: 'Unbound Figma node',
          },
        } : {}),
      };
      return { ...flow, nodes: [...flow.nodes, node] };
    });
  }, [updateFlow]);
  const connectDraftNodes = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return;
    updateFlow((flow) => {
      const edge = {
        id: `edge-${connection.source}-${connection.target}-${Date.now()}`,
        source: connection.source!,
        target: connection.target!,
      };
      return {
        ...flow,
        edges: flow.edges.some((item) => item.source === edge.source && item.target === edge.target)
          ? flow.edges
          : [...flow.edges, edge],
      };
    });
  }, [updateFlow]);
  const moveDraftNode = useCallback((nodeId: string, position: { x: number; y: number }) => {
    updateFlow((flow) => ({
      ...flow,
      nodes: flow.nodes.map((node) => node.id === nodeId ? { ...node, position } : node),
    }));
  }, [updateFlow]);
  const updateDraftNode = useCallback((nodeId: string, patch: Partial<FliwrightFlowNode>) => {
    updateFlow((flow) => ({
      ...flow,
      nodes: flow.nodes.map((node) => node.id === nodeId ? { ...node, ...patch } : node),
    }));
  }, [updateFlow]);
  const updateDraftEdge = useCallback((edgeId: string, patch: Partial<FliwrightFlowEdge>) => {
    updateFlow((flow) => ({
      ...flow,
      edges: flow.edges.map((edge) => edge.id === edgeId ? { ...edge, ...patch } : edge),
    }));
  }, [updateFlow]);
  const selectNode = useCallback((id: string) => {
    setSelectedId(id);
    setSelectedEdgeId(null);
  }, []);
  const selectEdge = useCallback((id: string) => {
    setSelectedEdgeId(id);
    setSelectedId(null);
  }, []);

  return (
    <ReactFlowProvider>
      <div className="relative h-screen w-full overflow-hidden bg-background">
        <Toolbar
          session={session}
          hasFlow={Boolean(draftFlow)}
          onStart={startRecording}
          onStop={stopRecording}
          onInsertTest={insertTest}
          onOpenSavedRecording={openSavedRecording}
          onAddNote={() => addDraftNode('note')}
          onAddDecision={() => addDraftNode('decision')}
          onAddFigma={() => addDraftNode('figma')}
          cleanState={cleanState}
          onPreviewClean={() => cleanFlow(false)}
          onApplyClean={() => cleanFlow(true)}
        />
        <div className="absolute bottom-3 left-3 right-3 top-16 flex gap-2.5">
          <div className="min-w-0 flex-1 overflow-hidden rounded-lg border border-border">
            <FlowViewport
              session={session}
              nodes={nodes}
              edges={edges}
              selectedId={selectedId}
              hasFlow={Boolean(draftFlow)}
              onSelectNode={selectNode}
              onSelectEdge={selectEdge}
              onConnectFlow={connectDraftNodes}
              onMoveFlowNode={moveDraftNode}
            />
          </div>
          {draftFlow ? (
            <FlowSidebar
              flow={draftFlow}
              selectedId={selectedId}
              selectedEdgeId={selectedEdgeId}
              onSelect={selectNode}
              onUpdateNode={updateDraftNode}
              onUpdateEdge={updateDraftEdge}
            />
          ) : (
            <OperationsSidebar frames={session.frames} selectedId={selectedId} onSelect={selectNode} />
          )}
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
  hasFlow,
  onSelectNode,
  onSelectEdge,
  onConnectFlow,
  onMoveFlowNode,
}: {
  session: RecordingCanvasSession;
  nodes: Array<Node<RecordingNodeData | FlowNodeData>>;
  edges: Edge[];
  selectedId: string | null;
  hasFlow: boolean;
  onSelectNode(id: string): void;
  onSelectEdge(id: string): void;
  onConnectFlow(connection: Connection): void;
  onMoveFlowNode(nodeId: string, position: { x: number; y: number }): void;
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
      <div className="flex h-full flex-col justify-center pl-[clamp(24px,8vw,96px)]">
        <div className="text-xs font-semibold uppercase text-muted-foreground">{hasFlow ? 'Flow studio' : 'Recording canvas'}</div>
        <h1 className="my-2.5 max-w-[560px] text-[clamp(28px,5vw,54px)] leading-[1.02]">{session.status === 'recording' ? 'Waiting for the first interaction' : hasFlow ? 'Start composing the business flow' : 'Ready to capture app frames'}</h1>
        <p className="m-0 max-w-[440px] text-[13px] text-muted-foreground">{hasFlow ? 'Add a note, decision, or Figma node to begin organizing this flow.' : 'Tap, swipe, long-press and text input will appear as frames as the session records.'}</p>
      </div>
    );
  }

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodeClick={(event, node) => onSelectNode(node.id)}
      onEdgeClick={hasFlow ? (event, edge) => onSelectEdge(edge.id) : undefined}
      onConnect={hasFlow ? onConnectFlow : undefined}
      onNodeDragStop={hasFlow ? (event, node) => onMoveFlowNode(node.id, node.position) : undefined}
      fitView
      minZoom={0.18}
      maxZoom={1.8}
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="var(--color-flow-grid)" />
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
  hasFlow,
  cleanState,
  onStart,
  onStop,
  onInsertTest,
  onOpenSavedRecording,
  onAddNote,
  onAddDecision,
  onAddFigma,
  onPreviewClean,
  onApplyClean,
}: {
  session: RecordingCanvasSession;
  hasFlow: boolean;
  cleanState: { pending: boolean; plan?: FlowCleanPlan; error?: string; applied?: boolean };
  onStart(): void;
  onStop(): void;
  onInsertTest(): void;
  onOpenSavedRecording(): void;
  onAddNote(): void;
  onAddDecision(): void;
  onAddFigma(): void;
  onPreviewClean(): void;
  onApplyClean(): void;
}): JSX.Element {
  const isPreview = session.status === 'preview';
  const canOpenSavedRecording = isPreview && Boolean(session.recordingDir);

  return (
    <header className="absolute left-3 right-3 top-3 z-10 rounded-lg border border-border bg-background/85 px-3 py-2 shadow-xl backdrop-blur-md">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-xs font-semibold text-foreground">{title(session.status)}</div>
          <div className="mt-0.5 flex flex-wrap gap-2.5 text-[11px] text-muted-foreground">
            <span>{session.rawEventCount} raw events</span>
            <span>{session.operationCount} operations</span>
            <span>{session.frames.length} frames</span>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          {isPreview || hasFlow ? (
            <>
              <Button variant="outline" size="sm" onClick={onAddNote}><StickyNote /> Note</Button>
              <Button variant="outline" size="sm" onClick={onAddDecision}><GitBranch /> Decision</Button>
              <Button variant="outline" size="sm" onClick={onAddFigma}><Palette /> Figma</Button>
              <Button variant="outline" size="sm" disabled={cleanState.pending} onClick={onPreviewClean}><Sparkles /> Preview Clean</Button>
              <Button variant="outline" size="sm" disabled={cleanState.pending} onClick={onApplyClean}><Sparkles /> Apply Clean</Button>
            </>
          ) : null}
          {session.status === 'recording' ? (
            <Button variant="destructive" size="sm" onClick={onStop}><Square /> Stop Recording</Button>
          ) : (
            <Button size="sm" onClick={onStart}><Circle /> Start Recording</Button>
          )}
          {isPreview ? (
            <Button size="sm" onClick={onInsertTest}><Plus /> Insert Test</Button>
          ) : null}
          {canOpenSavedRecording ? (
            <Button variant="outline" size="sm" onClick={onOpenSavedRecording}><FolderOpen /> Open Saved Recording</Button>
          ) : null}
        </div>
      </div>
      {cleanState.pending || cleanState.plan || cleanState.error ? (
        <div className={cn(
          'mt-2 rounded-md border px-2 py-1.5 text-[11px]',
          cleanState.error ? 'border-destructive/40 text-destructive' : 'border-border text-muted-foreground',
        )}>
          {cleanState.pending ? 'Cleaning flow...' : cleanState.error ? cleanState.error : `${cleanState.applied ? 'Applied' : 'Preview'} clean: kept ${cleanState.plan?.keptNodeIds.length ?? 0}, removed ${cleanState.plan?.removedNodeIds.length ?? 0}`}
        </div>
      ) : null}
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
    <aside className="flex w-[300px] shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-background">
      <div className="border-b border-border px-2.5 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">操作列表 · {frames.length}</div>
      <ScrollArea className="flex-1">
        <div className="p-1">
          {frames.length === 0 ? (
            <div className="px-3 py-4 text-center text-[12px] text-muted-foreground">还没有录制的操作</div>
          ) : (
            frames.map((frame) => {
              const color = kindColor(frame.kind);
              const isIgnored = frame.operationStatus === 'ignored';
              return (
                <div
                  key={frame.id}
                  onClick={() => onSelect(frame.id)}
                  className={cn(
                    'flex cursor-pointer items-center gap-1.5 border-b border-border/50 px-2.5 py-1.5 font-mono text-[11px] hover:bg-accent',
                    frame.id === selectedId && 'bg-primary/15 ring-2 ring-ring ring-inset',
                    isIgnored && 'opacity-50',
                  )}
                >
                  <span className="w-3.5 text-muted-foreground">{frame.index + 1}</span>
                  <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: `color-mix(in srgb, ${color} 22%, transparent)`, color }}>{frame.kind}</span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{rowMeta(frame)}</span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">{isIgnored ? '忽略' : '✓'}</span>
                </div>
              );
            })
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}

function FlowSidebar({
  flow,
  selectedId,
  selectedEdgeId,
  onSelect,
  onUpdateNode,
  onUpdateEdge,
}: {
  flow: FliwrightFlowDocument;
  selectedId: string | null;
  selectedEdgeId: string | null;
  onSelect(id: string): void;
  onUpdateNode(id: string, patch: Partial<FliwrightFlowNode>): void;
  onUpdateEdge(id: string, patch: Partial<FliwrightFlowEdge>): void;
}): JSX.Element {
  const selectedNode = flow.nodes.find((node) => node.id === selectedId) ?? flow.nodes[0];
  const selectedEdge = flow.edges.find((edge) => edge.id === selectedEdgeId);

  return (
    <aside className="flex w-[320px] shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-background">
      <div className="border-b border-border px-2.5 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Flow · {flow.nodes.length}</div>
      <ScrollArea className="h-[42%] border-b border-border">
        <div className="p-1">
          {flow.nodes.length === 0 ? (
            <div className="px-3 py-4 text-center text-[12px] text-muted-foreground">No flow nodes</div>
          ) : (
            flow.nodes.map((node, index) => (
              <div
                key={node.id}
                onClick={() => onSelect(node.id)}
                className={cn(
                  'flex cursor-pointer items-center gap-1.5 border-b border-border/50 px-2.5 py-1.5 text-[11px] hover:bg-accent',
                  node.id === selectedNode?.id && 'bg-primary/15 ring-2 ring-ring ring-inset',
                )}
              >
                <span className="w-4 text-muted-foreground">{index + 1}</span>
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: flowNodeColor(node) }} />
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[9px] uppercase text-muted-foreground">{node.type}</span>
                <span className="min-w-0 flex-1 truncate text-foreground">{node.title}</span>
              </div>
            ))
          )}
        </div>
      </ScrollArea>
      <ScrollArea className="flex-1">
        {selectedEdge ? (
          <FlowEdgeInspector edge={selectedEdge} onUpdate={(patch) => onUpdateEdge(selectedEdge.id, patch)} />
        ) : selectedNode ? (
          <FlowNodeInspector node={selectedNode} onUpdate={(patch) => onUpdateNode(selectedNode.id, patch)} />
        ) : (
          <div className="px-3 py-4 text-center text-[12px] text-muted-foreground">Select a node</div>
        )}
      </ScrollArea>
    </aside>
  );
}

function FlowEdgeInspector({
  edge,
  onUpdate,
}: {
  edge: FliwrightFlowEdge;
  onUpdate(patch: Partial<FliwrightFlowEdge>): void;
}): JSX.Element {
  return (
    <div className="space-y-3 p-3 text-[12px]">
      <div className="rounded-md border border-border bg-muted/30 px-2 py-2">
        <div className="text-[10px] font-semibold uppercase text-muted-foreground">Edge</div>
        <div className="mt-1 truncate font-mono text-[11px] text-foreground">{edge.source} {'->'} {edge.target}</div>
      </div>
      <Field label="Label">
        <input
          className={INSPECTOR_INPUT_CLASS}
          value={edge.label ?? ''}
          onChange={(event) => onUpdate({ label: emptyToUndefined(event.currentTarget.value) })}
        />
      </Field>
      <Field label="Condition">
        <textarea
          className={`${INSPECTOR_INPUT_CLASS} min-h-20 resize-y font-mono`}
          value={edge.condition ?? ''}
          onChange={(event) => onUpdate({ condition: emptyToUndefined(event.currentTarget.value) })}
        />
      </Field>
    </div>
  );
}

function FlowNodeInspector({
  node,
  onUpdate,
}: {
  node: FliwrightFlowNode;
  onUpdate(patch: Partial<FliwrightFlowNode>): void;
}): JSX.Element {
  const figma = node.figma ?? { fileKey: '', nodeId: '' };
  const updateFigma = (patch: Partial<NonNullable<FliwrightFlowNode['figma']>>) => {
    onUpdate({ figma: { ...figma, ...patch } });
  };
  const updateFigmaUrl = (url: string) => {
    const binding = figmaBindingFromUrl(url, figma);
    onUpdate({
      figma: binding ?? { ...figma, url },
    });
  };
  const updateDecisionRules = (decisionRules: NonNullable<FliwrightFlowNode['decisionRules']>) => {
    onUpdate({ decisionRules });
  };

  return (
    <div className="space-y-3 p-3 text-[12px]">
      <Field label="Title">
        <input className={INSPECTOR_INPUT_CLASS} value={node.title} onChange={(event) => onUpdate({ title: event.currentTarget.value })} />
      </Field>
      <FigmaBindingInspector
        figma={node.figma}
        onUpdate={updateFigma}
        onUpdateUrl={updateFigmaUrl}
        onClear={() => onUpdate({ figma: undefined })}
      />
      {node.type === 'decision' ? (
        <DecisionRulesEditor
          rules={node.decisionRules ?? []}
          onChange={updateDecisionRules}
        />
      ) : null}
      {node.type === 'note' || node.type === 'decision' || node.notes ? (
        <Field label="Notes">
          <textarea className={`${INSPECTOR_INPUT_CLASS} min-h-24 resize-y`} value={node.notes ?? ''} onChange={(event) => onUpdate({ notes: event.currentTarget.value })} />
        </Field>
      ) : null}
      {node.selector ? (
        <Field label="Selector">
          <input className={`${INSPECTOR_INPUT_CLASS} font-mono`} value={node.selector} onChange={(event) => onUpdate({ selector: event.currentTarget.value })} />
        </Field>
      ) : null}
      {node.route ? (
        <Field label="Route">
          <input className={`${INSPECTOR_INPUT_CLASS} font-mono`} value={node.route} onChange={(event) => onUpdate({ route: event.currentTarget.value })} />
        </Field>
      ) : null}
    </div>
  );
}

function FigmaBindingInspector({
  figma,
  onUpdate,
  onUpdateUrl,
  onClear,
}: {
  figma?: FliwrightFlowNode['figma'];
  onUpdate(patch: Partial<NonNullable<FliwrightFlowNode['figma']>>): void;
  onUpdateUrl(url: string): void;
  onClear(): void;
}): JSX.Element {
  const binding = figma ?? { fileKey: '', nodeId: '' };
  const isBound = Boolean(binding.fileKey && binding.nodeId);

  return (
    <div className="space-y-2 rounded-md border border-border bg-muted/20 p-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5 text-[10px] font-semibold uppercase text-muted-foreground">
          <Link2 className="h-3.5 w-3.5" />
          <span>Figma binding</span>
        </div>
        {figma ? (
          <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[10px]" onClick={onClear}>
            <Unlink /> Clear
          </Button>
        ) : null}
      </div>
      <Field label="URL">
        <input
          className={`${INSPECTOR_INPUT_CLASS} font-mono`}
          value={binding.url ?? ''}
          placeholder="https://www.figma.com/design/..."
          onChange={(event) => onUpdateUrl(event.currentTarget.value)}
        />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="File key">
          <input className={`${INSPECTOR_INPUT_CLASS} font-mono`} value={binding.fileKey} onChange={(event) => onUpdate({ fileKey: event.currentTarget.value })} />
        </Field>
        <Field label="Node id">
          <input className={`${INSPECTOR_INPUT_CLASS} font-mono`} value={binding.nodeId} onChange={(event) => onUpdate({ nodeId: event.currentTarget.value })} />
        </Field>
      </div>
      {figma || isBound ? (
        <>
          <Field label="Name">
            <input className={INSPECTOR_INPUT_CLASS} value={binding.name ?? ''} onChange={(event) => onUpdate({ name: event.currentTarget.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Code Connect">
              <input className={`${INSPECTOR_INPUT_CLASS} font-mono`} value={binding.codeConnectId ?? ''} onChange={(event) => onUpdate({ codeConnectId: emptyToUndefined(event.currentTarget.value) })} />
            </Field>
            <Field label="Component">
              <input className={INSPECTOR_INPUT_CLASS} value={binding.componentName ?? ''} onChange={(event) => onUpdate({ componentName: emptyToUndefined(event.currentTarget.value) })} />
            </Field>
          </div>
        </>
      ) : null}
    </div>
  );
}

function DecisionRulesEditor({
  rules,
  onChange,
}: {
  rules: NonNullable<FliwrightFlowNode['decisionRules']>;
  onChange(rules: NonNullable<FliwrightFlowNode['decisionRules']>): void;
}): JSX.Element {
  const updateRule = (ruleId: string, patch: Partial<NonNullable<FliwrightFlowNode['decisionRules']>[number]>) => {
    onChange(rules.map((rule) => rule.id === ruleId ? { ...rule, ...patch } : rule));
  };
  const addRule = () => {
    onChange([
      ...rules,
      { id: `rule-${Date.now()}`, label: `Rule ${rules.length + 1}`, when: 'state == value' },
    ]);
  };
  const removeRule = (ruleId: string) => {
    onChange(rules.filter((rule) => rule.id !== ruleId));
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase text-muted-foreground">Decision rules</span>
        <Button variant="outline" size="sm" className="h-7 px-2 text-[11px]" onClick={addRule}><Plus /> Rule</Button>
      </div>
      {rules.length === 0 ? (
        <div className="rounded-md border border-dashed border-border px-2 py-3 text-[11px] text-muted-foreground">No decision rules</div>
      ) : (
        <div className="space-y-2">
          {rules.map((rule) => (
            <div key={rule.id} className="space-y-1.5 rounded-md border border-border p-2">
              <div className="flex items-center gap-1.5">
                <input
                  className={`${INSPECTOR_INPUT_CLASS} min-w-0 flex-1`}
                  value={rule.label ?? ''}
                  placeholder="Label"
                  onChange={(event) => updateRule(rule.id, { label: event.currentTarget.value })}
                />
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => removeRule(rule.id)}><Trash2 /></Button>
              </div>
              <input
                className={`${INSPECTOR_INPUT_CLASS} font-mono`}
                value={rule.when}
                placeholder="when condition"
                onChange={(event) => updateRule(rule.id, { when: event.currentTarget.value })}
              />
              <input
                className={`${INSPECTOR_INPUT_CLASS} font-mono`}
                value={rule.target ?? ''}
                placeholder="target flow node id"
                onChange={(event) => updateRule(rule.id, { target: event.currentTarget.value })}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <label className="block space-y-1.5">
      <span className="text-[10px] font-semibold uppercase text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function emptyToUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function rowMeta(frame: RecordingFrame): string {
  const badge = badgeLabel(frame);
  const coord = coordLabel(frame);
  const selector = frame.selector ? ` · ${frame.selector}` : '';
  return [badge, coord].filter(Boolean).join(' · ') + selector;
}

function FlowNodeCard({ data }: NodeProps<Node<FlowNodeData>>): JSX.Element {
  const node = data.flowNode;
  const frame = data.frame;
  const imageSrc = frame?.screenshot ? `data:image/${frame.screenshot.format};base64,${frame.screenshot.base64}` : undefined;
  const color = flowNodeColor(node);

  return (
    <article className="min-w-[220px] max-w-[280px] overflow-hidden rounded-md border border-border bg-background shadow-lg">
      <Handle type="target" position={Position.Left} />
      <div className="flex items-center gap-2 border-b border-border px-2.5 py-2">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
        <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-foreground">{node.title}</span>
        <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] uppercase text-muted-foreground">{node.type}</span>
      </div>
      {imageSrc ? (
        <div className="bg-muted" style={{ aspectRatio: frame ? screenshotAspectRatio(frame) : '9 / 16' }}>
          <img src={imageSrc} alt={node.title} className="h-full w-full object-cover" draggable={false} />
        </div>
      ) : null}
      <div className="space-y-1.5 px-2.5 py-2 text-[11px] text-muted-foreground">
        {node.selector ? <div className="truncate font-mono">{node.selector}</div> : null}
        {node.figma ? (
          <div className="truncate">
            <span className="font-semibold text-foreground">Figma: </span>
            <span className="font-mono">
              {figmaSummary(node.figma)}
            </span>
          </div>
        ) : null}
        {node.notes ? <div className="line-clamp-3">{node.notes}</div> : null}
        {node.decisionRules?.length ? (
          <div className="space-y-1">
            <div>{node.decisionRules.length} decision rule{node.decisionRules.length === 1 ? '' : 's'}</div>
            {node.decisionRules.slice(0, 2).map((rule) => (
              <div key={rule.id} className="truncate font-mono">{rule.label ? `${rule.label}: ` : ''}{rule.when}</div>
            ))}
          </div>
        ) : null}
        {node.recordingFrameId ? <div className="truncate">frame: {node.recordingFrameId}</div> : null}
      </div>
      <Handle type="source" position={Position.Right} />
    </article>
  );
}

function figmaSummary(figma: NonNullable<FliwrightFlowNode['figma']>): string {
  if (!figma.fileKey) return 'missing file key';
  if (!figma.nodeId) return 'missing node id';
  return figma.name || figma.componentName || `${figma.fileKey} / ${figma.nodeId}`;
}

function figmaBindingFromUrl(
  value: string,
  existing: Partial<NonNullable<FliwrightFlowNode['figma']>> = {},
): NonNullable<FliwrightFlowNode['figma']> | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.hostname !== 'figma.com' && !url.hostname.endsWith('.figma.com')) return null;
  const parts = url.pathname.split('/').filter(Boolean);
  const editor = parts[0];
  const fileKey = editor === 'design' && parts[2] === 'branch' && parts[3]
    ? parts[3]
    : (editor === 'design' || editor === 'board' || editor === 'slides' || editor === 'make')
      ? parts[1]
      : undefined;
  if (!fileKey) return null;
  const nodeId = url.searchParams.get('node-id') ?? url.searchParams.get('nodeId');
  return {
    ...existing,
    fileKey,
    nodeId: nodeId?.replace(/-/g, ':') ?? existing.nodeId ?? '',
    url: value,
  };
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
            <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={(event) => { event.stopPropagation(); setIncluded(true); }}>Include</Button>
          ) : (
            <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={(event) => { event.stopPropagation(); setIncluded(false); }}>Ignore</Button>
          )}
        </div>
      ) : null}
      <Handle type="source" position={Position.Right} />
    </article>
  );
}

function flowNodeColor(node: FliwrightFlowNode): string {
  switch (node.type) {
    case 'figma':
      return '#a259ff';
    case 'note':
      return '#d9a441';
    case 'decision':
      return '#3c8dbc';
    case 'assertion':
      return '#3ca370';
    case 'mock':
      return '#d95f4b';
    case 'agent':
      return '#4b7bd9';
    case 'screen':
      return '#6f8f72';
    case 'action':
    default:
      return '#8a8f98';
  }
}

function titleForNewFlowNode(type: 'note' | 'figma' | 'decision'): string {
  switch (type) {
    case 'figma':
      return 'Figma design';
    case 'decision':
      return 'Decision';
    case 'note':
      return 'Note';
  }
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

function createEmptyFlow(session: RecordingCanvasSession): FliwrightFlowDocument {
  const now = new Date().toISOString();
  return {
    version: 1,
    id: session.recordingId ? `flow-${session.recordingId}` : `flow-${Date.now()}`,
    ...(session.testName ? { title: session.testName } : {}),
    createdAt: now,
    updatedAt: now,
    source: {
      kind: 'manual',
      ...(session.recordingId ? { recordingId: session.recordingId } : {}),
      ...(session.testName ? { testName: session.testName } : {}),
      ...(session.targetFile ? { targetFile: session.targetFile } : {}),
    },
    nodes: [],
    edges: [],
  };
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(<RecordingCanvasApp />);
}
