import { describe, expect, it, vi } from 'vitest';
import { RecorderController } from '../src/RecorderController.js';

function harness() {
  let sessionId = 'current';
  let lastSequence = 0;
  let sink: (event: { kind: string; timestamp: number; data: Record<string, unknown> }) => void;
  const capabilities = {
    protocolVersion: 2, compatible: true,
    bridgeCapabilities: { recordingProtocolVersion: 2, recordingBeforeDispatchTarget: true, recordingFocusedInputController: true },
  };
  const send = vi.fn(async (method: string, params?: Record<string, unknown>): Promise<unknown> => {
    if (method === 'ext.fliwright.handshake') return capabilities;
    if (method === 'ext.fliwright.startRecording') {
      if (typeof params?.sessionId === 'string') sessionId = params.sessionId;
      return { success: true, recording: true, sessionId, protocolVersion: 2 };
    }
    if (method === 'ext.fliwright.stopRecording') return { success: true, recording: false, sessionId, lastSequence, protocolVersion: 2 };
    return {};
  });
  const unsubscribe = vi.fn();
  const controller = new RecorderController(send, (callback) => { sink = callback; return unsubscribe; });
  const emit = (sequence: number, payload: Record<string, unknown>, overrides: Record<string, unknown> = {}) => {
    sink({ kind: 'FliwrightRecording', timestamp: 999_999, data: {
      version: 2, sessionId, sequence, elapsedUs: sequence * 100, frameId: `frame-${sequence}`, payload, ...overrides,
    } });
  };
  return { controller, capabilities, send, unsubscribe, emit, setLast: (value: number) => { lastSequence = value; } };
}
const pointer = (phase: string) => ({
  kind: 'pointer', phase, pointer: 1, x: 10, y: 20,
  viewportWidth: 320, viewportHeight: 640, pixelRatio: 2,
});

describe('recording protocol v2', () => {
  it('checks recording capabilities before starting an owned session', async () => {
    const h = harness();
    await h.controller.start();
    expect(h.send).toHaveBeenNthCalledWith(1, 'ext.fliwright.handshake', { protocolVersion: '2' });
    expect(h.send).toHaveBeenCalledWith('ext.fliwright.startRecording', {
      protocolVersion: '2', sessionId: expect.any(String),
    });
    await h.controller.stop();
  });

  it.each(['recordingBeforeDispatchTarget', 'recordingFocusedInputController'] as const)('rejects a missing %s capability without starting', async (capability) => {
    const h = harness();
    h.capabilities.bridgeCapabilities[capability] = false;
    await expect(h.controller.start()).rejects.toThrow(/recording|binding|capabilit/i);
    expect(h.send.mock.calls.some(([method]) => method === 'ext.fliwright.startRecording')).toBe(false);
  });

  it('sorts late events by sequence, counts focus/route events, and deduplicates', async () => {
    const h = harness();
    await h.controller.start();
    h.emit(4, pointer('up'));
    h.emit(2, { kind: 'route', route: '/form' });
    h.emit(1, pointer('down'));
    h.emit(3, { kind: 'focus', focused: true, focusSessionId: 'focus-1' });
    h.emit(4, pointer('up'));
    h.setLast(4);
    const result = await h.controller.stop();
    expect(result.status).toBe('captured');
    expect(result.receivedSequences).toEqual([1, 2, 3, 4]);
    expect(result.missingSequences).toEqual([]);
    expect(result.operations).toHaveLength(1);
    expect(h.controller.getRawEvents().map((event) => event.sequence)).toEqual([1, 2, 3, 4]);
  });

  it('retains sensitive flags through raw events, operations, frames and generated code', async () => {
    const h = harness();
    await h.controller.start({ captureScreenshots: true, requestTimeoutMs: 20 });
    h.emit(1, { kind: 'text', value: '<masked>', focusSessionId: 'focus-1', sensitive: true }, {
      targetId: 'password-field', target: { targetId: 'password-field', status: 'resolved', candidates: [{
        query: { match: { key: 'password' } }, stability: 'key', matchCount: 1, matchesTarget: true,
      }] },
    });
    h.setLast(1);
    const result = await h.controller.stop();
    expect(h.controller.getRawEvents()[0]).toMatchObject({ text: '<masked>', sensitive: true });
    expect(result.operations[0]).toMatchObject({ text: '<masked>', sensitive: true });
    expect(result.frames[0]).toMatchObject({ text: '<masked>', sensitive: true });
    expect(result.code).toContain('FLIWRIGHT_INPUT_1');
    expect(result.code).not.toContain('<masked>');
  });

  it('detects initial and trailing gaps, including the declared lastSequence', async () => {
    const h = harness();
    await h.controller.start({ stopFlushTimeoutMs: 0 });
    h.emit(3, pointer('down'));
    h.emit(4, pointer('up'));
    h.setLast(6);
    const result = await h.controller.stop();
    expect(result.status).toBe('partial');
    expect(result.missingSequences).toEqual([1, 2, 5, 6]);
  });

  it('waits for intermediate gaps to flush even after receiving lastSequence', async () => {
    const h = harness();
    await h.controller.start({ stopFlushTimeoutMs: 200 });
    h.emit(1, pointer('down'));
    h.emit(3, pointer('up'));
    h.setLast(3);
    const stop = h.controller.stop();
    setTimeout(() => h.emit(2, { kind: 'route', route: '/form' }), 10);
    const result = await stop;
    expect(result.status).toBe('captured');
    expect(result.receivedSequences).toEqual([1, 2, 3]);
    expect(h.unsubscribe).toHaveBeenCalledOnce();
  });

  it('ignores other sessions instead of adopting their session id or sequence', async () => {
    const h = harness();
    await h.controller.start();
    h.emit(99, pointer('down'), { sessionId: 'foreign' });
    h.setLast(0);
    const result = await h.controller.stop();
    expect(result.receivedSequences).toEqual([]);
    expect(result.sessionId).not.toBe('foreign');
    expect(result.status).toBe('captured');
  });

  it('marks malformed or legacy event payloads incomplete instead of guessing them', async () => {
    const h = harness();
    await h.controller.start({ stopFlushTimeoutMs: 0 });
    h.emit(1, pointer('down'), { elapsedUs: 'wall-clock time' });
    h.emit(2, pointer('up'), { version: 1 });
    h.setLast(2);
    const result = await h.controller.stop();
    expect(result.status).toBe('partial');
    expect(result.operations).toHaveLength(0);
    expect(result.issues.join(' ')).toMatch(/protocol|envelope/i);
  });

  it('rejects a stop response for a different session and cleans up locally', async () => {
    const h = harness();
    const original = h.send.getMockImplementation()!;
    h.send.mockImplementation(async (method, params) => method === 'ext.fliwright.stopRecording'
      ? { success: true, recording: false, sessionId: 'foreign', lastSequence: 0, protocolVersion: 2 }
      : original(method, params));
    await h.controller.start();
    const result = await h.controller.stop();
    expect(result.status).toBe('failed');
    expect(result.issues.join(' ')).toMatch(/session/i);
    expect(h.unsubscribe).toHaveBeenCalledOnce();
  });
});
