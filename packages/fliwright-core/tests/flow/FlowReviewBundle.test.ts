import { describe, expect, it } from 'vitest';
import { buildFlowReviewBundle } from '../../src/flow/FlowReviewBundle.js';
import type { FliwrightFlowDocument } from '../../src/flow/types.js';

describe('buildFlowReviewBundle', () => {
  it('builds Figma MCP and Fliwright MCP review tasks from bound runtime targets', () => {
    const flow: FliwrightFlowDocument = {
      version: 1,
      id: 'checkout',
      title: 'Checkout',
      createdAt: '2026-06-30T00:00:00.000Z',
      updatedAt: '2026-06-30T01:00:00.000Z',
      source: { kind: 'manual' },
      nodes: [
        {
          id: 'checkout-screen',
          type: 'screen',
          title: 'Checkout screen',
          route: '/checkout',
          figma: {
            fileKey: 'ABC123',
            nodeId: '10:20',
            url: 'https://www.figma.com/design/ABC123/File?node-id=10-20',
          },
        },
        {
          id: 'figma-only',
          type: 'figma',
          title: 'Design only',
          figma: { fileKey: 'ABC123', nodeId: '30:40' },
        },
      ],
      edges: [],
    };

    const bundle = buildFlowReviewBundle(flow, {
      flowPath: '/workspace/.fliwright/flows/checkout.flow.json',
      outputDir: '.fliwright/reviews/checkout-bundle',
      generatedAt: '2026-07-01T00:00:00.000Z',
    });

    expect(bundle).toMatchObject({
      version: 1,
      flowId: 'checkout',
      title: 'Checkout',
      generatedAt: '2026-07-01T00:00:00.000Z',
      artifacts: {
        rootDir: '.fliwright/reviews/checkout-bundle',
        runtimeDir: '.fliwright/reviews/checkout-bundle/runtime',
        figmaDir: '.fliwright/reviews/checkout-bundle/figma',
        reportPath: '.fliwright/reviews/checkout-bundle/checkout-report.json',
      },
    });
    expect(bundle.reviewPlan.targets.map((target) => target.flowNodeId)).toEqual(['checkout-screen']);
    expect(bundle.figmaMcp.tasks).toEqual([
      {
        flowNodeId: 'checkout-screen',
        title: 'Checkout screen',
        fileKey: 'ABC123',
        nodeId: '10:20',
        url: 'https://www.figma.com/design/ABC123/File?node-id=10-20',
        screenshotPath: '.fliwright/reviews/checkout-bundle/figma/001-checkout-screen.png',
        metadataPath: '.fliwright/reviews/checkout-bundle/figma/001-checkout-screen.metadata.json',
        mcpTool: 'figma.get_screenshot',
      },
    ]);
    expect(bundle.fliwrightMcp.runtimeCapture.args).toEqual({
      path: '/workspace/.fliwright/flows/checkout.flow.json',
      outputDir: '.fliwright/reviews/checkout-bundle/runtime',
      targetIds: ['checkout-screen'],
    });
    expect(bundle.fliwrightMcp.report.args).toEqual({
      path: '/workspace/.fliwright/flows/checkout.flow.json',
      outputPath: '.fliwright/reviews/checkout-bundle/checkout-report.json',
      autoCompare: true,
      runtimeCaptures: '.fliwright/reviews/checkout-bundle/runtime/runtime-captures.json',
      figmaCaptures: '.fliwright/reviews/checkout-bundle/figma/figma-captures.json',
    });
  });
});
