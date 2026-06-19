import { describe, it, expect, vi } from 'vitest';
import { RecorderController } from '../src/RecorderController.js';

describe('RecorderController', () => {
  it('subscribes to the Extension stream and starts Dart recording', async () => {
    const sendRequest = vi.fn().mockResolvedValue({ recording: true });
    const onEvent = vi.fn().mockReturnValue(() => {});
    const controller = new RecorderController(sendRequest, onEvent);

    await controller.start();

    expect(sendRequest).toHaveBeenNthCalledWith(1, 'streamListen', { streamId: 'Extension' });
    expect(sendRequest).toHaveBeenNthCalledWith(2, 'ext.fliwright.startRecording', {});
    expect(onEvent).toHaveBeenCalledOnce();
  });

  it('stops Dart recording and generates code from received events', async () => {
    const sendRequest = vi.fn().mockImplementation((method: string) => {
      if (method === 'streamListen') return Promise.resolve({});
      if (method === 'ext.fliwright.startRecording') return Promise.resolve({ recording: true });
      if (method === 'ext.fliwright.stopRecording') return Promise.resolve({ recording: false });
      if (method === 'ext.fliwright.hitTest') {
        return Promise.resolve({
          widget: {
            id: '1',
            type: 'ElevatedButton',
            text: 'Login',
            rect: { x: 0, y: 0, width: 100, height: 40 },
            properties: {},
          },
        });
      }
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
      data: { type: 'pointerEvent', kind: 'down', pointer: 0, position: { x: 100, y: 200 }, timestamp: 1000, buttons: 1 },
    });
    eventCallback?.({
      kind: 'FliwrightRecording',
      timestamp: Date.now(),
      data: { type: 'pointerEvent', kind: 'up', pointer: 0, position: { x: 100, y: 200 }, timestamp: 1100, buttons: 0 },
    });

    const code = await controller.stop();

    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.stopRecording', {});
    expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.hitTest', { x: 100, y: 200 });
    expect(code).toContain("import { test, expect } from '@fliwright/vitest'");
    expect(code).toContain("page.locator({ text: 'Login' }).click()");
    expect(controller.getOperations()).toEqual([
      { kind: 'tap', position: { x: 100, y: 200 }, timestamp: 1000 },
    ]);
  });

  it('ignores an already-subscribed Extension stream', async () => {
    const sendRequest = vi.fn().mockImplementation((method: string) => {
      if (method === 'streamListen') return Promise.reject(new Error('Stream already subscribed'));
      return Promise.resolve({});
    });
    const controller = new RecorderController(sendRequest, vi.fn().mockReturnValue(() => {}));

    await expect(controller.start()).resolves.toBeUndefined();
    expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.startRecording', {});
  });

  it('falls back to a type selector when hitTest fails', async () => {
    const sendRequest = vi.fn().mockImplementation((method: string) => {
      if (method === 'ext.fliwright.hitTest') return Promise.reject(new Error('no tree'));
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
      data: { type: 'pointerEvent', kind: 'down', pointer: 0, position: { x: 10, y: 20 }, timestamp: 1000, buttons: 1 },
    });
    eventCallback?.({
      kind: 'FliwrightRecording',
      timestamp: Date.now(),
      data: { type: 'pointerEvent', kind: 'up', pointer: 0, position: { x: 10, y: 20 }, timestamp: 1100, buttons: 0 },
    });

    const code = await controller.stop();

    expect(code).toContain("page.locator({ type: 'Widget' }).click()");
  });

  it('marks generic tap operations ignored when noise filtering is enabled', async () => {
    const sendRequest = vi.fn().mockImplementation((method: string) => {
      if (method === 'ext.fliwright.hitTest') {
        return Promise.resolve({ widget: {} });
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

    await controller.start({ filterNoise: true });
    eventCallback?.({
      kind: 'FliwrightRecording',
      timestamp: Date.now(),
      data: { type: 'pointerEvent', kind: 'down', pointer: 0, position: { x: 10, y: 20 }, timestamp: 1000, buttons: 1 },
    });
    eventCallback?.({
      kind: 'FliwrightRecording',
      timestamp: Date.now(),
      data: { type: 'pointerEvent', kind: 'up', pointer: 0, position: { x: 10, y: 20 }, timestamp: 1100, buttons: 0 },
    });

    const code = await controller.stop();

    expect(code).not.toContain('.click()');
    expect(controller.getOperations()[0]).toEqual(expect.objectContaining({
      status: 'ignored',
      ignoreReason: 'nonActionable',
    }));
  });

  it('can manually include an ignored operation after stop', async () => {
    const sendRequest = vi.fn().mockImplementation((method: string) => {
      if (method === 'ext.fliwright.hitTest') return Promise.resolve({ widget: {} });
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
      data: { type: 'pointerEvent', kind: 'down', pointer: 0, position: { x: 10, y: 20 }, timestamp: 1000, buttons: 1 },
    });
    eventCallback?.({
      kind: 'FliwrightRecording',
      timestamp: Date.now(),
      data: { type: 'pointerEvent', kind: 'up', pointer: 0, position: { x: 10, y: 20 }, timestamp: 1100, buttons: 0 },
    });
    await controller.stop();

    const code = controller.setOperationIncluded(0, true);

    expect(code).toContain("page.locator({ type: 'Widget' }).click()");
    expect(controller.getOperations()[0]).toEqual(expect.objectContaining({
      status: 'included',
      ignoreReason: undefined,
    }));
  });

  it('marks rapid nearby duplicate taps ignored when noise filtering is enabled', async () => {
    const sendRequest = vi.fn().mockImplementation((method: string) => {
      if (method === 'ext.fliwright.hitTest') {
        return Promise.resolve({
          widget: {
            id: '1',
            type: 'ElevatedButton',
            text: 'Open',
            properties: {},
          },
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
        data: {
          type: 'pointerEvent',
          kind: timestamp === 1000 || timestamp === 1200 ? 'down' : 'up',
          pointer,
          position: { x, y },
          timestamp,
          buttons: timestamp === 1000 || timestamp === 1200 ? 1 : 0,
        },
      });
    }

    const code = await controller.stop();

    expect(code.match(/\.click\(\)/g)).toHaveLength(1);
    expect(controller.getOperations()[1]).toEqual(expect.objectContaining({
      status: 'ignored',
      ignoreReason: 'duplicate',
    }));
  });

  it('keeps listening until stopRecording resolves', async () => {
    let eventCallback: ((event: { kind: string; timestamp: number; data: Record<string, unknown> }) => void) | null = null;
    const unsubscribe = vi.fn();
    const sendRequest = vi.fn().mockImplementation((method: string) => {
      if (method === 'ext.fliwright.stopRecording') {
        eventCallback?.({
          kind: 'FliwrightRecording',
          timestamp: Date.now(),
          data: { type: 'pointerEvent', kind: 'down', pointer: 0, position: { x: 10, y: 20 }, timestamp: 1000, buttons: 1 },
        });
        eventCallback?.({
          kind: 'FliwrightRecording',
          timestamp: Date.now(),
          data: { type: 'pointerEvent', kind: 'up', pointer: 0, position: { x: 10, y: 20 }, timestamp: 1100, buttons: 0 },
        });
      }
      return Promise.resolve({});
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
    const frames: unknown[] = [];
    const sendRequest = vi.fn().mockImplementation((method: string) => {
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
      if (method === 'ext.fliwright.hitTest') {
        return Promise.resolve({
          widget: {
            id: '1',
            type: 'ElevatedButton',
            text: 'Login',
            properties: {},
          },
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
      data: { type: 'pointerEvent', kind: 'down', pointer: 7, position: { x: 100, y: 200 }, timestamp: 1000, buttons: 1 },
    });
    eventCallback?.({
      kind: 'FliwrightRecording',
      timestamp: Date.now(),
      data: { type: 'pointerEvent', kind: 'up', pointer: 7, position: { x: 100, y: 200 }, timestamp: 1100, buttons: 0 },
    });
    await controller.stop();

    expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.settle', { timeout: '1200', stableFrames: '2' });
    expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.screenshot', { pixelRatio: '1.0', waitForFrame: 'false' });
    expect(controller.getFrames()).toEqual([
      expect.objectContaining({
        index: 0,
        kind: 'tap',
        status: 'ready',
        pointer: 7,
        operationIndex: 0,
        position: { x: 100, y: 200 },
        selector: "{ text: 'Login' }",
        screenshot: {
          base64: 'base64-png',
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
    const sendRequest = vi.fn().mockImplementation((method: string) => {
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
      data: { type: 'pointerEvent', kind: 'down', pointer: 0, position: { x: 10, y: 20 }, timestamp: 1000, buttons: 1 },
    });
    eventCallback?.({
      kind: 'FliwrightRecording',
      timestamp: Date.now(),
      data: { type: 'pointerEvent', kind: 'up', pointer: 0, position: { x: 10, y: 20 }, timestamp: 1100, buttons: 0 },
    });

    await expect(controller.stop()).resolves.toContain('page.locator');
    expect(controller.getFrames()[0]).toEqual(expect.objectContaining({
      status: 'error',
      screenshotError: 'No repaint boundary',
      kind: 'tap',
    }));
  });

  it('accepts nested VM Service extension event payloads', async () => {
    const sendRequest = vi.fn().mockResolvedValue({});
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
        extensionData: { type: 'pointerEvent', kind: 'down', pointer: 0, position: { x: 10, y: 20 }, timestamp: 1000, buttons: 1 },
      },
    });
    eventCallback?.({
      kind: 'unknown',
      streamId: 'Extension',
      timestamp: Date.now(),
      data: {
        extensionKind: 'FliwrightRecording',
        extensionData: { type: 'pointerEvent', kind: 'up', pointer: 0, position: { x: 10, y: 20 }, timestamp: 1100, buttons: 0 },
      },
    });

    expect(controller.getRawEvents()).toHaveLength(2);
    expect(controller.getOperations()).toEqual([
      { kind: 'tap', position: { x: 10, y: 20 }, timestamp: 1000 },
    ]);
  });

  it('updates a tap frame to type when text input is associated', async () => {
    const sendRequest = vi.fn().mockResolvedValue({
      success: true,
      screenshot: 'base64-png',
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
      data: { type: 'pointerEvent', kind: 'down', pointer: 0, position: { x: 100, y: 200 }, timestamp: 1000, buttons: 1 },
    });
    eventCallback?.({
      kind: 'FliwrightRecording',
      timestamp: Date.now(),
      data: { type: 'pointerEvent', kind: 'up', pointer: 0, position: { x: 100, y: 200 }, timestamp: 1100, buttons: 0 },
    });
    eventCallback?.({
      kind: 'FliwrightRecording',
      timestamp: Date.now(),
      data: { type: 'textInput', text: 'hello', timestamp: 1200 },
    });
    await controller.stop();

    expect(controller.getFrames()[0]).toEqual(expect.objectContaining({
      kind: 'type',
      text: 'hello',
      position: { x: 100, y: 200 },
    }));
  });

  it('does not recapture screenshots on pointer down when a sampled screenshot exists', async () => {
    let activeScreenshots = 0;
    let maxActiveScreenshots = 0;
    const sendRequest = vi.fn().mockImplementation(async (method: string) => {
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
      data: { type: 'pointerEvent', kind: 'down', pointer: 1, position: { x: 10, y: 20 }, timestamp: 1000, buttons: 1 },
    });
    eventCallback?.({
      kind: 'FliwrightRecording',
      timestamp: Date.now(),
      data: { type: 'pointerEvent', kind: 'down', pointer: 2, position: { x: 30, y: 40 }, timestamp: 2000, buttons: 1 },
    });

    await controller.stop();

    expect(maxActiveScreenshots).toBe(1);
    expect(sendRequest.mock.calls.filter(([method]) => method === 'ext.fliwright.screenshot')).toHaveLength(1);
    expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.settle', { timeout: '1200', stableFrames: '2' });
    expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.screenshot', { pixelRatio: '1.0', waitForFrame: 'false' });
  });

  it('synthesizes a visible frame for a standalone textInput with no preceding tap', async () => {
    const sendRequest = vi.fn().mockImplementation((method: string) => {
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
      data: { type: 'textInput', text: 'hello', timestamp: 5000 },
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
    const sendRequest = vi.fn().mockImplementation((method: string) => {
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
      data: { type: 'textInput', text: 'one', timestamp: 1000 },
    });
    eventCallback?.({
      kind: 'FliwrightRecording',
      timestamp: Date.now(),
      data: { type: 'textInput', text: 'two', timestamp: 2_000_000 },
    });
    await controller.stop();

    const frames = controller.getFrames();
    expect(frames).toHaveLength(2);
    expect(frames[0]).toEqual(expect.objectContaining({ text: 'one', synthetic: true, index: 0 }));
    expect(frames[1]).toEqual(expect.objectContaining({ text: 'two', synthetic: true, index: 1 }));
  });

  it('records a drag operation as a frame carrying its delta', async () => {
    const sendRequest = vi.fn().mockImplementation((method: string) => {
      if (method === 'ext.fliwright.screenshot') {
        return Promise.resolve({ success: true, screenshot: 'b64', width: 320, height: 640, pixelRatio: 1 });
      }
      if (method === 'ext.fliwright.hitTest') {
        return Promise.resolve({ widget: { id: '1', type: 'ListView', properties: {} } });
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
        data: { type: 'pointerEvent', kind, pointer: 0, position: { x, y }, timestamp: ts, buttons: kind === 'up' ? 0 : 1 },
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
    const sendRequest = vi.fn().mockImplementation((method: string, params?: Record<string, unknown>) => {
      if (method === 'streamListen') return Promise.resolve({});
      if (method === 'ext.fliwright.startRecording') return Promise.resolve({ recording: true });
      if (method === 'ext.fliwright.stopRecording') return Promise.resolve({ recording: false });
      if (method === 'ext.fliwright.hitTest') {
        return Promise.resolve({
          widget: { id: '1', type: 'GestureDetector', descendantText: 'Login', properties: {} },
        });
      }
      if (method === 'ext.fliwright.resolve') {
        const q = JSON.parse((params as { selector: string }).selector);
        if (q.containing) return Promise.resolve({ count: 1 });
        return Promise.resolve({ count: 4 });
      }
      return Promise.resolve({});
    });
    let eventCallback: ((event: { kind: string; timestamp: number; data: Record<string, unknown> }) => void) | null = null;
    const controller = new RecorderController(
      sendRequest,
      vi.fn().mockImplementation((cb) => { eventCallback = cb; return () => {}; }),
    );

    await controller.start();
    eventCallback?.({ kind: 'FliwrightRecording', timestamp: Date.now(), data: { type: 'pointerEvent', kind: 'down', pointer: 0, position: { x: 5, y: 5 }, timestamp: 1000, buttons: 1 } });
    eventCallback?.({ kind: 'FliwrightRecording', timestamp: Date.now(), data: { type: 'pointerEvent', kind: 'up', pointer: 0, position: { x: 5, y: 5 }, timestamp: 1100, buttons: 0 } });

    const code = await controller.stop();
    expect(code).toContain("containing: { text: 'Login' }");
    expect(code).not.toContain('// ambiguous');
  });

  it('emits distinct selectors for two GestureDetectors distinguished by inner text', async () => {
    const widgets = [
      { id: '1', type: 'GestureDetector', descendantText: 'Login', properties: {} },
      { id: '2', type: 'GestureDetector', descendantText: 'Sign up', properties: {} },
    ];
    let hit = 0;
    const sendRequest = vi.fn().mockImplementation((method: string, params?: Record<string, unknown>) => {
      if (method === 'ext.fliwright.hitTest') return Promise.resolve({ widget: widgets[hit++ % widgets.length] });
      if (method === 'ext.fliwright.resolve') {
        const q = JSON.parse((params as { selector: string }).selector);
        // Each containing-scoped query is unique; bare matches are ambiguous.
        if (q.containing) return Promise.resolve({ count: 1 });
        return Promise.resolve({ count: 2 });
      }
      return Promise.resolve({});
    });
    let eventCallback: ((event: { kind: string; timestamp: number; data: Record<string, unknown> }) => void) | null = null;
    const controller = new RecorderController(
      sendRequest,
      vi.fn().mockImplementation((cb) => { eventCallback = cb; return () => {}; }),
    );

    await controller.start();
    for (const [x, ts] of [[10, 1000], [12, 1100]] as const) {
      eventCallback?.({ kind: 'FliwrightRecording', timestamp: Date.now(), data: { type: 'pointerEvent', kind: 'down', pointer: ts, position: { x, y: 5 }, timestamp: ts, buttons: 1 } });
      eventCallback?.({ kind: 'FliwrightRecording', timestamp: Date.now(), data: { type: 'pointerEvent', kind: 'up', pointer: ts, position: { x, y: 5 }, timestamp: ts + 50, buttons: 0 } });
    }

    const code = await controller.stop();
    expect(code).toContain("containing: { text: 'Login' }");
    expect(code).toContain("containing: { text: 'Sign up' }");
    expect(code).not.toContain('// ambiguous');
  });
});
