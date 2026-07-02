import { describe, expect, it } from 'vitest';
import { buildFlowReviewReport } from '../../src/flow/FlowReviewReport.js';
import type { FlowReviewPlan } from '../../src/flow/FlowReviewPlan.js';

describe('buildFlowReviewReport', () => {
  it('classifies review items as passed, failed, missing, or pending', () => {
    const reviewPlan: FlowReviewPlan = {
      version: 1,
      flowId: 'checkout',
      title: 'Checkout',
      targets: [
        target('passed', 0.03, 4),
        target('failed', 0.03, 4),
        target('missing', 0.03, 4),
        target('pending', 0.03, 4),
        target('compare-error', 0.03, 4),
      ],
      missing: { figmaBindings: [], runtimeEntryPoints: [] },
    };

    const report = buildFlowReviewReport({
      reviewPlan,
      generatedAt: '2026-06-30T00:00:00.000Z',
      runtimeCaptures: [
        { flowNodeId: 'passed', screenshotPath: 'runtime/passed.png' },
        { flowNodeId: 'failed', screenshotPath: 'runtime/failed.png' },
        { flowNodeId: 'pending', screenshotPath: 'runtime/pending.png' },
        { flowNodeId: 'compare-error', screenshotPath: 'runtime/error.png' },
      ],
      figmaCaptures: [
        { flowNodeId: 'passed', screenshotPath: 'figma/passed.png' },
        { flowNodeId: 'failed', screenshotPath: 'figma/failed.png' },
        { flowNodeId: 'pending', screenshotPath: 'figma/pending.png' },
        { flowNodeId: 'compare-error', screenshotPath: 'figma/error.png' },
      ],
      comparisons: [
        { flowNodeId: 'passed', pixelDiff: 0.01, layoutPx: 2 },
        { flowNodeId: 'failed', pixelDiff: 0.08, layoutPx: 8, textMismatches: ['CTA differs'] },
        { flowNodeId: 'compare-error', error: 'Unsupported image format: expected PNG' },
      ],
    });

    expect(report.summary).toEqual({
      total: 5,
      passed: 1,
      failed: 2,
      missing: 1,
      pending: 1,
    });
    expect(report.items.map((item) => [item.flowNodeId, item.status])).toEqual([
      ['passed', 'passed'],
      ['failed', 'failed'],
      ['missing', 'missing'],
      ['pending', 'pending'],
      ['compare-error', 'failed'],
    ]);
    expect(report.items[1].issues).toEqual([
      'pixel diff 0.08 exceeds tolerance 0.03',
      'layout delta 8px exceeds tolerance 4px',
      'text mismatch: CTA differs',
    ]);
    expect(report.items[2].issues).toEqual([
      'missing runtime screenshot',
      'missing Figma screenshot',
    ]);
    expect(report.items[4].issues).toEqual([
      'visual comparison failed: Unsupported image format: expected PNG',
    ]);
  });
});

function target(flowNodeId: string, pixelDiff: number, layoutPx: number): FlowReviewPlan['targets'][number] {
  return {
    flowNodeId,
    title: flowNodeId,
    figma: {
      fileKey: 'ABC123',
      nodeId: `${flowNodeId}:1`,
    },
    runtimeHints: {},
    checks: ['visual-diff'],
    tolerance: { pixelDiff, layoutPx },
  };
}
