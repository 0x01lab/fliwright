import { describe, it, expect, vi } from 'vitest';
import { RecorderController } from '../src/RecorderController.js';
import { createRecordingProtocolFixture, frozenTarget } from './helpers/recordingProtocol.js';

describe('RecorderController', () => {
  it('subscribes to the Extension stream and starts Dart recording', async () => {
    const protocol = createRecordingProtocolFixture();
    const sendRequest = vi.fn(async (method: string, params?: Record<string, unknown>) => protocol.response(method, params) ?? {});
    const onEvent = vi.fn().mockReturnValue(() => {});
    const controller = new RecorderController(sendRequest, onEvent);

    await controller.start();

    expect(sendRequest).toHaveBeenNthCalledWith(2, 'streamListen', { streamId: 'Extension' });
    expect(sendRequest).toHaveBeenNthCalledWith(3, 'ext.fliwright.startRecording', { protocolVersion: '2', sessionId: expect.any(String) });
    expect(onEvent).toHaveBeenCalledOnce();
  });

  it('stops Dart recording and generates code from received events', async () => {
    const protocol = createRecordingProtocolFixture();
    const sendRequest = vi.fn().mockImplementation((method: string, params?: Record<string, unknown>) => {
      const response = protocol.response(method, params);
      if (response !== undefined) return Promise.resolve(response);
      if (method === 'streamListen') return Promise.resolve({});
      return Promise.resolve({});
    });
    let eventCallback: ((event: { kind: string; timestamp: number; data: Record<string, unknown> }) => void) | null = null;
    const unsubscribe = vi.fn();
    const onEvent = vi.fn().mockImplementation((callback) => {
      eventCallback = callback;
      return unsubscribe;
    });
    const controller = new RecorderController(sendRequest, onEvent);

    await controller.start();
    eventCallback?.({
      kind: 'FliwrightRecording',
      timestamp: Date.now(),
      data: protocol.pointer('down', 100, 200, 1000, 0, { target: frozenTarget({ match: { key: 'Login' } }) }),
    });
    eventCallback?.({
      kind: 'FliwrightRecording',
      timestamp: Date.now(),
      data: protocol.pointer('up', 100, 200, 1100, 0),
    });

    const { code } = await controller.stop();

    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.stopRecording', { sessionId: expect.any(String) });
    expect(sendRequest.mock.calls.some(([method]) => method === 'ext.fliwright.hitTest' || method === 'ext.fliwright.resolve')).toBe(false);
    expect(code).toContain("import { test, expect } from '@fliwright/vitest'");
    expect(code).toContain("page.locator({ key: 'Login' }).click({ waitForAnimations: true })");
    expect(controller.getOperations()).toEqual([
      expect.objectContaining({ kind: 'tap', position: { x: 100, y: 200 }, timestamp: 1000 }),
    ]);
  });

  it('ignores an already-subscribed Extension stream', async () => {
    const protocol = createRecordingProtocolFixture();
    const sendRequest = vi.fn().mockImplementation((method: string, params?: Record<string, unknown>) => {
      const response = protocol.response(method, params);
      if (response !== undefined) return Promise.resolve(response);
      if (method === 'streamListen') return Promise.reject(new Error('Stream already subscribed'));
      return Promise.resolve({});
    });
    const controller = new RecorderController(sendRequest, vi.fn().mockReturnValue(() => {}));

    await expect(controller.start()).resolves.toBeUndefined();
    expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.startRecording', { protocolVersion: '2', sessionId: expect.any(String) });
  });

  it('keeps an unresolved target as a coordinate draft without querying the final page', async () => {
    const protocol = createRecordingProtocolFixture();
    const sendRequest = vi.fn().mockImplementation((method: string, params?: Record<string, unknown>) => {
      const response = protocol.response(method, params);
      if (response !== undefined) return Promise.resolve(response);
      return Promise.resolve({});
    });
    let eventCallback: ((event: { kind: string; timestamp: number; data: Record<string, unknown> }) => void) | null = null;
    const controller = new RecorderController(
      sendRequest,
      vi.fn().mockImplementation((callback) => {
        eventCallback = callback;
        return () => {};
      }),
    );

    await controller.start();
    eventCallback?.({
      kind: 'FliwrightRecording',
      timestamp: Date.now(),
      data: protocol.pointer('down', 10, 20, 1000, 0),
    });
    eventCallback?.({
      kind: 'FliwrightRecording',
      timestamp: Date.now(),
      data: protocol.pointer('up', 10, 20, 1100, 0),
    });

    const { code } = await controller.stop();

    expect(code).toContain('page.clickAt(10, 20)');
  });

  it('retains unresolved operations for review even when noise filtering is enabled', async () => {
    const protocol = createRecordingProtocolFixture();
    const sendRequest = vi.fn().mockImplementation((method: string, params?: Record<string, unknown>) => {
      const response = protocol.response(method, params);
      if (response !== undefined) return Promise.resolve(response);
      return Promise.resolve({});
    });
    let eventCallback: ((event: { kind: string; timestamp: number; data: Record<string, unknown> }) => void) | null = null;
    const controller = new RecorderController(
      sendRequest,
      vi.fn().mockImplementation((callback) => {
        eventCallback = callback;
        return () => {};
      }),
    );

    await controller.start({ filterNoise: true });
    eventCallback?.({
      kind: 'FliwrightRecording',
      timestamp: Date.now(),
      data: protocol.pointer('down', 10, 20, 1000, 0),
    });
    eventCallback?.({
      kind: 'FliwrightRecording',
      timestamp: Date.now(),
      data: protocol.pointer('up', 10, 20, 1100, 0),
    });

    const { code } = await controller.stop();

    expect(code).toContain('page.clickAt(10, 20)');
    expect(controller.getSelectors().size).toBe(0);
    expect(controller.getOperations()[0].status).not.toBe('ignored');
  });

  it('can manually exclude and reinclude a draft operation after stop', async () => {
    const protocol = createRecordingProtocolFixture();
    const sendRequest = vi.fn().mockImplementation((method: string, params?: Record<string, unknown>) => {
      const response = protocol.response(method, params);
      if (response !== undefined) return Promise.resolve(response);
      return Promise.resolve({});
    });
    let eventCallback: ((event: { kind: string; timestamp: number; data: Record<string, unknown> }) => void) | null = null;
    const controller = new RecorderController(
      sendRequest,
      vi.fn().mockImplementation((callback) => {
        eventCallback = callback;
        return () => {};
      }),
    );

    await controller.start({ filterNoise: true });
    eventCallback?.({
      kind: 'FliwrightRecording',
      timestamp: Date.now(),
      data: protocol.pointer('down', 10, 20, 1000, 0),
    });
    eventCallback?.({
      kind: 'FliwrightRecording',
      timestamp: Date.now(),
      data: protocol.pointer('up', 10, 20, 1100, 0),
    });
    await controller.stop();

    expect(controller.setOperationIncluded(0, false)).not.toContain('page.clickAt');
    const code = controller.setOperationIncluded(0, true);

    expect(code).toContain('page.clickAt(10, 20)');
    expect(controller.getOperations()[0]).toEqual(expect.objectContaining({
      status: 'included',
      ignoreReason: undefined,
    }));
    const edited = await controller.stop();
    expect(edited.code).toBe(code);
    expect(edited.operations[0].status).toBe('included');
  });

  it('marks rapid nearby duplicate taps ignored when noise filtering is enabled', async () => {
    const protocol = createRecordingProtocolFixture();
    const sendRequest = vi.fn().mockImplementation((method: string, params?: Record<string, unknown>) => {
      const response = protocol.response(method, params);
      if (response !== undefined) return Promise.resolve(response);
      return Promise.resolve({});
    });
    let eventCallback: ((event: { kind: string; timestamp: number; data: Record<string, unknown> }) => void) | null = null;
    const controller = new RecorderController(
      sendRequest,
      vi.fn().mockImplementation((callback) => {
        eventCallback = callback;
        return () => {};
      }),
    );

    await controller.start({ filterNoise: true });
    for (const [timestamp, x, y, pointer] of [
      [1000, 100, 200, 1],
      [1100, 100, 200, 1],
      [1200, 105, 205, 2],
      [1300, 105, 205, 2],
    ]) {
      eventCallback?.({
        kind: 'FliwrightRecording',
        timestamp: Date.now(),
        data: protocol.pointer(timestamp === 1000 || timestamp === 1200 ? 'down' : 'up', x, y, timestamp, pointer, { target: frozenTarget({ match: { key: 'Open' } }) }),
      });
    }

    const { code } = await controller.stop();

    expect(code.match(/\.click\(\{ waitForAnimations: true \}\)/g)).toHaveLength(1);
    expect(controller.getOperations()[1]).toEqual(expect.objectContaining({
      status: 'ignored',
      ignoreReason: 'duplicate',
    }));
  });

  it('keeps listening until stopRecording resolves', async () => {
    const protocol = createRecordingProtocolFixture();
    let eventCallback: ((event: { kind: string; timestamp: number; data: Record<string, unknown> }) => void) | null = null;
    const unsubscribe = vi.fn();
    const sendRequest = vi.fn().mockImplementation((method: string, params?: Record<string, unknown>) => {
      if (method === 'ext.fliwright.stopRecording') {
        eventCallback?.({
          kind: 'FliwrightRecording',
          timestamp: Date.now(),
          data: protocol.pointer('down', 10, 20, 1000, 0),
        });
        eventCallback?.({
          kind: 'FliwrightRecording',
          timestamp: Date.now(),
          data: protocol.pointer('up', 10, 20, 1100, 0),
        });
      }
      return Promise.resolve(protocol.response(method, params) ?? {});
    });
    const controller = new RecorderController(
      sendRequest,
      vi.fn().mockImplementation((callback) => {
        eventCallback = callback;
        return unsubscribe;
      }),
    );

    await controller.start();
    await controller.stop();

    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(controller.getOperations()).toEqual([
      { kind: 'tap', position: { x: 10, y: 20 }, timestamp: 1000 },
    ]);
  });

  it('uses the latest sampled screenshot for pointer down frames when enabled', async () => {
    const protocol = createRecordingProtocolFixture();
    const frames: unknown[] = [];
    const sendRequest = vi.fn().mockImplementation((method: string, params?: Record<string, unknown>) => {
      const response = protocol.response(method, params);
      if (response !== undefined) return Promise.resolve(response);
      if (method === 'ext.fliwright.screenshot') {
        return Promise.resolve({
          success: true,
          format: 'png',
          screenshot: 'base64-png',
          width: 320,
          height: 640,
          pixelRatio: 1,
        });
      }
      return Promise.resolve({});
    });
    let eventCallback: ((event: { kind: string; timestamp: number; data: Record<string, unknown> }) => void) | null = null;
    const controller = new RecorderController(
      sendRequest,
      vi.fn().mockImplementation((callback) => {
        eventCallback = callback;
        return () => {};
      }),
    );

    await controller.start({
      captureScreenshots: true,
      onFrame: (frame) => frames.push(frame),
    });
    eventCallback?.({
      kind: 'FliwrightRecording',
      timestamp: Date.now(),
      data: protocol.pointer('down', 100, 200, 1000, 7, { target: frozenTarget({ match: { key: 'Login' } }) }),
    });
    eventCallback?.({
      kind: 'FliwrightRecording',
      timestamp: Date.now(),
      data: protocol.pointer('up', 100, 200, 1100, 7),
    });
    await controller.stop();

    expect(sendRequest).not.toHaveBeenCalledWith('ext.fliwright.settle', expect.anything());
    expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.screenshot', { pixelRatio: '1.0', waitForFrame: 'false' });
    expect(controller.getFrames()).toEqual([
      expect.objectContaining({
        index: 0,
        kind: 'tap',
        status: 'ready',
        pointer: 7,
        operationIndex: 0,
        position: { x: 100, y: 200 },
        selector: "{ key: 'Login' }",
        screenshot: {
          path: expect.stringMatching(/^screenshots\/.*\.png$/),
          byteLength: expect.any(Number),
          format: 'png',
          width: 320,
          height: 640,
          pixelRatio: 1,
        },
      }),
    ]);
    expect(frames.length).toBeGreaterThanOrEqual(3);
  });

  it('records screenshot errors without stopping recording when baseline capture fails', async () => {
    const protocol = createRecordingProtocolFixture();
    const sendRequest = vi.fn().mockImplementation((method: string, params?: Record<string, unknown>) => {
      const response = protocol.response(method, params);
      if (response !== undefined) return Promise.resolve(response);
      if (method === 'ext.fliwright.screenshot') {
        return Promise.resolve({ success: false, error: 'No repaint boundary' });
      }
      return Promise.resolve({});
    });
    let eventCallback: ((event: { kind: string; timestamp: number; data: Record<string, unknown> }) => void) | null = null;
    const controller = new RecorderController(
      sendRequest,
      vi.fn().mockImplementation((callback) => {
        eventCallback = callback;
        return () => {};
      }),
    );

    await controller.start({ captureScreenshots: true });
    eventCallback?.({
      kind: 'FliwrightRecording',
      timestamp: Date.now(),
      data: protocol.pointer('down', 10, 20, 1000, 0),
    });
    eventCallback?.({
      kind: 'FliwrightRecording',
      timestamp: Date.now(),
      data: protocol.pointer('up', 10, 20, 1100, 0),
    });

    await expect(controller.stop()).resolves.toMatchObject({ code: expect.stringContaining('page.clickAt') });
    expect(controller.getFrames()[0]).toEqual(expect.objectContaining({
      status: 'error',
      screenshotError: 'No repaint boundary',
      kind: 'tap',
    }));
  });

  it('accepts nested VM Service extension event payloads', async () => {
    const protocol = createRecordingProtocolFixture();
    const sendRequest = vi.fn(async (method: string, params?: Record<string, unknown>) => protocol.response(method, params) ?? {});
    let eventCallback: ((event: { kind: string; timestamp: number; data: Record<string, unknown>; streamId?: string }) => void) | null = null;
    const controller = new RecorderController(
      sendRequest,
      vi.fn().mockImplementation((callback) => {
        eventCallback = callback;
        return () => {};
      }),
    );

    await controller.start();
    eventCallback?.({
      kind: 'unknown',
      streamId: 'Extension',
      timestamp: Date.now(),
      data: {
        extensionKind: 'FliwrightRecording',
        extensionData: protocol.pointer('down', 10, 20, 1000, 0),
      },
    });
    eventCallback?.({
      kind: 'unknown',
      streamId: 'Extension',
      timestamp: Date.now(),
      data: {
        extensionKind: 'FliwrightRecording',
        extensionData: protocol.pointer('up', 10, 20, 1100, 0),
      },
    });

    expect(controller.getRawEvents()).toHaveLength(2);
    expect(controller.getOperations()).toEqual([
      { kind: 'tap', position: { x: 10, y: 20 }, timestamp: 1000 },
    ]);
  });

  it('updates a tap frame to type when text input is associated', async () => {
    const protocol = createRecordingProtocolFixture();
    const sendRequest = vi.fn(async (method: string, params?: Record<string, unknown>) => protocol.response(method, params) ?? { success: true, screenshot: 'base64-png' });
    let eventCallback: ((event: { kind: string; timestamp: number; data: Record<string, unknown> }) => void) | null = null;
    const controller = new RecorderController(
      sendRequest,
      vi.fn().mockImplementation((callback) => {
        eventCallback = callback;
        return () => {};
      }),
    );

    const target = frozenTarget({ match: { key: 'input' } }, { type: 'TextField' });
    await controller.start({ captureScreenshots: true });
    eventCallback?.({
      kind: 'FliwrightRecording',
      timestamp: Date.now(),
      data: protocol.pointer('down', 100, 200, 1000, 0, { target }),
    });
    eventCallback?.({
      kind: 'FliwrightRecording',
      timestamp: Date.now(),
      data: protocol.pointer('up', 100, 200, 1100, 0),
    });
    eventCallback?.({
      kind: 'FliwrightRecording',
      timestamp: Date.now(),
      data: protocol.text('hello', 1200, { target }),
    });
    await controller.stop();

    expect(controller.getFrames()[0]).toEqual(expect.objectContaining({
      kind: 'type',
      text: 'hello',
      position: { x: 100, y: 200 },
    }));
  });

  it('does not recapture screenshots on pointer down when a sampled screenshot exists', async () => {
    const protocol = createRecordingProtocolFixture();
    let activeScreenshots = 0;
    let maxActiveScreenshots = 0;
    const sendRequest = vi.fn().mockImplementation(async (method: string, params?: Record<string, unknown>) => {
      const response = protocol.response(method, params);
      if (response !== undefined) return Promise.resolve(response);
      if (method === 'ext.fliwright.screenshot') {
        activeScreenshots++;
        maxActiveScreenshots = Math.max(maxActiveScreenshots, activeScreenshots);
        await new Promise(resolve => setTimeout(resolve, 5));
        activeScreenshots--;
        return { success: true, screenshot: 'base64-png' };
      }
      return {};
    });
    let eventCallback: ((event: { kind: string; timestamp: number; data: Record<string, unknown> }) => void) | null = null;
    const controller = new RecorderController(
      sendRequest,
      vi.fn().mockImplementation((callback) => {
        eventCallback = callback;
        return () => {};
      }),
    );

    await controller.start({ captureScreenshots: true, screenshotSampleIntervalMs: 60_000 });
    eventCallback?.({
      kind: 'FliwrightRecording',
      timestamp: Date.now(),
      data: protocol.pointer('down', 10, 20, 1000, 1),
    });
    eventCallback?.({
      kind: 'FliwrightRecording',
      timestamp: Date.now(),
      data: protocol.pointer('down', 30, 40, 2000, 2),
    });

    await controller.stop();

    expect(maxActiveScreenshots).toBe(1);
    expect(sendRequest.mock.calls.filter(([method]) => method === 'ext.fliwright.screenshot')).toHaveLength(1);
    expect(sendRequest).not.toHaveBeenCalledWith('ext.fliwright.settle', expect.anything());
    expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.screenshot', { pixelRatio: '1.0', waitForFrame: 'false' });
  });

  it('synthesizes a visible frame for a standalone textInput with no preceding tap', async () => {
    const protocol = createRecordingProtocolFixture();
    const sendRequest = vi.fn().mockImplementation((method: string, params?: Record<string, unknown>) => {
      const response = protocol.response(method, params);
      if (response !== undefined) return Promise.resolve(response);
      if (method === 'ext.fliwright.screenshot') {
        return Promise.resolve({ success: true, screenshot: 'b64', width: 320, height: 640, pixelRatio: 1 });
      }
      return Promise.resolve({});
    });
    let eventCallback: ((event: { kind: string; timestamp: number; data: Record<string, unknown> }) => void) | null = null;
    const controller = new RecorderController(
      sendRequest,
      vi.fn().mockImplementation((callback) => {
        eventCallback = callback;
        return () => {};
      }),
    );

    await controller.start({ captureScreenshots: true });
    eventCallback?.({
      kind: 'FliwrightRecording',
      timestamp: Date.now(),
      data: protocol.text('hello', 5000),
    });
    await controller.stop();

    const frames = controller.getFrames();
    expect(frames).toHaveLength(1);
    expect(frames[0]).toEqual(expect.objectContaining({
      kind: 'type',
      text: 'hello',
      synthetic: true,
    }));
  });

  it('does not duplicate synthetic frames across aggregation re-runs', async () => {
    const protocol = createRecordingProtocolFixture();
    const sendRequest = vi.fn().mockImplementation((method: string, params?: Record<string, unknown>) => {
      const response = protocol.response(method, params);
      if (response !== undefined) return Promise.resolve(response);
      if (method === 'ext.fliwright.screenshot') {
        return Promise.resolve({ success: true, screenshot: 'b64', width: 320, height: 640, pixelRatio: 1 });
      }
      return Promise.resolve({});
    });
    let eventCallback: ((event: { kind: string; timestamp: number; data: Record<string, unknown> }) => void) | null = null;
    const controller = new RecorderController(
      sendRequest,
      vi.fn().mockImplementation((callback) => {
        eventCallback = callback;
        return () => {};
      }),
    );

    await controller.start({ captureScreenshots: true });
    eventCallback?.({
      kind: 'FliwrightRecording',
      timestamp: Date.now(),
      data: protocol.text('one', 1000),
    });
    eventCallback?.({
      kind: 'FliwrightRecording',
      timestamp: Date.now(),
      data: protocol.text('two', 2_000_000),
    });
    await controller.stop();

    const frames = controller.getFrames();
    expect(frames).toHaveLength(2);
    expect(frames[0]).toEqual(expect.objectContaining({ text: 'one', synthetic: true, index: 0 }));
    expect(frames[1]).toEqual(expect.objectContaining({ text: 'two', synthetic: true, index: 1 }));
  });

  it('records a drag operation as a frame carrying its delta', async () => {
    const protocol = createRecordingProtocolFixture();
    const sendRequest = vi.fn().mockImplementation((method: string, params?: Record<string, unknown>) => {
      const response = protocol.response(method, params);
      if (response !== undefined) return Promise.resolve(response);
      if (method === 'ext.fliwright.screenshot') {
        return Promise.resolve({ success: true, screenshot: 'b64', width: 320, height: 640, pixelRatio: 1 });
      }
      return Promise.resolve({});
    });
    let eventCallback: ((event: { kind: string; timestamp: number; data: Record<string, unknown> }) => void) | null = null;
    const controller = new RecorderController(
      sendRequest,
      vi.fn().mockImplementation((callback) => {
        eventCallback = callback;
        return () => {};
      }),
    );

    await controller.start({ captureScreenshots: true });
    for (const [ts, kind, x, y] of [
      [1000, 'down', 160, 100],
      [1050, 'move', 160, 200],
      [1100, 'move', 160, 300],
      [1200, 'up', 160, 300],
    ] as const) {
      eventCallback?.({
        kind: 'FliwrightRecording',
        timestamp: Date.now(),
        data: protocol.pointer(kind, x, y, ts),
      });
    }
    await controller.stop();

    const frames = controller.getFrames();
    expect(frames).toHaveLength(1);
    expect(frames[0]).toEqual(expect.objectContaining({
      kind: 'drag',
      delta: { x: 0, y: 200 },
    }));
  });

  it('disambiguates an ambiguous GestureDetector with descendant text', async () => {
    const protocol = createRecordingProtocolFixture();
    const sendRequest = vi.fn().mockImplementation((method: string, params?: Record<string, unknown>) => {
      const response = protocol.response(method, params);
      if (response !== undefined) return Promise.resolve(response);
      if (method === 'streamListen') return Promise.resolve({});
      return Promise.resolve({});
    });
    let eventCallback: ((event: { kind: string; timestamp: number; data: Record<string, unknown> }) => void) | null = null;
    const controller = new RecorderController(
      sendRequest,
      vi.fn().mockImplementation((cb) => { eventCallback = cb; return () => {}; }),
    );

    await controller.start();
    eventCallback?.({ kind: 'FliwrightRecording', timestamp: Date.now(), data: protocol.pointer('down', 5, 5, 1000, 0, { target: frozenTarget({ match: { type: 'GestureDetector' }, containing: { match: { text: 'Login' } } }, {}, 'label') }) });
    eventCallback?.({ kind: 'FliwrightRecording', timestamp: Date.now(), data: protocol.pointer('up', 5, 5, 1100, 0) });

    const { code } = await controller.stop();
    expect(code).toContain("containing: { match: { text: 'Login' } }");
    expect(code).not.toContain('// ambiguous');
    expect(sendRequest.mock.calls.some(([method]) => method === 'ext.fliwright.hitTest' || method === 'ext.fliwright.resolve')).toBe(false);
  });

  it('emits distinct selectors for two GestureDetectors distinguished by inner text', async () => {
    const protocol = createRecordingProtocolFixture();
    const widgets = [
      { id: '1', type: 'GestureDetector', descendantText: 'Login', properties: {} },
      { id: '2', type: 'GestureDetector', descendantText: 'Sign up', properties: {} },
    ];
    let hit = 0;
    const sendRequest = vi.fn().mockImplementation((method: string, params?: Record<string, unknown>) => {
      const response = protocol.response(method, params);
      if (response !== undefined) return Promise.resolve(response);
      return Promise.resolve({});
    });
    let eventCallback: ((event: { kind: string; timestamp: number; data: Record<string, unknown> }) => void) | null = null;
    const controller = new RecorderController(
      sendRequest,
      vi.fn().mockImplementation((cb) => { eventCallback = cb; return () => {}; }),
    );

    await controller.start();
    for (const [x, ts] of [[10, 1000], [12, 1100]] as const) {
      eventCallback?.({ kind: 'FliwrightRecording', timestamp: Date.now(), data: protocol.pointer('down', x, 5, ts, ts, { target: frozenTarget({ match: { type: 'GestureDetector' }, containing: { match: { text: ts === 1000 ? 'Login' : 'Sign up' } } }, {}, 'label') }) });
      eventCallback?.({ kind: 'FliwrightRecording', timestamp: Date.now(), data: protocol.pointer('up', x, 5, ts + 50, ts) });
    }

    const { code } = await controller.stop();
    expect(code).toContain("containing: { match: { text: 'Login' } }");
    expect(code).toContain("containing: { match: { text: 'Sign up' } }");
    expect(code).not.toContain('// ambiguous');
    expect(sendRequest.mock.calls.some(([method]) => method === 'ext.fliwright.hitTest' || method === 'ext.fliwright.resolve')).toBe(false);
  });
});
