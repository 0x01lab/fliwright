import { describe, expect, it } from 'vitest';
import { buildFlowFromRecording } from '../../src/flow/RecordingFlowBuilder.js';
import type { RecordedOperation, RecordingFrame } from '../../src/types.js';

describe('buildFlowFromRecording', () => {
  it('creates an editable linear flow from recorded frames', () => {
    const operations: RecordedOperation[] = [
      {
        kind: 'tap',
        position: { x: 100, y: 200 },
        timestamp: 1000,
        status: 'included',
        confidence: 0.92,
      },
      {
        kind: 'type',
        position: { x: 120, y: 240 },
        text: 'alice@example.com',
        timestamp: 1200,
        status: 'included',
      },
    ];
    const frames: RecordingFrame[] = [
      {
        id: 'frame-1',
        index: 0,
        kind: 'tap',
        status: 'ready',
        timestamp: 1000,
        operationIndex: 0,
        position: { x: 100, y: 200 },
        selector: 'text=Login',
        operationStatus: 'included',
        screenshot: {
          base64: 'ignored-in-flow',
          format: 'png',
          width: 390,
          height: 844,
          pixelRatio: 1,
        },
      },
      {
        id: 'frame-2',
        index: 1,
        kind: 'type',
        status: 'ready',
        timestamp: 1200,
        operationIndex: 1,
        position: { x: 120, y: 240 },
        text: 'alice@example.com',
        selector: 'input=email',
        operationStatus: 'included',
      },
    ];

    const flow = buildFlowFromRecording({
      frames,
      operations,
      recordingId: 'recording-1',
      testName: 'login flow',
      targetFile: 'tests/login.test.ts',
    }, {
      createdAt: '2026-06-30T00:00:00.000Z',
    });

    expect(flow).toMatchObject({
      version: 1,
      id: 'flow-recording-1',
      title: 'login flow',
      createdAt: '2026-06-30T00:00:00.000Z',
      updatedAt: '2026-06-30T00:00:00.000Z',
      source: {
        kind: 'recording',
        recordingId: 'recording-1',
        testName: 'login flow',
        targetFile: 'tests/login.test.ts',
      },
      metadata: {
        operationCount: 2,
        frameCount: 2,
        includedFrameCount: 2,
      },
    });
    expect(flow.nodes).toHaveLength(2);
    expect(flow.nodes[0]).toMatchObject({
      id: 'recording-frame-1',
      type: 'action',
      title: 'tap: text=Login',
      selector: 'text=Login',
      recordingFrameId: 'frame-1',
      operationIndex: 0,
      position: { x: 0, y: 112 },
      operation: {
        kind: 'tap',
        position: { x: 100, y: 200 },
        timestamp: 1000,
        status: 'included',
        confidence: 0.92,
      },
      screenshot: {
        source: 'recording-frame',
        recordingFrameId: 'frame-1',
        format: 'png',
        width: 390,
        height: 844,
        pixelRatio: 1,
      },
    });
    expect(flow.nodes[0].screenshot).not.toHaveProperty('base64');
    expect(flow.edges).toEqual([
      {
        id: 'edge-recording-frame-1-recording-frame-2',
        source: 'recording-frame-1',
        target: 'recording-frame-2',
        label: '1 -> 2',
      },
    ]);
  });

  it('omits pending and ignored frames by default but can include ignored frames', () => {
    const frames: RecordingFrame[] = [
      {
        id: 'frame-pending',
        index: 0,
        kind: 'pending',
        status: 'capturing',
        timestamp: 900,
        position: { x: 0, y: 0 },
      },
      {
        id: 'frame-ignored',
        index: 1,
        kind: 'tap',
        status: 'ready',
        timestamp: 1000,
        operationIndex: 0,
        operationStatus: 'ignored',
        ignoreReason: 'duplicate',
        position: { x: 1, y: 1 },
      },
      {
        id: 'frame-included',
        index: 2,
        kind: 'tap',
        status: 'ready',
        timestamp: 1100,
        operationIndex: 1,
        operationStatus: 'included',
        position: { x: 2, y: 2 },
      },
    ];

    const flow = buildFlowFromRecording({ frames }, { createdAt: '2026-06-30T00:00:00.000Z' });
    expect(flow.nodes.map((node) => node.recordingFrameId)).toEqual(['frame-included']);

    const withIgnored = buildFlowFromRecording({ frames }, {
      createdAt: '2026-06-30T00:00:00.000Z',
      includeIgnored: true,
    });
    expect(withIgnored.nodes.map((node) => node.recordingFrameId)).toEqual(['frame-ignored', 'frame-included']);
  });
});
