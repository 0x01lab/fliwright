import { describe, expect, it, vi } from 'vitest';
import { captureRecording } from '../src/RecordingCapture.js';
import type { RecordingResult } from '../src/RecorderController.js';
import { FliwrightDriver } from '../src/Driver.js';
import { once, getEventListeners } from 'node:events';
import { WebSocketServer } from 'ws';

const result: RecordingResult = {
  status: 'captured', receivedSequences: [], missingSequences: [],
  operations: [], frames: [], code: 'script code', issues: [],
};

function resource() {
  return {
    recorder: {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(result),
      getSelectors: () => new Map(),
      getArtifactDirectory: () => undefined,
    },
    dispose: vi.fn().mockResolvedValue(undefined),
  };
}

describe('shared recording capture lifecycle', () => {
  it('flushes once, returns the structured result, and releases the owned connection', async () => {
    const connection = resource();
    const captured = await captureRecording({ open: async () => connection, durationMs: 0 });
    expect(captured.recording).toEqual(result);
    expect(connection.recorder.stop).toHaveBeenCalledOnce();
    expect(connection.dispose).toHaveBeenCalledOnce();
    expect(captured.stopReason).toBe('duration');
  });

  it('cancels a long capture promptly, flushes it as partial, and disposes', async () => {
    const connection = resource();
    const abort = new AbortController();
    connection.recorder.start.mockImplementation(async () => abort.abort());
    const captured = await captureRecording({
      open: async () => connection, durationMs: 60_000, signal: abort.signal,
    });
    expect(captured.recording.status).toBe('partial');
    expect(captured.recording.issues).toContain('Recording cancelled.');
    expect(captured.stopReason).toBe('cancelled');
    expect(connection.dispose).toHaveBeenCalledOnce();
  });

  it('does not open a connection when already cancelled', async () => {
    const open = vi.fn();
    const abort = new AbortController();
    abort.abort();
    await expect(captureRecording({ open, signal: abort.signal, durationMs: 0 }))
      .rejects.toThrow(/cancelled/i);
    expect(open).not.toHaveBeenCalled();
  });

  it('preserves a start failure while attempting stop and disposal', async () => {
    const connection = resource();
    const original = new Error('bridge start failed');
    connection.recorder.start.mockRejectedValue(original);
    connection.recorder.stop.mockRejectedValue(new Error('stop failed'));
    connection.dispose.mockRejectedValue(new Error('dispose failed'));
    await expect(captureRecording({ open: async () => connection, durationMs: 0 })).rejects.toBe(original);
    expect(connection.recorder.stop).toHaveBeenCalledOnce();
    expect(connection.dispose).toHaveBeenCalledOnce();
  });

  it('cleans up when an external stop promise rejects, preserving the wait error', async () => {
    const connection = resource();
    const original = new Error('input channel closed');
    await expect(captureRecording({
      open: async () => connection,
      waitForStop: async () => { throw original; },
    })).rejects.toBe(original);
    expect(connection.recorder.stop).toHaveBeenCalledOnce();
    expect(connection.dispose).toHaveBeenCalledOnce();
  });

  it('bounds a hung stop and still releases the connection', async () => {
    const connection = resource();
    connection.recorder.stop.mockImplementation(() => new Promise(() => {}));
    await expect(captureRecording({
      open: async () => connection, durationMs: 0, cleanupTimeoutMs: 20,
    })).rejects.toThrow(/stop.*timed out/i);
    expect(connection.recorder.stop).toHaveBeenCalledOnce();
    expect(connection.dispose).toHaveBeenCalledOnce();
  });

  it('cancels owned driver cleanup and closes its actual socket when a plugin hangs', async () => {
    const server = new WebSocketServer({ port: 0 });
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing server address');
    let closed = false;
    server.on('connection', (socket) => {
      socket.on('close', () => { closed = true; });
      socket.on('message', (raw) => {
        const request = JSON.parse(raw.toString());
        if (request.method === 'getVersion') return;
        socket.send(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: request.method === 'getVM'
          ? { isolates: [{ id: 'isolates/main' }] } : {} }));
      });
    });
    const driver = new FliwrightDriver({ plugins: [{ name: 'hung-capture-cleanup', onDispose: () => new Promise(() => {}) }] });
    let cleanupSignal: AbortSignal | undefined;
    try {
      await driver.connect(`ws://127.0.0.1:${address.port}`);
      const pending = driver.sendRequest('getVersion').catch((error: Error) => error.message);
      const connection = resource();
      const captured = await captureRecording({
        durationMs: 0, cleanupTimeoutMs: 20,
        open: async () => ({
          recorder: connection.recorder,
          dispose: async (options?: { signal?: AbortSignal }) => {
            cleanupSignal = options?.signal;
            await driver.dispose(options);
          },
        }),
      });
      expect(captured.recording.status).toBe('partial');
      expect(captured.recording.issues.join(' ')).toMatch(/disposal.*timed out/i);
      expect(cleanupSignal).toBeInstanceOf(AbortSignal);
      expect(cleanupSignal?.aborted).toBe(true);
      await expect(pending).resolves.toMatch(/disconnected/);
      await vi.waitFor(() => expect(closed).toBe(true), { timeout: 200, interval: 5 });
      expect(getEventListeners(cleanupSignal!, 'abort')).toHaveLength(0);
      await expect(driver.sendRequest('getVersion')).rejects.toThrow('Not connected');
    } finally {
      await driver.dispose({ signal: AbortSignal.abort() }).catch(() => {});
      for (const client of server.clients) client.terminate();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
