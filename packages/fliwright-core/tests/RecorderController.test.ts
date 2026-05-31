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
});
