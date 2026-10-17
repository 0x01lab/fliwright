import { describe, expect, it, vi } from 'vitest';
import { RecorderController } from '../src/RecorderController.js';
import { createRecordingProtocolFixture } from './helpers/recordingProtocol.js';

function createRecorder(request?: (method: string) => Promise<unknown>) {
  const unsubscribe = vi.fn();
  const protocol = createRecordingProtocolFixture();
  const send = vi.fn(async (method: string, params?: Record<string, unknown>) =>
    await request?.(method) ?? protocol.response(method, params) ?? {});
  const subscribe = vi.fn(() => unsubscribe);
  return { controller: new RecorderController(send, subscribe), send, subscribe, unsubscribe };
}

describe('recording resource lifecycle', () => {
  it('releases its listener and retains the transport error when start fails', async () => {
    const error = new Error('VM disconnected while starting');
    const { controller, unsubscribe } = createRecorder(async (method) => {
      if (method === 'ext.fliwright.startRecording') throw error;
      return undefined;
    });
    await expect(controller.start()).rejects.toBe(error);
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(controller.getStatus()).toBe('failed');
    expect((await controller.stop()).issues).toContain(error.message);
  });

  it('returns a failed result on a bridge stop rejection and always unsubscribes', async () => {
    const { controller, unsubscribe } = createRecorder(async (method) => {
      if (method === 'ext.fliwright.stopRecording') return { success: false, error: 'flush failed' };
      return undefined;
    });
    await controller.start();
    const result = await controller.stop();
    expect(result.status).toBe('failed');
    expect(result.issues).toContain('flush failed');
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(await controller.stop()).toEqual(result);
  });

  it('preserves a stop transport failure across repeated stop calls', async () => {
    const { controller, unsubscribe } = createRecorder(async (method) => {
      if (method === 'ext.fliwright.stopRecording') throw new Error('connection lost');
      return undefined;
    });
    await controller.start();
    const result = await controller.stop();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ status: 'failed', issues: ['connection lost'] });
    expect(await controller.stop()).toEqual(result);
  });

  it('flushes only once for concurrent stop calls', async () => {
    const { controller, send, unsubscribe } = createRecorder();
    await controller.start();
    const [first, second] = await Promise.all([controller.stop(), controller.stop()]);
    expect(first).toEqual(second);
    expect(send.mock.calls.filter(([method]) => method === 'ext.fliwright.stopRecording')).toHaveLength(1);
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('rejects an overlapping start without losing the active listener', async () => {
    const { controller, subscribe, unsubscribe } = createRecorder();
    await controller.start();
    await expect(controller.start()).rejects.toThrow(/already|active/i);
    expect(subscribe).toHaveBeenCalledOnce();
    await controller.stop();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('bounds a hung stop RPC and returns diagnostics after local cleanup', async () => {
    const { controller, unsubscribe } = createRecorder(async (method) => {
      if (method === 'ext.fliwright.stopRecording') return new Promise(() => {});
      return undefined;
    });
    await controller.start({ requestTimeoutMs: 20 });
    const result = await controller.stop();
    expect(result.status).toBe('failed');
    expect(result.issues.join(' ')).toMatch(/stop.*timed out/i);
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('retains the bridge error when local unsubscription also fails', async () => {
    const protocol = createRecordingProtocolFixture();
    const send = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === 'ext.fliwright.startRecording') throw new Error('original start error');
      return protocol.response(method, params) ?? {};
    });
    const controller = new RecorderController(send, () => () => { throw new Error('listener cleanup error'); });
    await expect(controller.start()).rejects.toThrow('original start error');
    expect((await controller.stop()).issues).toEqual(expect.arrayContaining(['original start error', 'listener cleanup error']));
  });

  it('bounds a hung screenshot without hanging the recording session', async () => {
    const { controller, unsubscribe } = createRecorder(async (method) => {
      if (method === 'ext.fliwright.screenshot') return new Promise(() => {});
      return undefined;
    });
    await controller.start({ requestTimeoutMs: 20, captureScreenshots: true });
    const result = await controller.stop();
    expect(result.status).toBe('partial');
    expect(result.issues.join(' ')).toMatch(/screenshot.*timed out/i);
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
