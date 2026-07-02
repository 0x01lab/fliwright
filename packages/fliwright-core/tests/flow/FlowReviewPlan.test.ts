import { describe, expect, it } from 'vitest';
import { buildFlowReviewPlan } from '../../src/flow/FlowReviewPlan.js';
import type { FliwrightFlowDocument } from '../../src/flow/types.js';

describe('buildFlowReviewPlan', () => {
  it('builds UI review targets from nodes with Figma and runtime entry points', () => {
    const flow: FliwrightFlowDocument = {
      version: 1,
      id: 'checkout',
      title: 'Checkout',
      createdAt: '2026-06-30T00:00:00.000Z',
      updatedAt: '2026-06-30T01:00:00.000Z',
      source: { kind: 'recording', testName: 'checkout test' },
      nodes: [
        {
          id: 'screen-1',
          type: 'screen',
          title: 'Checkout screen',
          route: '/checkout',
          selector: 'text=Pay',
          recordingFrameId: 'frame-1',
          operationIndex: 0,
          screenshot: { source: 'recording-frame', recordingFrameId: 'frame-1', width: 390, height: 844 },
          figma: {
            fileKey: 'ABC123',
            nodeId: '120:340',
            url: 'https://www.figma.com/design/ABC123/File?node-id=120-340',
            name: 'Checkout screen',
          },
        },
        {
          id: 'figma-missing-node',
          type: 'figma',
          title: 'Needs Figma node',
          figma: { fileKey: 'ABC123', nodeId: '' },
        },
        {
          id: 'missing-runtime',
          type: 'figma',
          title: 'Needs runtime entry',
          figma: { fileKey: 'ABC123', nodeId: '200:300' },
        },
      ],
      edges: [],
    };

    const plan = buildFlowReviewPlan(flow, {
      pixelDiffTolerance: 0.05,
      layoutPxTolerance: 6,
    });

    expect(plan.targets).toEqual([
      expect.objectContaining({
        flowNodeId: 'screen-1',
        title: 'Checkout screen',
        route: '/checkout',
        selector: 'text=Pay',
        figma: {
          fileKey: 'ABC123',
          nodeId: '120:340',
          url: 'https://www.figma.com/design/ABC123/File?node-id=120-340',
          name: 'Checkout screen',
        },
        runtimeHints: expect.objectContaining({
          recordingFrameId: 'frame-1',
          operationIndex: 0,
          screenshot: expect.objectContaining({ recordingFrameId: 'frame-1' }),
        }),
        checks: ['visual-diff', 'text-content', 'design-token', 'component-mapping'],
        tolerance: {
          pixelDiff: 0.05,
          layoutPx: 6,
        },
      }),
    ]);
    expect(plan.missing.figmaBindings).toEqual([
      { flowNodeId: 'figma-missing-node', title: 'Needs Figma node', reason: 'missing nodeId' },
    ]);
    expect(plan.missing.runtimeEntryPoints).toEqual([
      {
        flowNodeId: 'missing-runtime',
        title: 'Needs runtime entry',
        reason: 'missing route, selector, recordingFrameId, or screenshot',
      },
    ]);
  });
});
