import { describe, expect, it } from 'vitest';
import { generateFlowTestSkeleton } from '../../src/flow/FlowTestGenerator.js';
import type { FliwrightFlowDocument } from '../../src/flow/types.js';

describe('generateFlowTestSkeleton', () => {
  it('generates a Fliwright/Vitest skeleton from flow nodes', () => {
    const flow: FliwrightFlowDocument = {
      version: 1,
      id: 'checkout',
      title: 'Checkout',
      createdAt: '2026-06-30T00:00:00.000Z',
      updatedAt: '2026-06-30T01:00:00.000Z',
      nodes: [
        {
          id: 'screen-1',
          type: 'screen',
          title: 'Open checkout',
          route: '/checkout',
          selector: 'text=Pay',
        },
        {
          id: 'action-1',
          type: 'action',
          title: 'Tap Pay',
          selector: 'text=Pay',
          operation: {
            kind: 'tap',
            position: { x: 100, y: 200 },
            timestamp: 1000,
          },
        },
        {
          id: 'figma-1',
          type: 'figma',
          title: 'Design target',
          notes: 'Implement pending payment state',
          figma: {
            fileKey: 'ABC123',
            nodeId: '120:340',
            url: 'https://www.figma.com/design/ABC123/File?node-id=120-340',
          },
        },
        {
          id: 'decision-1',
          type: 'decision',
          title: 'Payment status',
          decisionRules: [
            { id: 'rule-1', label: 'Pending', when: 'payment.pending', target: 'figma-1' },
          ],
        },
      ],
      edges: [],
    };

    const code = generateFlowTestSkeleton(flow, {
      resetToHomeBeforeEach: true,
      homeRoute: '/',
    });

    expect(code).toContain("import { test, expect, beforeEach } from '@fliwright/vitest';");
    expect(code).toContain("await page.resetToHome({ homeRoute: '/' });");
    expect(code).toContain("test('Checkout', async ({ page, flow }) => {");
    expect(code).toContain("await flow.step('Open checkout', async () => {");
    expect(code).toContain("await page.goto('/checkout');");
    expect(code).toContain("await expect(page.locator('text=Pay')).toBeVisible();");
    expect(code).toContain("await page.locator('text=Pay').click();");
    expect(code).toContain("// Figma ABC123 120:340 https://www.figma.com/design/ABC123/File?node-id=120-340");
    expect(code).toContain("// Implement pending payment state");
    expect(code).toContain("// Decision rules");
    expect(code).toContain("// - Pending: payment.pending -> figma-1");
  });
});
