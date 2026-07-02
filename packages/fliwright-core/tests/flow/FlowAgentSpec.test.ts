import { describe, expect, it } from 'vitest';
import { buildFlowAgentSpec } from '../../src/flow/FlowAgentSpec.js';
import type { FliwrightFlowDocument } from '../../src/flow/types.js';

describe('buildFlowAgentSpec', () => {
  it('summarizes flow nodes, Figma bindings, routes, selectors, and missing targets', () => {
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
        },
        {
          id: 'figma-1',
          type: 'figma',
          title: 'Payment pending design',
          figma: {
            fileKey: 'ABC123',
            nodeId: '120:340',
            url: 'https://www.figma.com/design/ABC123/File?node-id=120-340',
            componentName: 'PaymentPendingView',
          },
        },
        {
          id: 'figma-2',
          type: 'figma',
          title: 'Unbound design',
          figma: {
            fileKey: 'ABC123',
            nodeId: '',
          },
        },
        {
          id: 'figma-3',
          type: 'figma',
          title: 'Needs code target',
          figma: {
            fileKey: 'ABC123',
            nodeId: '200:300',
          },
        },
        {
          id: 'decision-1',
          type: 'decision',
          title: 'Payment status',
          decisionRules: [
            { id: 'rule-1', label: 'Pending', when: 'payment.pending', target: 'figma-3' },
          ],
        },
      ],
      edges: [
        { id: 'e1', source: 'screen-1', target: 'figma-1', label: 'next' },
        { id: 'e2', source: 'figma-1', target: 'decision-1', label: 'evaluate' },
        { id: 'e3', source: 'decision-1', target: 'figma-3', condition: 'payment.pending' },
      ],
    };

    const spec = buildFlowAgentSpec(flow);

    expect(spec.summary).toEqual({
      nodeCount: 5,
      edgeCount: 3,
      figmaBoundCount: 2,
      routeCount: 1,
      selectorCount: 1,
      codeTargetCount: 1,
    });
    expect(spec.figmaBindings).toEqual([
      expect.objectContaining({
        flowNodeId: 'figma-1',
        fileKey: 'ABC123',
        nodeId: '120:340',
        componentName: 'PaymentPendingView',
      }),
      expect.objectContaining({
        flowNodeId: 'figma-3',
        fileKey: 'ABC123',
        nodeId: '200:300',
      }),
    ]);
    expect(spec.figmaMcpRequests).toEqual([
      {
        flowNodeId: 'figma-1',
        title: 'Payment pending design',
        tool: 'get_design_context',
        fileKey: 'ABC123',
        nodeId: '120:340',
        url: 'https://www.figma.com/design/ABC123/File?node-id=120-340',
      },
      {
        flowNodeId: 'figma-3',
        title: 'Needs code target',
        tool: 'get_design_context',
        fileKey: 'ABC123',
        nodeId: '200:300',
      },
    ]);
    expect(spec.nodes[0]).toEqual(expect.objectContaining({
      id: 'screen-1',
      route: '/checkout',
      selector: 'text=Pay',
      testHints: expect.objectContaining({
        recordingFrameId: 'frame-1',
        operationIndex: 0,
      }),
      outgoing: [{ target: 'figma-1', label: 'next' }],
    }));
    expect(spec.nodes[1].incoming).toEqual([{ source: 'screen-1', label: 'next' }]);
    expect(spec.nodes[1].outgoing).toEqual([{ target: 'decision-1', label: 'evaluate' }]);
    expect(spec.nodes[4]).toEqual(expect.objectContaining({
      id: 'decision-1',
      decisionRules: [
        { id: 'rule-1', label: 'Pending', when: 'payment.pending', target: 'figma-3' },
      ],
      outgoing: [{ target: 'figma-3', condition: 'payment.pending' }],
    }));
    expect(spec.implementationPlan).toEqual(expect.objectContaining({
      figmaContext: spec.figmaMcpRequests,
      codeTargets: [
        {
          flowNodeId: 'figma-1',
          title: 'Payment pending design',
          componentName: 'PaymentPendingView',
        },
      ],
      testTargets: [
        {
          flowNodeId: 'screen-1',
          title: 'Checkout screen',
          route: '/checkout',
          selector: 'text=Pay',
        },
      ],
      decisionBranches: [
        {
          flowNodeId: 'decision-1',
          title: 'Payment status',
          rules: [
            { id: 'rule-1', label: 'Pending', when: 'payment.pending', target: 'figma-3' },
          ],
          outgoing: [{ target: 'figma-3', condition: 'payment.pending' }],
        },
      ],
    }));
    expect(spec.implementationPlan.steps).toContain('Read all figmaContext entries with Figma MCP before implementing bound UI nodes.');
    expect(spec.missing.figmaNodeIds).toEqual([
      { flowNodeId: 'figma-2', title: 'Unbound design', reason: 'missing nodeId' },
    ]);
    expect(spec.missing.codeTargets).toEqual([
      { flowNodeId: 'figma-3', title: 'Needs code target', reason: 'missing componentName or codeConnectId' },
    ]);
  });
});
