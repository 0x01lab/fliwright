import { describe, expect, it } from 'vitest';
import { AiRuntime } from '../../src/ai/AiRuntime.js';
import { MockAiAdapter } from '../../src/ai/adapters/MockAiAdapter.js';
import { cleanFlowWithAi } from '../../src/flow/FlowCleaner.js';
import type { FliwrightFlowDocument } from '../../src/flow/types.js';

describe('cleanFlowWithAi', () => {
  it('uses an AI keep-list to remove noisy nodes and reconnect useful nodes', async () => {
    const prompts: string[] = [];
    const ai = new AiRuntime({
      provider: 'mock',
      adapter: new MockAiAdapter((request) => {
        prompts.push(request.prompt);
        return {
          text: JSON.stringify({
            version: 1,
            keptNodeIds: ['screen-1', 'pay-action'],
            reasons: [
              { nodeId: 'tap-noise', decision: 'remove', reason: 'tap did not change business state' },
            ],
            summary: 'Removed one redundant tap.',
          }),
          json: {
            version: 1,
            keptNodeIds: ['screen-1', 'pay-action'],
            reasons: [
              { nodeId: 'tap-noise', decision: 'remove', reason: 'tap did not change business state' },
            ],
            summary: 'Removed one redundant tap.',
          },
        };
      }),
    });

    const result = await cleanFlowWithAi(sampleFlow(), { ai });

    expect(prompts[0]).toContain('tap-noise');
    expect(prompts[0]).toContain('Keep only nodes that represent meaningful business state');
    expect(result.plan.keptNodeIds).toEqual(['screen-1', 'pay-action']);
    expect(result.plan.removedNodeIds).toEqual(['tap-noise']);
    expect(result.flow.nodes.map((node) => node.id)).toEqual(['screen-1', 'pay-action']);
    expect(result.flow.edges).toEqual([
      expect.objectContaining({
        source: 'screen-1',
        target: 'pay-action',
        metadata: expect.objectContaining({
          cleaned: true,
          removedNodeIds: ['tap-noise'],
        }),
      }),
    ]);
    expect(result.flow.metadata).toEqual(expect.objectContaining({
      cleanedBy: 'ai',
      originalNodeCount: 3,
      removedNodeCount: 1,
      cleanSummary: 'Removed one redundant tap.',
    }));
  });

  it('preserves protected and Figma-bound nodes even when the AI omits them', async () => {
    const ai = new AiRuntime({
      provider: 'mock',
      adapter: new MockAiAdapter([{
        text: JSON.stringify({ version: 1, keptNodeIds: ['pay-action'] }),
        json: { version: 1, keptNodeIds: ['pay-action'] },
      }]),
    });

    const result = await cleanFlowWithAi(sampleFlow({
      nodes: [
        { id: 'figma-screen', type: 'figma', title: 'Design', figma: { fileKey: 'FILE', nodeId: '1:2' } },
        { id: 'tap-noise', type: 'action', title: 'Duplicate tap' },
        { id: 'pay-action', type: 'action', title: 'Tap Pay', selector: 'text=Pay' },
      ],
      edges: [
        { id: 'e1', source: 'figma-screen', target: 'tap-noise' },
        { id: 'e2', source: 'tap-noise', target: 'pay-action' },
      ],
    }), {
      ai,
      protectedNodeIds: ['figma-screen'],
    });

    expect(result.flow.nodes.map((node) => node.id)).toEqual(['figma-screen', 'pay-action']);
    expect(result.plan.keptNodeIds).toEqual(['figma-screen', 'pay-action']);
  });

  it('throws when the AI keeps no known nodes', async () => {
    const ai = new AiRuntime({
      provider: 'mock',
      adapter: new MockAiAdapter([{
        text: JSON.stringify({ version: 1, keptNodeIds: ['missing'] }),
        json: { version: 1, keptNodeIds: ['missing'] },
      }]),
    });

    await expect(cleanFlowWithAi(sampleFlow(), { ai })).rejects.toThrow('AI flow clean plan did not keep any known nodes');
  });
});

function sampleFlow(overrides: Partial<FliwrightFlowDocument> = {}): FliwrightFlowDocument {
  return {
    version: 1,
    id: 'checkout',
    title: 'Checkout',
    createdAt: '2026-06-30T00:00:00.000Z',
    updatedAt: '2026-06-30T01:00:00.000Z',
    source: { kind: 'recording', testName: 'checkout test' },
    nodes: [
      { id: 'screen-1', type: 'screen', title: 'Checkout screen', route: '/checkout' },
      { id: 'tap-noise', type: 'action', title: 'Duplicate tap', selector: 'text=Pay' },
      { id: 'pay-action', type: 'action', title: 'Tap Pay', selector: 'text=Pay' },
    ],
    edges: [
      { id: 'e1', source: 'screen-1', target: 'tap-noise' },
      { id: 'e2', source: 'tap-noise', target: 'pay-action' },
    ],
    ...overrides,
  };
}
