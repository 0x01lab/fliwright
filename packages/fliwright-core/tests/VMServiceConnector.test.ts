import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VMServiceConnector } from '../src/VMServiceConnector.js';
import { recordingEventEnvelopeSchema } from '../src/RunContracts.js';

function createMockWS() {
  const listeners: Record<string, Array<(...args: any[]) => void>> = {};
  const sent: string[] = [];
  return {
    on(event: string, fn: (...args: any[]) => void) { (listeners[event] ??= []).push(fn); },
    send(data: string) { sent.push(data); },
    close: vi.fn(),
    emit(event: string, ...args: unknown[]) { (listeners[event] ?? []).forEach((fn) => fn(...args)); },
    sent,
  };
}

async function resolveMainIsolate(mockWS: ReturnType<typeof createMockWS>) {
  const sent = JSON.parse(mockWS.sent[0]);
  expect(sent.method).toBe('getVM');
  mockWS.emit('message', JSON.stringify({
    jsonrpc: '2.0',
    id: sent.id,
    result: {
      isolates: [{ id: 'isolates/main', name: 'main', isSystemIsolate: false }],
    },
  }));
  await Promise.resolve();
}

describe('VMServiceConnector', () => {
  let connector: VMServiceConnector;
  let mockWS: ReturnType<typeof createMockWS>;

  beforeEach(() => {
    connector = new VMServiceConnector();
    mockWS = createMockWS();
    connector.attachMock(mockWS);
  });

  it('resolves a pending request when response arrives', async () => {
    const responsePromise = connector.sendRequest('ext.fliwright.ping', { name: 'test' });
    await resolveMainIsolate(mockWS);
    const sent = JSON.parse(mockWS.sent[1]);
    mockWS.emit('message', JSON.stringify({ jsonrpc: '2.0', id: sent.id, result: { greeting: 'Hello, test!' } }));
    const result = await responsePromise;
    expect(result).toEqual({ greeting: 'Hello, test!' });
  });

  it('rejects when error response arrives', async () => {
    const responsePromise = connector.sendRequest('ext.fliwright.bad');
    await resolveMainIsolate(mockWS);
    const sent = JSON.parse(mockWS.sent[1]);
    mockWS.emit('message', JSON.stringify({ jsonrpc: '2.0', id: sent.id, error: { code: -32000, message: 'Method not found' } }));
    await expect(responsePromise).rejects.toThrow('VM Service error [-32000]: Method not found');
  });

  it('adds the main isolate id to service extension calls', async () => {
    const responsePromise = connector.sendRequest('ext.fliwright.inspect', { selector: 'text=Login' });
    await resolveMainIsolate(mockWS);

    const sent = JSON.parse(mockWS.sent[1]);
    expect(sent.method).toBe('ext.fliwright.inspect');
    expect(sent.params).toEqual({
      selector: 'text=Login',
      isolateId: 'isolates/main',
    });

    mockWS.emit('message', JSON.stringify({ jsonrpc: '2.0', id: sent.id, result: { widgets: [] } }));
    await expect(responsePromise).resolves.toEqual({ widgets: [] });
  });

  it('reloadSources sends the main isolate id to the VM service', async () => {
    const responsePromise = connector.reloadSources();
    await resolveMainIsolate(mockWS);

    const sent = JSON.parse(mockWS.sent[1]);
    expect(sent.method).toBe('reloadSources');
    expect(sent.params).toEqual({ isolateId: 'isolates/main' });

    mockWS.emit('message', JSON.stringify({ jsonrpc: '2.0', id: sent.id, result: { type: 'Success' } }));
    await expect(responsePromise).resolves.toEqual({ type: 'Success' });
  });

  it('refreshes the cached isolate after its exit event', async () => {
    const initialRequest = connector.sendRequest('ext.fliwright.mock.listRoutes');
    await resolveMainIsolate(mockWS);
    const initialExtensionRequest = JSON.parse(mockWS.sent[1]);
    mockWS.emit('message', JSON.stringify({
      jsonrpc: '2.0',
      id: initialExtensionRequest.id,
      result: { routes: [] },
    }));
    await expect(initialRequest).resolves.toEqual({ routes: [] });

    mockWS.emit('message', JSON.stringify({
      jsonrpc: '2.0',
      method: 'streamNotify',
      params: {
        streamId: 'Isolate',
        event: {
          kind: 'IsolateExit',
          isolate: { id: 'isolates/main' },
        },
      },
    }));

    const nextRequest = connector.sendRequest('ext.fliwright.mock.listRoutes');
    await Promise.resolve();
    const isolateRefresh = JSON.parse(mockWS.sent[2]);
    expect(isolateRefresh).toMatchObject({ method: 'getVM' });
    mockWS.emit('message', JSON.stringify({
      jsonrpc: '2.0',
      id: isolateRefresh.id,
      result: {
        isolates: [{ id: 'isolates/restarted-main', name: 'main', isSystemIsolate: false }],
      },
    }));
    await vi.waitFor(() => expect(mockWS.sent).toHaveLength(4));

    const restartedExtensionRequest = JSON.parse(mockWS.sent[3]);
    expect(restartedExtensionRequest).toMatchObject({
      method: 'ext.fliwright.mock.listRoutes',
      params: { isolateId: 'isolates/restarted-main' },
    });
    mockWS.emit('message', JSON.stringify({
      jsonrpc: '2.0',
      id: restartedExtensionRequest.id,
      result: { routes: [{ id: 'persisted', path: '/api/session', method: 'GET' }] },
    }));
    await expect(nextRequest).resolves.toEqual({
      routes: [{ id: 'persisted', path: '/api/session', method: 'GET' }],
    });
  });

  it('handles event stream notifications', async () => {
    const onEvent = vi.fn();
    connector.onEvent(onEvent);
    mockWS.emit('message', JSON.stringify({
      jsonrpc: '2.0', method: 'streamNotify',
      params: { streamId: 'Extension', event: { type: 'Extension', extensionKind: 'riverpod_changed', extensionData: { key: 'counter', value: 5 } } },
    }));
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ kind: 'riverpod_changed', data: { key: 'counter', value: 5 } }));
  });

  it('removes VM destination metadata before validating Android recording events', () => {
    const onEvent = vi.fn();
    connector.onEvent(onEvent);
    const notify = (extra: Record<string, unknown>) => mockWS.emit('message', JSON.stringify({
      jsonrpc: '2.0', method: 'streamNotify', params: { streamId: 'Extension', event: {
        type: 'Extension', extensionKind: 'FliwrightRecording', extensionData: {
          version: 2, sessionId: 'android-session', sequence: 1, elapsedUs: 205, frameId: 'frame-1',
          payload: { kind: 'route', route: '/' }, __destinationStream: 'Extension', ...extra,
        },
      } },
    }));
    notify({});
    const event = onEvent.mock.calls[0][0];
    expect(event.streamId).toBe('Extension');
    expect(event.data).not.toHaveProperty('__destinationStream');
    expect(recordingEventEnvelopeSchema.safeParse(event.data).success).toBe(true);
    notify({ unexpectedRecordingField: true });
    const invalid = onEvent.mock.calls[1][0].data;
    expect(invalid).toHaveProperty('unexpectedRecordingField', true);
    expect(recordingEventEnvelopeSchema.safeParse(invalid).success).toBe(false);
  });

  it('buffers diagnostics with stream ids and supports filters', () => {
    mockWS.emit('message', JSON.stringify({
      jsonrpc: '2.0',
      method: 'streamNotify',
      params: {
        streamId: 'Logging',
        event: {
          kind: 'Logging',
          logRecord: { message: 'hello' },
        },
      },
    }));
    mockWS.emit('message', JSON.stringify({
      jsonrpc: '2.0',
      method: 'streamNotify',
      params: {
        streamId: 'Isolate',
        event: {
          kind: 'UnhandledException',
          data: { message: 'boom' },
        },
      },
    }));

    expect(connector.getDiagnostics()).toHaveLength(2);
    expect(connector.getDiagnostics({ streams: ['Logging'] })).toEqual([
      expect.objectContaining({
        kind: 'Logging',
        streamId: 'Logging',
        data: expect.objectContaining({ logRecord: { message: 'hello' } }),
      }),
    ]);
    expect(connector.getDiagnostics({ kinds: ['UnhandledException'] })).toEqual([
      expect.objectContaining({
        kind: 'UnhandledException',
        streamId: 'Isolate',
        data: { message: 'boom' },
      }),
    ]);

    connector.clearDiagnostics();
    expect(connector.getDiagnostics()).toEqual([]);
  });

  it('subscribes to diagnostic streams and ignores already subscribed errors', async () => {
    const listenPromise = connector.listenToStreams(['Logging', 'Stderr']);
    const first = JSON.parse(mockWS.sent[0]);
    expect(first).toMatchObject({ method: 'streamListen', params: { streamId: 'Logging' } });
    mockWS.emit('message', JSON.stringify({ jsonrpc: '2.0', id: first.id, result: { type: 'Success' } }));
    await Promise.resolve();

    const second = JSON.parse(mockWS.sent[1]);
    expect(second).toMatchObject({ method: 'streamListen', params: { streamId: 'Stderr' } });
    mockWS.emit('message', JSON.stringify({
      jsonrpc: '2.0',
      id: second.id,
      error: { code: -32000, message: 'Stream already subscribed' },
    }));

    await expect(listenPromise).resolves.toBeUndefined();
  });

  it('attaches the mock WS for testing', () => {
    expect(() => connector.sendRequest('getVM')).toBeDefined();
  });

  it('rejects pending requests and refuses new requests after the VM socket closes', async () => {
    const pending = connector.sendRequest('ext.fliwright.inspect', { selector: 'text=Gone' });
    await resolveMainIsolate(mockWS);
    const request = JSON.parse(mockWS.sent[1]);
    expect(request.method).toBe('ext.fliwright.inspect');

    mockWS.emit('close');

    await expect(pending).rejects.toThrow('WebSocket connection closed');
    await expect(connector.sendRequest('ext.fliwright.inspect', { selector: 'text=Gone' }))
      .rejects.toThrow('Not connected. Call connect() first.');
  });

  it('does not let a stale socket close event reject a newer connection', async () => {
    const first = mockWS;
    const second = createMockWS();
    connector.attachMock(second);
    const pending = connector.sendRequest('getVM');

    first.emit('close');
    expect(second.sent).toHaveLength(1);
    const request = JSON.parse(second.sent[0]);
    second.emit('message', JSON.stringify({
      jsonrpc: '2.0', id: request.id,
      result: { isolates: [{ id: 'isolates/new-main', isSystemIsolate: false }] },
    }));
    await expect(pending).resolves.toMatchObject({ isolates: [{ id: 'isolates/new-main' }] });
  });

  it('rejects requests from a replaced socket instead of leaving them pending', async () => {
    const pending = connector.sendRequest('getVM');
    const replacement = createMockWS();
    connector.attachMock(replacement);
    await expect(pending).rejects.toThrow('VM Service connection replaced');
  });
});
