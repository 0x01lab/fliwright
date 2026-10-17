import { describe, expect, it } from 'vitest';
import { generateFlowTestSkeleton } from '../../src/flow/FlowTestGenerator.js';
import type { FliwrightFlowDocument } from '../../src/flow/types.js';

describe('generateFlowTestSkeleton', () => {
  it('preserves recorded pointer timing through an editable flow', async () => {
    const { buildFlowFromRecording } = await import('../../src/flow/RecordingFlowBuilder.js');
    const flow = buildFlowFromRecording({
      operations: [
        { kind: 'drag', position: { x: 100, y: 200 }, delta: { x: 0, y: -240 }, durationMs: 1281.008, timestamp: 1 },
        { kind: 'longPress', position: { x: 100, y: 200 }, durationMs: 606.761, timestamp: 2 },
      ],
      frames: [
        { id: 'drag', index: 0, operationIndex: 0, kind: 'drag', status: 'ready', selector: 'key=list', timestamp: 1 },
        { id: 'hold', index: 1, operationIndex: 1, kind: 'longPress', status: 'ready', selector: 'key=button', timestamp: 2 },
      ],
    });
    const code = generateFlowTestSkeleton(flow);
    expect(code).toContain('.drag(0, -240, { duration: 1281.008 })');
    expect(code).toContain('.longPress({ duration: 606.761 })');
  });

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

describe('sensitive recorded flows', () => {
  it('preserves masking and parameterized replay through the editable flow', async () => {
    const { buildFlowFromRecording } = await import('../../src/flow/RecordingFlowBuilder.js');
    const flow = buildFlowFromRecording({
      frames: [{ id: 'password', index: 0, operationIndex: 3, kind: 'type', status: 'ready',
        text: '<masked>', sensitive: true, action: 'replace', selector: 'key=password', timestamp: 1,
        position: { x: 0, y: 0 } }],
    });
    expect(flow.nodes[0].operation).toMatchObject({ text: '<masked>', sensitive: true });
    const code = generateFlowTestSkeleton(flow, { useFlowSteps: false });
    expect(code).not.toContain("fill('<masked>')");
    expect(code).toContain('FLIWRIGHT_INPUT_4');
    let body!: (fixtures: unknown) => Promise<void>;
    const env: Record<string, string> = {};
    new Function('test', 'process', code.replace(/^import .*;\n/, ''))(
      (_: string, callback: typeof body) => { body = callback; }, { env },
    );
    const values: unknown[] = [];
    const page = { locator: () => ({ fill: async (...value: unknown[]) => { values.push(value); } }) };
    await expect(body({ page })).rejects.toThrow('FLIWRIGHT_INPUT_4');
    expect(values).toEqual([]);
    env.FLIWRIGHT_INPUT_4 = 'replay-parameter';
    await body({ page });
    expect(values).toEqual([['replay-parameter', { sensitive: true }]]);
  });
});
