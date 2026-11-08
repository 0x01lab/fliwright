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
  /** Absent for targets excluded by incomplete bindings or runtime entry points. */
  figma?: FlowReviewPlan['targets'][number]['figma'];
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

/** Builds review coverage, retaining plan omissions and failures from all comparison sources. */
export function buildFlowReviewReport(input: FlowReviewReportInput): FlowReviewReport {
  const runtimeByNode = new Map((input.runtimeCaptures ?? []).map((capture) => [capture.flowNodeId, capture]));
  const figmaByNode = new Map((input.figmaCaptures ?? []).map((capture) => [capture.flowNodeId, capture]));
  const comparisonByNode = new Map<string, FlowReviewComparisonInput>();
  for (const comparison of input.comparisons ?? []) {
    comparisonByNode.set(comparison.flowNodeId, mergeComparisons(comparisonByNode.get(comparison.flowNodeId), comparison));
  }
  const items: FlowReviewReportItem[] = input.reviewPlan.targets.map((target) => {
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

  for (const missing of [...input.reviewPlan.missing.figmaBindings, ...input.reviewPlan.missing.runtimeEntryPoints]) {
    const existing = items.find((item) => item.flowNodeId === missing.flowNodeId);
    if (existing) {
      existing.status = 'missing';
      existing.issues.push(missing.reason);
    } else {
      items.push({ flowNodeId: missing.flowNodeId, title: missing.title, status: 'missing', issues: [missing.reason] });
    }
  }

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

function mergeComparisons(
  previous: FlowReviewComparisonInput | undefined,
  next: FlowReviewComparisonInput,
): FlowReviewComparisonInput {
  const merged = { ...previous, ...next };
  for (const key of ['pixelDiff', 'layoutPx'] as const) {
    const values = [previous?.[key], next[key]].filter((value): value is number => value != null);
    if (values.length) merged[key] = Math.max(...values);
  }
  for (const key of ['textMismatches', 'tokenMismatches', 'componentMismatches'] as const) {
    if (previous?.[key] || next[key]) merged[key] = [...new Set([...(previous?.[key] ?? []), ...(next[key] ?? [])])];
  }
  for (const key of ['error', 'notes'] as const) {
    const values = [previous?.[key], next[key]].filter((value): value is string => Boolean(value));
    if (values.length) merged[key] = [...new Set(values)].join('; ');
  }
  return merged;
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
  if (!comparison || !['pixelDiff', 'layoutPx', 'textMismatches', 'tokenMismatches', 'componentMismatches', 'error']
    .some((key) => comparison[key as keyof FlowReviewComparisonInput] != null)) return 'pending';
  return issues.length ? 'failed' : 'passed';
}
