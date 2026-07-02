import type { FliwrightFlowDocument, FliwrightFlowNode } from './types.js';

export type FlowValidationSeverity = 'error' | 'warning';

export interface FlowValidationIssue {
  severity: FlowValidationSeverity;
  code:
    | 'duplicate_node_id'
    | 'edge_source_missing'
    | 'edge_target_missing'
    | 'figma_file_key_missing'
    | 'figma_node_id_missing'
    | 'code_target_missing'
    | 'review_runtime_entry_missing';
  message: string;
  nodeId?: string;
  edgeId?: string;
}

export interface FlowValidationResult {
  valid: boolean;
  issueCount: number;
  errorCount: number;
  warningCount: number;
  issues: FlowValidationIssue[];
}

export interface FlowValidationOptions {
  requireFigmaForFigmaNodes?: boolean;
  requireCodeTargetForFigmaNodes?: boolean;
  requireReviewRuntimeEntryForFigmaNodes?: boolean;
}

export function validateFlow(
  flow: FliwrightFlowDocument,
  options: FlowValidationOptions = {},
): FlowValidationResult {
  const issues: FlowValidationIssue[] = [
    ...duplicateNodeIdIssues(flow),
    ...danglingEdgeIssues(flow),
    ...figmaBindingIssues(flow, options),
    ...reviewRuntimeIssues(flow, options),
  ];
  const errorCount = issues.filter((issue) => issue.severity === 'error').length;
  const warningCount = issues.filter((issue) => issue.severity === 'warning').length;
  return {
    valid: errorCount === 0,
    issueCount: issues.length,
    errorCount,
    warningCount,
    issues,
  };
}

function duplicateNodeIdIssues(flow: FliwrightFlowDocument): FlowValidationIssue[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const node of flow.nodes) {
    if (seen.has(node.id)) duplicates.add(node.id);
    seen.add(node.id);
  }
  return [...duplicates].map((nodeId) => ({
    severity: 'error',
    code: 'duplicate_node_id',
    nodeId,
    message: `Duplicate flow node id: ${nodeId}`,
  }));
}

function danglingEdgeIssues(flow: FliwrightFlowDocument): FlowValidationIssue[] {
  const nodeIds = new Set(flow.nodes.map((node) => node.id));
  return flow.edges.flatMap((edge) => {
    const issues: FlowValidationIssue[] = [];
    if (!nodeIds.has(edge.source)) {
      issues.push({
        severity: 'error',
        code: 'edge_source_missing',
        edgeId: edge.id,
        message: `Edge ${edge.id} references missing source node ${edge.source}`,
      });
    }
    if (!nodeIds.has(edge.target)) {
      issues.push({
        severity: 'error',
        code: 'edge_target_missing',
        edgeId: edge.id,
        message: `Edge ${edge.id} references missing target node ${edge.target}`,
      });
    }
    return issues;
  });
}

function figmaBindingIssues(flow: FliwrightFlowDocument, options: FlowValidationOptions): FlowValidationIssue[] {
  const requireFigma = options.requireFigmaForFigmaNodes ?? true;
  return flow.nodes.flatMap((node) => {
    const shouldCheck = Boolean(node.figma) || (requireFigma && node.type === 'figma');
    if (!shouldCheck) return [];
    const issues: FlowValidationIssue[] = [];
    if (!node.figma?.fileKey) {
      issues.push({
        severity: 'error',
        code: 'figma_file_key_missing',
        nodeId: node.id,
        message: `Figma binding on ${node.id} is missing fileKey`,
      });
    }
    if (!node.figma?.nodeId) {
      issues.push({
        severity: 'error',
        code: 'figma_node_id_missing',
        nodeId: node.id,
        message: `Figma binding on ${node.id} is missing nodeId`,
      });
    }
    if (
      options.requireCodeTargetForFigmaNodes &&
      node.figma?.fileKey &&
      node.figma.nodeId &&
      !node.figma.componentName &&
      !node.figma.codeConnectId
    ) {
      issues.push({
        severity: 'warning',
        code: 'code_target_missing',
        nodeId: node.id,
        message: `Figma binding on ${node.id} is missing componentName or codeConnectId`,
      });
    }
    return issues;
  });
}

function reviewRuntimeIssues(flow: FliwrightFlowDocument, options: FlowValidationOptions): FlowValidationIssue[] {
  if (!options.requireReviewRuntimeEntryForFigmaNodes) return [];
  return flow.nodes
    .filter((node) => node.figma?.fileKey && node.figma.nodeId)
    .filter((node) => !hasRuntimeEntryPoint(node))
    .map((node) => ({
      severity: 'warning',
      code: 'review_runtime_entry_missing',
      nodeId: node.id,
      message: `Figma-bound node ${node.id} is missing route, selector, recordingFrameId, or screenshot`,
    }));
}

function hasRuntimeEntryPoint(node: FliwrightFlowNode): boolean {
  return Boolean(node.route || node.selector || node.recordingFrameId || node.screenshot);
}
