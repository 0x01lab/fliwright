import type { FliwrightFlowDocument, FliwrightFlowNode } from './types.js';

export interface FlowAgentSpecNode {
  id: string;
  type: FliwrightFlowNode['type'];
  title: string;
  route?: string;
  selector?: string;
  notes?: string;
  figma?: FliwrightFlowNode['figma'];
  decisionRules?: FliwrightFlowNode['decisionRules'];
  codeTarget?: {
    componentName?: string;
    codeConnectId?: string;
  };
  testHints?: {
    recordingFrameId?: string;
    operationIndex?: number;
    screenshot?: FliwrightFlowNode['screenshot'];
  };
  outgoing: Array<{
    target: string;
    label?: string;
    condition?: string;
  }>;
  incoming: Array<{
    source: string;
    label?: string;
    condition?: string;
  }>;
}

export interface FlowAgentImplementationPlan {
  steps: string[];
  figmaContext: FlowAgentSpec['figmaMcpRequests'];
  decisionBranches: Array<{
    flowNodeId: string;
    title: string;
    rules: NonNullable<FliwrightFlowNode['decisionRules']>;
    outgoing: FlowAgentSpecNode['outgoing'];
  }>;
  codeTargets: Array<{
    flowNodeId: string;
    title: string;
    componentName?: string;
    codeConnectId?: string;
  }>;
  testTargets: Array<{
    flowNodeId: string;
    title: string;
    route?: string;
    selector?: string;
  }>;
}

export interface FlowAgentSpec {
  version: 1;
  flowId: string;
  title?: string;
  source?: FliwrightFlowDocument['source'];
  summary: {
    nodeCount: number;
    edgeCount: number;
    figmaBoundCount: number;
    routeCount: number;
    selectorCount: number;
    codeTargetCount: number;
  };
  nodes: FlowAgentSpecNode[];
  figmaBindings: Array<{
    flowNodeId: string;
    title: string;
    fileKey: string;
    nodeId: string;
    url?: string;
    name?: string;
    codeConnectId?: string;
    componentName?: string;
  }>;
  figmaMcpRequests: Array<{
    flowNodeId: string;
    title: string;
    tool: 'get_design_context';
    fileKey: string;
    nodeId: string;
    url?: string;
  }>;
  routes: Array<{
    flowNodeId: string;
    route: string;
  }>;
  selectors: Array<{
    flowNodeId: string;
    selector: string;
  }>;
  implementationPlan: FlowAgentImplementationPlan;
  missing: {
    figmaNodeIds: Array<{ flowNodeId: string; title: string; reason: string }>;
    codeTargets: Array<{ flowNodeId: string; title: string; reason: string }>;
  };
}

export function buildFlowAgentSpec(flow: FliwrightFlowDocument): FlowAgentSpec {
  const nodes = flow.nodes.map((node) => agentNodeForFlowNode(flow, node));
  const figmaBindings = flow.nodes.flatMap((node) => {
    if (!node.figma?.fileKey || !node.figma.nodeId) return [];
    return [{
      flowNodeId: node.id,
      title: node.title,
      fileKey: node.figma.fileKey,
      nodeId: node.figma.nodeId,
      ...(node.figma.url ? { url: node.figma.url } : {}),
      ...(node.figma.name ? { name: node.figma.name } : {}),
      ...(node.figma.codeConnectId ? { codeConnectId: node.figma.codeConnectId } : {}),
      ...(node.figma.componentName ? { componentName: node.figma.componentName } : {}),
    }];
  });
  const routes = flow.nodes.flatMap((node) => node.route ? [{ flowNodeId: node.id, route: node.route }] : []);
  const selectors = flow.nodes.flatMap((node) => node.selector ? [{ flowNodeId: node.id, selector: node.selector }] : []);
  const codeTargetCount = flow.nodes.filter((node) => node.figma?.codeConnectId || node.figma?.componentName).length;
  const figmaMcpRequests = figmaBindings.map((binding) => ({
    flowNodeId: binding.flowNodeId,
    title: binding.title,
    tool: 'get_design_context' as const,
    fileKey: binding.fileKey,
    nodeId: binding.nodeId,
    ...(binding.url ? { url: binding.url } : {}),
  }));

  return {
    version: 1,
    flowId: flow.id,
    ...(flow.title ? { title: flow.title } : {}),
    ...(flow.source ? { source: flow.source } : {}),
    summary: {
      nodeCount: flow.nodes.length,
      edgeCount: flow.edges.length,
      figmaBoundCount: figmaBindings.length,
      routeCount: routes.length,
      selectorCount: selectors.length,
      codeTargetCount,
    },
    nodes,
    figmaBindings,
    figmaMcpRequests,
    routes,
    selectors,
    implementationPlan: buildImplementationPlan(flow, nodes, figmaMcpRequests),
    missing: {
      figmaNodeIds: missingFigmaBindings(flow.nodes),
      codeTargets: missingCodeTargets(flow.nodes),
    },
  };
}

function agentNodeForFlowNode(flow: FliwrightFlowDocument, node: FliwrightFlowNode): FlowAgentSpecNode {
  const outgoing = flow.edges
    .filter((edge) => edge.source === node.id)
    .map((edge) => ({
      target: edge.target,
      ...(edge.label ? { label: edge.label } : {}),
      ...(edge.condition ? { condition: edge.condition } : {}),
    }));
  const incoming = flow.edges
    .filter((edge) => edge.target === node.id)
    .map((edge) => ({
      source: edge.source,
      ...(edge.label ? { label: edge.label } : {}),
      ...(edge.condition ? { condition: edge.condition } : {}),
    }));

  return {
    id: node.id,
    type: node.type,
    title: node.title,
    ...(node.route ? { route: node.route } : {}),
    ...(node.selector ? { selector: node.selector } : {}),
    ...(node.notes ? { notes: node.notes } : {}),
    ...(node.figma ? { figma: node.figma } : {}),
    ...(node.decisionRules?.length ? { decisionRules: node.decisionRules } : {}),
    ...(node.figma?.componentName || node.figma?.codeConnectId ? {
      codeTarget: {
        ...(node.figma.componentName ? { componentName: node.figma.componentName } : {}),
        ...(node.figma.codeConnectId ? { codeConnectId: node.figma.codeConnectId } : {}),
      },
    } : {}),
    ...(node.recordingFrameId || node.operationIndex != null || node.screenshot ? {
      testHints: {
        ...(node.recordingFrameId ? { recordingFrameId: node.recordingFrameId } : {}),
        ...(node.operationIndex != null ? { operationIndex: node.operationIndex } : {}),
        ...(node.screenshot ? { screenshot: node.screenshot } : {}),
      },
    } : {}),
    outgoing,
    incoming,
  };
}

function buildImplementationPlan(
  flow: FliwrightFlowDocument,
  nodes: FlowAgentSpecNode[],
  figmaMcpRequests: FlowAgentSpec['figmaMcpRequests'],
): FlowAgentImplementationPlan {
  const codeTargets = flow.nodes
    .filter((node) => node.figma?.componentName || node.figma?.codeConnectId)
    .map((node) => ({
      flowNodeId: node.id,
      title: node.title,
      ...(node.figma?.componentName ? { componentName: node.figma.componentName } : {}),
      ...(node.figma?.codeConnectId ? { codeConnectId: node.figma.codeConnectId } : {}),
    }));
  const testTargets = flow.nodes
    .filter((node) => node.route || node.selector)
    .map((node) => ({
      flowNodeId: node.id,
      title: node.title,
      ...(node.route ? { route: node.route } : {}),
      ...(node.selector ? { selector: node.selector } : {}),
    }));
  const decisionBranches = nodes
    .filter((node) => node.type === 'decision' || node.decisionRules?.length)
    .map((node) => ({
      flowNodeId: node.id,
      title: node.title,
      rules: node.decisionRules ?? [],
      outgoing: node.outgoing,
    }));

  return {
    steps: [
      'Read all figmaContext entries with Figma MCP before implementing bound UI nodes.',
      'Map codeTargets to existing components when componentName or codeConnectId is present.',
      'Implement routes and selectors in flow order, preserving outgoing edge labels and conditions as business branches.',
      'Implement decisionBranches as explicit state or guard logic instead of implicit nested conditionals.',
      'Generate or update Fliwright tests for every testTarget and run UI review for every Figma-bound runtime target.',
    ],
    figmaContext: figmaMcpRequests,
    decisionBranches,
    codeTargets,
    testTargets,
  };
}

function missingFigmaBindings(nodes: FliwrightFlowNode[]): FlowAgentSpec['missing']['figmaNodeIds'] {
  return nodes
    .filter((node) => node.type === 'figma' || Boolean(node.figma))
    .filter((node) => !node.figma?.fileKey || !node.figma.nodeId)
    .map((node) => ({
      flowNodeId: node.id,
      title: node.title,
      reason: !node.figma?.fileKey ? 'missing fileKey' : 'missing nodeId',
    }));
}

function missingCodeTargets(nodes: FliwrightFlowNode[]): FlowAgentSpec['missing']['codeTargets'] {
  return nodes
    .filter((node) => Boolean(node.figma?.fileKey && node.figma.nodeId))
    .filter((node) => !node.figma?.componentName && !node.figma?.codeConnectId)
    .map((node) => ({
      flowNodeId: node.id,
      title: node.title,
      reason: 'missing componentName or codeConnectId',
    }));
}
