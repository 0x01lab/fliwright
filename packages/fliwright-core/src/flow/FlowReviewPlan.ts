import type { FliwrightFlowDocument, FliwrightFlowNode } from './types.js';

export interface FlowReviewTarget {
  flowNodeId: string;
  title: string;
  route?: string;
  selector?: string;
  figma: {
    fileKey: string;
    nodeId: string;
    url?: string;
    name?: string;
  };
  runtimeHints: {
    recordingFrameId?: string;
    operationIndex?: number;
    screenshot?: FliwrightFlowNode['screenshot'];
  };
  checks: Array<'visual-diff' | 'text-content' | 'design-token' | 'component-mapping'>;
  tolerance: {
    pixelDiff: number;
    layoutPx: number;
  };
}

export interface FlowReviewPlan {
  version: 1;
  flowId: string;
  title?: string;
  source?: FliwrightFlowDocument['source'];
  targets: FlowReviewTarget[];
  missing: {
    figmaBindings: Array<{ flowNodeId: string; title: string; reason: string }>;
    runtimeEntryPoints: Array<{ flowNodeId: string; title: string; reason: string }>;
  };
}

export interface FlowReviewPlanOptions {
  checks?: FlowReviewTarget['checks'];
  pixelDiffTolerance?: number;
  layoutPxTolerance?: number;
}

const DEFAULT_CHECKS: FlowReviewTarget['checks'] = ['visual-diff', 'text-content', 'design-token', 'component-mapping'];

export function buildFlowReviewPlan(
  flow: FliwrightFlowDocument,
  options: FlowReviewPlanOptions = {},
): FlowReviewPlan {
  const targets = flow.nodes
    .filter((node) => hasCompleteFigmaBinding(node))
    .filter((node) => hasRuntimeEntryPoint(node))
    .map((node) => reviewTargetForNode(node, options));

  return {
    version: 1,
    flowId: flow.id,
    ...(flow.title ? { title: flow.title } : {}),
    ...(flow.source ? { source: flow.source } : {}),
    targets,
    missing: {
      figmaBindings: missingFigmaBindings(flow.nodes),
      runtimeEntryPoints: missingRuntimeEntryPoints(flow.nodes),
    },
  };
}

function reviewTargetForNode(node: FliwrightFlowNode, options: FlowReviewPlanOptions): FlowReviewTarget {
  return {
    flowNodeId: node.id,
    title: node.title,
    ...(node.route ? { route: node.route } : {}),
    ...(node.selector ? { selector: node.selector } : {}),
    figma: {
      fileKey: node.figma!.fileKey,
      nodeId: node.figma!.nodeId,
      ...(node.figma!.url ? { url: node.figma!.url } : {}),
      ...(node.figma!.name ? { name: node.figma!.name } : {}),
    },
    runtimeHints: {
      ...(node.recordingFrameId ? { recordingFrameId: node.recordingFrameId } : {}),
      ...(node.operationIndex != null ? { operationIndex: node.operationIndex } : {}),
      ...(node.screenshot ? { screenshot: node.screenshot } : {}),
    },
    checks: options.checks ?? DEFAULT_CHECKS,
    tolerance: {
      pixelDiff: options.pixelDiffTolerance ?? 0.03,
      layoutPx: options.layoutPxTolerance ?? 4,
    },
  };
}

function hasCompleteFigmaBinding(node: FliwrightFlowNode): boolean {
  return Boolean(node.figma?.fileKey && node.figma.nodeId);
}

function hasRuntimeEntryPoint(node: FliwrightFlowNode): boolean {
  return Boolean(node.route || node.selector || node.recordingFrameId || node.screenshot);
}

function missingFigmaBindings(nodes: FliwrightFlowNode[]): FlowReviewPlan['missing']['figmaBindings'] {
  return nodes
    .filter((node) => node.type === 'figma' || Boolean(node.figma))
    .filter((node) => !hasCompleteFigmaBinding(node))
    .map((node) => ({
      flowNodeId: node.id,
      title: node.title,
      reason: !node.figma?.fileKey ? 'missing fileKey' : 'missing nodeId',
    }));
}

function missingRuntimeEntryPoints(nodes: FliwrightFlowNode[]): FlowReviewPlan['missing']['runtimeEntryPoints'] {
  return nodes
    .filter((node) => hasCompleteFigmaBinding(node))
    .filter((node) => !hasRuntimeEntryPoint(node))
    .map((node) => ({
      flowNodeId: node.id,
      title: node.title,
      reason: 'missing route, selector, recordingFrameId, or screenshot',
    }));
}
