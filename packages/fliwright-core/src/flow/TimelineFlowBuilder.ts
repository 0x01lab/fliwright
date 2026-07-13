import type { TimelineNode } from '../timeline/types.js';
import { TIMELINE_ARTIFACT_KIND_SCREENSHOT } from '../timeline/constants.js';
import type {
  FliwrightFlowDocument,
  FliwrightFlowEdge,
  FliwrightFlowNode,
  FliwrightFlowNodeType,
  TimelineToFlowInput,
  TimelineToFlowOptions,
} from './types.js';

const DEFAULT_NODE_X_GAP = 328;
const DEFAULT_NODE_Y = 112;

export function buildFlowFromTimeline(
  input: TimelineToFlowInput,
  options: TimelineToFlowOptions = {},
): FliwrightFlowDocument {
  const createdAt = options.createdAt ?? new Date().toISOString();
  const updatedAt = options.updatedAt ?? createdAt;
  const nodes = normalizeTimelineNodes(input.timeline.nodes, options)
    .map((node, index) => timelineNodeToFlowNode(node, {
      x: index * (options.nodeXGap ?? DEFAULT_NODE_X_GAP),
      y: options.nodeY ?? DEFAULT_NODE_Y,
    }));

  return {
    version: 1,
    id: options.flowId ?? `flow-${sanitizeId(input.timeline.runId)}`,
    title: options.title ?? input.timeline.testName,
    createdAt,
    updatedAt,
    source: {
      kind: 'timeline',
      runId: input.timeline.runId,
      testName: input.timeline.testName,
      ...(input.targetFile ? { targetFile: input.targetFile } : {}),
    },
    nodes,
    edges: buildLinearEdges(nodes),
    metadata: {
      timelineStatus: input.timeline.status,
      timelineMode: input.timeline.mode,
      timelineNodeCount: input.timeline.nodes.length,
      includedNodeCount: nodes.length,
    },
  };
}

function normalizeTimelineNodes(nodes: TimelineNode[], options: TimelineToFlowOptions): TimelineNode[] {
  return nodes
    .filter((node) => options.includeFailures || node.kind !== 'failure')
    .slice()
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
}

function timelineNodeToFlowNode(node: TimelineNode, position: { x: number; y: number }): FliwrightFlowNode {
  const screenshot = node.artifacts?.find((artifact) => artifact.kind === TIMELINE_ARTIFACT_KIND_SCREENSHOT);
  const selector = typeof node.metadata?.selector === 'string' ? node.metadata.selector : undefined;
  return {
    id: `timeline-${sanitizeId(node.id)}`,
    type: flowTypeForTimelineNode(node),
    title: node.title,
    position,
    ...(node.route ? { route: node.route } : {}),
    ...(selector ? { selector } : {}),
    ...(screenshot ? {
      screenshot: {
        source: 'runtime',
        path: screenshot.path,
        ...(screenshot.mimeType ? { format: formatFromMimeType(screenshot.mimeType) } : {}),
      },
    } : {}),
    ...(node.kind === 'branch' || node.kind === 'optional' ? {
      decisionRules: [{
        id: `${node.id}-rule`,
        when: String(node.metadata?.when ?? node.status),
      }],
    } : {}),
    ...(node.error ? { notes: node.error.message } : {}),
    metadata: {
      timelineNodeId: node.id,
      timelineKind: node.kind,
      timelineStatus: node.status,
      ...(node.parentId ? { timelineParentId: node.parentId } : {}),
      ...(node.codeRef ? { codeRef: node.codeRef } : {}),
      ...(node.metadata ? { timelineMetadata: node.metadata } : {}),
      ...(node.error ? { error: node.error } : {}),
    },
  };
}

function flowTypeForTimelineNode(node: TimelineNode): FliwrightFlowNodeType {
  switch (node.kind) {
    case 'page':
    case 'frame':
      return 'screen';
    case 'branch':
    case 'optional':
      return 'decision';
    case 'assertion':
      return 'assertion';
    case 'mock':
      return 'mock';
    case 'ai-call':
      return 'agent';
    case 'manual':
    case 'failure':
      return 'note';
    case 'script':
    case 'step':
    case 'action':
    default:
      return 'action';
  }
}

function buildLinearEdges(nodes: FliwrightFlowNode[]): FliwrightFlowEdge[] {
  const edges: FliwrightFlowEdge[] = [];
  for (let i = 1; i < nodes.length; i++) {
    const source = nodes[i - 1];
    const target = nodes[i];
    edges.push({
      id: `edge-${source.id}-${target.id}`,
      source: source.id,
      target: target.id,
      label: `${i} -> ${i + 1}`,
    });
  }
  return edges;
}

function formatFromMimeType(mimeType: string): string {
  return mimeType.replace(/^image\//, '');
}

function sanitizeId(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized || 'item';
}
