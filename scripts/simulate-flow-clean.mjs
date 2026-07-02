#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  AiRuntime,
  MockAiAdapter,
  cleanFlowWithAi,
} from '../packages/fliwright-core/dist/index.js';

const flow = {
  version: 1,
  id: 'simulated-checkout-recording',
  title: 'Simulated noisy checkout recording',
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
  source: {
    kind: 'recording',
    recordingId: 'recording-simulated-checkout',
    testName: 'checkout with recording noise',
  },
  nodes: [
    {
      id: 'screen-cart',
      type: 'screen',
      title: 'Cart screen',
      route: '/cart',
      screenshot: { source: 'recording-frame', recordingFrameId: 'frame-1', width: 390, height: 844 },
    },
    {
      id: 'tap-empty-space',
      type: 'action',
      title: 'Accidental tap on empty space',
      selector: 'type=Container',
      operation: { kind: 'tap', position: { x: 20, y: 700 }, timestamp: 1000, status: 'ignored', ignoreReason: 'noEffect', confidence: 0.12 },
    },
    {
      id: 'tap-checkout',
      type: 'action',
      title: 'Tap Checkout',
      selector: 'text=Checkout',
      operation: { kind: 'tap', position: { x: 320, y: 760 }, timestamp: 1400, status: 'included', confidence: 0.92 },
    },
    {
      id: 'duplicate-tap-checkout',
      type: 'action',
      title: 'Duplicate tap Checkout',
      selector: 'text=Checkout',
      operation: { kind: 'tap', position: { x: 322, y: 762 }, timestamp: 1480, status: 'ignored', ignoreReason: 'duplicate', confidence: 0.2 },
    },
    {
      id: 'screen-payment',
      type: 'figma',
      title: 'Payment screen design',
      route: '/payment',
      figma: {
        fileKey: 'FIGMA_FILE',
        nodeId: '120:340',
        componentName: 'PaymentScreen',
      },
    },
    {
      id: 'scroll-noise',
      type: 'action',
      title: 'Tiny scroll without visible state change',
      selector: 'type=ListView',
      operation: { kind: 'drag', position: { x: 180, y: 420 }, delta: { x: 0, y: -8 }, timestamp: 2100, status: 'ignored', ignoreReason: 'noEffect', confidence: 0.18 },
    },
    {
      id: 'type-card',
      type: 'action',
      title: 'Enter card number',
      selector: 'key=card-number-field',
      operation: { kind: 'type', position: { x: 120, y: 300 }, text: '4242424242424242', action: 'replace', timestamp: 2600, status: 'included', confidence: 0.96 },
    },
    {
      id: 'decision-payment-status',
      type: 'decision',
      title: 'Payment status branch',
      decisionRules: [
        { id: 'rule-success', label: 'Success', when: 'payment.status == success', target: 'screen-success' },
        { id: 'rule-failed', label: 'Failed', when: 'payment.status == failed', target: 'screen-failed' },
      ],
    },
    {
      id: 'screen-success',
      type: 'screen',
      title: 'Payment success',
      route: '/payment/success',
      selector: 'text=Payment successful',
    },
  ],
  edges: [
    { id: 'e1', source: 'screen-cart', target: 'tap-empty-space' },
    { id: 'e2', source: 'tap-empty-space', target: 'tap-checkout' },
    { id: 'e3', source: 'tap-checkout', target: 'duplicate-tap-checkout' },
    { id: 'e4', source: 'duplicate-tap-checkout', target: 'screen-payment' },
    { id: 'e5', source: 'screen-payment', target: 'scroll-noise' },
    { id: 'e6', source: 'scroll-noise', target: 'type-card' },
    { id: 'e7', source: 'type-card', target: 'decision-payment-status' },
    { id: 'e8', source: 'decision-payment-status', target: 'screen-success', condition: 'payment.status == success' },
  ],
};

const aiRuntime = new AiRuntime({
  provider: 'mock',
  adapter: new MockAiAdapter((request) => {
    const prompt = request.prompt;
    assert.match(prompt, /tap-empty-space/);
    assert.match(prompt, /duplicate-tap-checkout/);
    assert.match(prompt, /scroll-noise/);
    assert.match(prompt, /Keep only nodes/);

    return {
      text: JSON.stringify({
        version: 1,
        keptNodeIds: [
          'screen-cart',
          'tap-checkout',
          'screen-payment',
          'type-card',
          'decision-payment-status',
          'screen-success',
        ],
        reasons: [
          { nodeId: 'tap-empty-space', decision: 'remove', reason: 'Accidental tap with no business state change.' },
          { nodeId: 'duplicate-tap-checkout', decision: 'remove', reason: 'Duplicate checkout tap.' },
          { nodeId: 'scroll-noise', decision: 'remove', reason: 'Tiny scroll without visible state change.' },
        ],
        summary: 'Removed accidental tap, duplicate tap, and tiny scroll noise.',
      }),
      json: {
        version: 1,
        keptNodeIds: [
          'screen-cart',
          'tap-checkout',
          'screen-payment',
          'type-card',
          'decision-payment-status',
          'screen-success',
        ],
        reasons: [
          { nodeId: 'tap-empty-space', decision: 'remove', reason: 'Accidental tap with no business state change.' },
          { nodeId: 'duplicate-tap-checkout', decision: 'remove', reason: 'Duplicate checkout tap.' },
          { nodeId: 'scroll-noise', decision: 'remove', reason: 'Tiny scroll without visible state change.' },
        ],
        summary: 'Removed accidental tap, duplicate tap, and tiny scroll noise.',
      },
    };
  }),
});

const result = await cleanFlowWithAi(flow, {
  ai: aiRuntime,
  instructions: 'Prefer retaining route changes, form input, Figma-bound screens, and explicit decision branches.',
});

const beforeIds = flow.nodes.map((node) => node.id);
const afterIds = result.flow.nodes.map((node) => node.id);
const removedIds = result.plan.removedNodeIds;

assert.deepEqual(removedIds, ['tap-empty-space', 'duplicate-tap-checkout', 'scroll-noise']);
assert.deepEqual(afterIds, [
  'screen-cart',
  'tap-checkout',
  'screen-payment',
  'type-card',
  'decision-payment-status',
  'screen-success',
]);
assert.equal(result.flow.nodes.some((node) => node.id === 'screen-payment' && node.figma?.nodeId === '120:340'), true);
assert.equal(result.flow.nodes.some((node) => node.id === 'decision-payment-status' && node.decisionRules?.length === 2), true);
assert.equal(result.flow.edges.some((edge) => (
  edge.source === 'screen-cart'
  && edge.target === 'tap-checkout'
  && edge.metadata?.cleaned === true
  && edge.metadata?.removedNodeIds?.includes('tap-empty-space')
)), true);
assert.equal(result.flow.edges.some((edge) => (
  edge.source === 'screen-payment'
  && edge.target === 'type-card'
  && edge.metadata?.cleaned === true
  && edge.metadata?.removedNodeIds?.includes('scroll-noise')
)), true);

console.log('Simulated flow clean succeeded.');
console.log(`Before (${beforeIds.length}): ${beforeIds.join(' -> ')}`);
console.log(`After  (${afterIds.length}): ${afterIds.join(' -> ')}`);
console.log(`Removed (${removedIds.length}): ${removedIds.join(', ')}`);
console.log(`Summary: ${result.plan.summary}`);
