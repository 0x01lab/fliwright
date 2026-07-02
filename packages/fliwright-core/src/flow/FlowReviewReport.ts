import type { FlowReviewPlan } from './FlowReviewPlan.js';

export interface FlowReviewArtifactInput {
  flowNodeId: string;
  screenshotPath?: string;
  error?: string;
}

export interface FlowReviewComparisonInput {
  flowNodeId: string;
  pixelDiff?: number;
  layoutPx?: number;
  textMismatches?: string[];
  tokenMismatches?: string[];
  componentMismatches?: string[];
  error?: string;
  notes?: string;
}

export type FlowReviewItemStatus = 'passed' | 'failed' | 'missing' | 'pending';

export interface FlowReviewReportItem {
  flowNodeId: string;
  title: string;
  route?: string;
  figma: FlowReviewPlan['targets'][number]['figma'];
  runtimeScreenshotPath?: string;
  figmaScreenshotPath?: string;
  comparison?: FlowReviewComparisonInput;
  status: FlowReviewItemStatus;
  issues: string[];
}

export interface FlowReviewReport {
  version: 1;
  flowId: string;
  title?: string;
  generatedAt: string;
  summary: {
    total: number;
    passed: number;
    failed: number;
    missing: number;
    pending: number;
  };
  items: FlowReviewReportItem[];
}

export interface FlowReviewReportInput {
  reviewPlan: FlowReviewPlan;
  runtimeCaptures?: FlowReviewArtifactInput[];
  figmaCaptures?: FlowReviewArtifactInput[];
  comparisons?: FlowReviewComparisonInput[];
  generatedAt?: string;
}

export function buildFlowReviewReport(input: FlowReviewReportInput): FlowReviewReport {
  const runtimeByNode = new Map((input.runtimeCaptures ?? []).map((capture) => [capture.flowNodeId, capture]));
  const figmaByNode = new Map((input.figmaCaptures ?? []).map((capture) => [capture.flowNodeId, capture]));
  const comparisonByNode = new Map((input.comparisons ?? []).map((comparison) => [comparison.flowNodeId, comparison]));
  const items = input.reviewPlan.targets.map((target) => {
    const runtime = runtimeByNode.get(target.flowNodeId);
    const figma = figmaByNode.get(target.flowNodeId);
    const comparison = comparisonByNode.get(target.flowNodeId);
    const issues = issuesForTarget(target, runtime, figma, comparison);
    return {
      flowNodeId: target.flowNodeId,
      title: target.title,
      ...(target.route ? { route: target.route } : {}),
      figma: target.figma,
      ...(runtime?.screenshotPath ? { runtimeScreenshotPath: runtime.screenshotPath } : {}),
      ...(figma?.screenshotPath ? { figmaScreenshotPath: figma.screenshotPath } : {}),
      ...(comparison ? { comparison } : {}),
      status: statusForIssues(runtime, figma, comparison, issues),
      issues,
    };
  });

  return {
    version: 1,
    flowId: input.reviewPlan.flowId,
    ...(input.reviewPlan.title ? { title: input.reviewPlan.title } : {}),
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    summary: {
      total: items.length,
      passed: items.filter((item) => item.status === 'passed').length,
      failed: items.filter((item) => item.status === 'failed').length,
      missing: items.filter((item) => item.status === 'missing').length,
      pending: items.filter((item) => item.status === 'pending').length,
    },
    items,
  };
}

function issuesForTarget(
  target: FlowReviewPlan['targets'][number],
  runtime: FlowReviewArtifactInput | undefined,
  figma: FlowReviewArtifactInput | undefined,
  comparison: FlowReviewComparisonInput | undefined,
): string[] {
  const issues: string[] = [];
  if (!runtime?.screenshotPath) issues.push(runtime?.error ?? 'missing runtime screenshot');
  if (!figma?.screenshotPath) issues.push(figma?.error ?? 'missing Figma screenshot');
  if (!comparison) return issues;
  if (comparison.error) issues.push(`visual comparison failed: ${comparison.error}`);
  if (comparison.pixelDiff != null && comparison.pixelDiff > target.tolerance.pixelDiff) {
    issues.push(`pixel diff ${comparison.pixelDiff} exceeds tolerance ${target.tolerance.pixelDiff}`);
  }
  if (comparison.layoutPx != null && comparison.layoutPx > target.tolerance.layoutPx) {
    issues.push(`layout delta ${comparison.layoutPx}px exceeds tolerance ${target.tolerance.layoutPx}px`);
  }
  for (const mismatch of comparison.textMismatches ?? []) issues.push(`text mismatch: ${mismatch}`);
  for (const mismatch of comparison.tokenMismatches ?? []) issues.push(`token mismatch: ${mismatch}`);
  for (const mismatch of comparison.componentMismatches ?? []) issues.push(`component mismatch: ${mismatch}`);
  return issues;
}

function statusForIssues(
  runtime: FlowReviewArtifactInput | undefined,
  figma: FlowReviewArtifactInput | undefined,
  comparison: FlowReviewComparisonInput | undefined,
  issues: string[],
): FlowReviewItemStatus {
  if (!runtime?.screenshotPath || !figma?.screenshotPath) return 'missing';
  if (!comparison) return 'pending';
  return issues.length ? 'failed' : 'passed';
}
