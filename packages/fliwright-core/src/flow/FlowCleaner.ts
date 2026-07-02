import { ai as sharedAi } from '../ai/capability.js';
import type { AiGenerateRequest } from '../ai/types.js';
import type { AiRuntime } from '../ai/AiRuntime.js';
import type { FliwrightFlowDocument, FliwrightFlowEdge, FliwrightFlowNode } from './types.js';

export interface FlowCleanReason {
  nodeId: string;
  decision: 'keep' | 'remove';
  reason?: string;
}

export interface FlowCleanPlan {
  version: 1;
  keptNodeIds: string[];
  removedNodeIds: string[];
  reasons: FlowCleanReason[];
  summary?: string;
}

export interface RawFlowCleanPlan {
  version?: 1;
  keptNodeIds?: string[];
  removedNodeIds?: string[];
  reasons?: FlowCleanReason[];
  summary?: string;
}

export interface FlowCleanOptions {
  ai?: Pick<AiRuntime, 'generate'>;
  timeoutMs?: number;
  instructions?: string;
  protectedNodeIds?: string[];
  preserveFigmaBoundNodes?: boolean;
  preserveDecisionNodes?: boolean;
}

export interface FlowCleanResult {
  flow: FliwrightFlowDocument;
  plan: FlowCleanPlan;
}

const FLOW_CLEAN_SYSTEM = [
  'You clean Fliwright recorded business-flow graphs.',
  'Return JSON only. Do not invent node ids.',
  'Keep only nodes that represent meaningful business state, navigation, user intent, assertions, decisions, Figma bindings, or test-critical actions.',
  'Remove duplicate taps, transient retries, no-op gestures, accidental clicks, and implementation noise.',
].join('\n');

const flowCleanPlanSchema: AiGenerateRequest<RawFlowCleanPlan>['schema'] = {
  type: 'object',
  properties: {
    version: { type: 'integer' },
    keptNodeIds: { type: 'array', items: { type: 'string' } },
    removedNodeIds: { type: 'array', items: { type: 'string' } },
    reasons: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          nodeId: { type: 'string' },
          decision: { type: 'string', enum: ['keep', 'remove'] },
          reason: { type: 'string' },
        },
        required: ['nodeId', 'decision'],
        additionalProperties: false,
      },
    },
    summary: { type: 'string' },
  },
  additionalProperties: false,
};

export async function cleanFlowWithAi(
  flow: FliwrightFlowDocument,
  options: FlowCleanOptions = {},
): Promise<FlowCleanResult> {
  const runtime = options.ai ?? sharedAi;
  const rawPlan = await runtime.generate<RawFlowCleanPlan>({
    prompt: buildFlowCleanPrompt(flow, options),
    system: FLOW_CLEAN_SYSTEM,
    responseFormat: 'json',
    schema: flowCleanPlanSchema,
    timeoutMs: options.timeoutMs,
    metadata: {
      flowId: flow.id,
      nodeCount: flow.nodes.length,
      edgeCount: flow.edges.length,
      purpose: 'flow-clean',
    },
  });
  const plan = normalizeFlowCleanPlan(flow, rawPlan, options);
  return {
    flow: applyFlowCleanPlan(flow, plan),
    plan,
  };
}

export function applyFlowCleanPlan(flow: FliwrightFlowDocument, plan: FlowCleanPlan): FliwrightFlowDocument {
  const kept = new Set(plan.keptNodeIds);
  const nodes = flow.nodes.filter((node) => kept.has(node.id));
  return {
    ...flow,
    updatedAt: new Date().toISOString(),
    nodes,
    edges: compactEdges(flow, kept, nodes),
    metadata: {
      ...(flow.metadata ?? {}),
      cleanedBy: 'ai',
      cleanedAt: new Date().toISOString(),
      originalNodeCount: flow.nodes.length,
      removedNodeCount: plan.removedNodeIds.length,
      removedNodeIds: plan.removedNodeIds,
      ...(plan.summary ? { cleanSummary: plan.summary } : {}),
      ...(plan.reasons.length ? { cleanReasons: plan.reasons } : {}),
    },
  };
}

export function buildFlowCleanPrompt(flow: FliwrightFlowDocument, options: FlowCleanOptions = {}): string {
  const nodes = flow.nodes.map((node) => summarizeNode(flow, node));
  return [
    `Flow id: ${flow.id}`,
    flow.title ? `Flow title: ${flow.title}` : undefined,
    'Task: Keep only nodes that represent meaningful business state or user intent. Remove recording noise.',
    options.instructions ? `Additional instructions: ${options.instructions}` : undefined,
    'Return JSON with keptNodeIds, removedNodeIds, reasons, and summary.',
    'Nodes:',
    JSON.stringify(nodes, null, 2),
  ].filter(Boolean).join('\n\n');
}

function normalizeFlowCleanPlan(
  flow: FliwrightFlowDocument,
  rawPlan: RawFlowCleanPlan,
  options: FlowCleanOptions,
): FlowCleanPlan {
  const knownIds = new Set(flow.nodes.map((node) => node.id));
  const protectedIds = new Set(options.protectedNodeIds ?? []);
  if (options.preserveFigmaBoundNodes ?? true) {
    for (const node of flow.nodes.filter((candidate) => candidate.figma?.fileKey && candidate.figma.nodeId)) {
      protectedIds.add(node.id);
    }
  }
  if (options.preserveDecisionNodes ?? true) {
    for (const node of flow.nodes.filter((candidate) => candidate.type === 'decision' || candidate.decisionRules?.length)) {
      protectedIds.add(node.id);
    }
  }

  const removedFromAi = uniqueKnown(rawPlan.removedNodeIds ?? [], knownIds);
  let keptNodeIds = uniqueKnown(rawPlan.keptNodeIds ?? [], knownIds);
  if (keptNodeIds.length === 0 && removedFromAi.length > 0) {
    const removedSet = new Set(removedFromAi);
    keptNodeIds = flow.nodes.map((node) => node.id).filter((nodeId) => !removedSet.has(nodeId));
  }

  for (const nodeId of protectedIds) {
    if (knownIds.has(nodeId) && !keptNodeIds.includes(nodeId)) keptNodeIds.push(nodeId);
  }

  const kept = new Set(keptNodeIds);
  if (kept.size === 0) {
    throw new Error('AI flow clean plan did not keep any known nodes.');
  }

  const removedNodeIds = flow.nodes
    .map((node) => node.id)
    .filter((nodeId) => !kept.has(nodeId));
  const reasons = (rawPlan.reasons ?? []).filter((reason) => knownIds.has(reason.nodeId));

  return {
    version: 1,
    keptNodeIds: flow.nodes.map((node) => node.id).filter((nodeId) => kept.has(nodeId)),
    removedNodeIds,
    reasons,
    ...(rawPlan.summary ? { summary: rawPlan.summary } : {}),
  };
}

function summarizeNode(flow: FliwrightFlowDocument, node: FliwrightFlowNode): Record<string, unknown> {
  return {
    id: node.id,
    type: node.type,
    title: node.title,
    route: node.route,
    selector: node.selector,
    operation: node.operation ? {
      kind: node.operation.kind,
      text: node.operation.text,
      action: node.operation.action,
      status: node.operation.status,
      confidence: node.operation.confidence,
      ignoreReason: node.operation.ignoreReason,
    } : undefined,
    figma: node.figma ? {
      fileKey: node.figma.fileKey,
      nodeId: node.figma.nodeId,
      componentName: node.figma.componentName,
      codeConnectId: node.figma.codeConnectId,
    } : undefined,
    decisionRules: node.decisionRules,
    notes: node.notes,
    outgoing: flow.edges
      .filter((edge) => edge.source === node.id)
      .map((edge) => ({ target: edge.target, label: edge.label, condition: edge.condition })),
  };
}

function compactEdges(
  flow: FliwrightFlowDocument,
  kept: Set<string>,
  keptNodes: FliwrightFlowNode[],
): FliwrightFlowEdge[] {
  const adjacency = new Map<string, FliwrightFlowEdge[]>();
  for (const edge of flow.edges) {
    const outgoing = adjacency.get(edge.source) ?? [];
    outgoing.push(edge);
    adjacency.set(edge.source, outgoing);
  }

  const edges: FliwrightFlowEdge[] = [];
  const edgeKeys = new Set<string>();
  const addEdge = (edge: FliwrightFlowEdge) => {
    const key = `${edge.source}->${edge.target}:${edge.label ?? ''}:${edge.condition ?? ''}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push(edge);
  };

  for (const source of keptNodes) {
    const queue = (adjacency.get(source.id) ?? []).map((edge) => ({ edge, removedNodeIds: [] as string[] }));
    const visited = new Set<string>();
    while (queue.length > 0) {
      const { edge, removedNodeIds } = queue.shift()!;
      if (visited.has(edge.target)) continue;
      visited.add(edge.target);

      if (kept.has(edge.target)) {
        if (removedNodeIds.length === 0) {
          addEdge(edge);
        } else {
          addEdge({
            id: `edge-${sanitizeEdgeId(source.id)}-${sanitizeEdgeId(edge.target)}`,
            source: source.id,
            target: edge.target,
            ...(edge.label ? { label: edge.label } : {}),
            ...(edge.condition ? { condition: edge.condition } : {}),
            metadata: {
              ...(edge.metadata ?? {}),
              cleaned: true,
              removedNodeIds,
            },
          });
        }
        continue;
      }

      const nextRemoved = [...removedNodeIds, edge.target];
      for (const next of adjacency.get(edge.target) ?? []) {
        queue.push({ edge: next, removedNodeIds: nextRemoved });
      }
    }
  }

  if (edges.length === 0 && keptNodes.length > 1) {
    for (let index = 1; index < keptNodes.length; index++) {
      addEdge({
        id: `edge-${sanitizeEdgeId(keptNodes[index - 1].id)}-${sanitizeEdgeId(keptNodes[index].id)}`,
        source: keptNodes[index - 1].id,
        target: keptNodes[index].id,
        metadata: { cleaned: true },
      });
    }
  }

  return edges;
}

function uniqueKnown(values: string[], knownIds: Set<string>): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    if (!knownIds.has(value) || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function sanitizeEdgeId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'node';
}
