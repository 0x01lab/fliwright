import { describe, expect, it } from 'vitest';
import { validateFlow } from '../../src/flow/FlowValidator.js';
import type { FliwrightFlowDocument } from '../../src/flow/types.js';

describe('validateFlow', () => {
  it('reports structural errors and optional completeness warnings', () => {
    const flow: FliwrightFlowDocument = {
      version: 1,
      id: 'checkout',
      createdAt: '2026-06-30T00:00:00.000Z',
      updatedAt: '2026-06-30T00:00:00.000Z',
      nodes: [
        { id: 'screen-1', type: 'screen', title: 'Screen' },
        { id: 'screen-1', type: 'screen', title: 'Duplicate' },
        { id: 'figma-1', type: 'figma', title: 'Missing node', figma: { fileKey: 'ABC123', nodeId: '' } },
        { id: 'figma-2', type: 'figma', title: 'Missing code target', figma: { fileKey: 'ABC123', nodeId: '1:2' } },
      ],
      edges: [
        { id: 'edge-1', source: 'screen-1', target: 'missing-node' },
      ],
    };

    const result = validateFlow(flow, {
      requireCodeTargetForFigmaNodes: true,
      requireReviewRuntimeEntryForFigmaNodes: true,
    });

    expect(result.valid).toBe(false);
    expect(result.errorCount).toBe(3);
    expect(result.warningCount).toBe(2);
    expect(result.issues).toEqual([
      expect.objectContaining({ severity: 'error', code: 'duplicate_node_id', nodeId: 'screen-1' }),
      expect.objectContaining({ severity: 'error', code: 'edge_target_missing', edgeId: 'edge-1' }),
      expect.objectContaining({ severity: 'error', code: 'figma_node_id_missing', nodeId: 'figma-1' }),
      expect.objectContaining({ severity: 'warning', code: 'code_target_missing', nodeId: 'figma-2' }),
      expect.objectContaining({ severity: 'warning', code: 'review_runtime_entry_missing', nodeId: 'figma-2' }),
    ]);
  });

  it('passes a complete flow', () => {
    const flow: FliwrightFlowDocument = {
      version: 1,
      id: 'checkout',
      createdAt: '2026-06-30T00:00:00.000Z',
      updatedAt: '2026-06-30T00:00:00.000Z',
      nodes: [
        {
          id: 'figma-1',
          type: 'figma',
          title: 'Bound',
          route: '/checkout',
          figma: {
            fileKey: 'ABC123',
            nodeId: '1:2',
            componentName: 'CheckoutView',
          },
        },
      ],
      edges: [],
    };

    expect(validateFlow(flow, {
      requireCodeTargetForFigmaNodes: true,
      requireReviewRuntimeEntryForFigmaNodes: true,
    })).toEqual({
      valid: true,
      issueCount: 0,
      errorCount: 0,
      warningCount: 0,
      issues: [],
    });
  });
});
