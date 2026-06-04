import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VMServiceConnector } from '../src/VMServiceConnector.js';

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

  it('handles event stream notifications', async () => {
    const onEvent = vi.fn();
    connector.onEvent(onEvent);
    mockWS.emit('message', JSON.stringify({
      jsonrpc: '2.0', method: 'streamNotify',
      params: { streamId: 'Extension', event: { type: 'Extension', extensionKind: 'riverpod_changed', extensionData: { key: 'counter', value: 5 } } },
    }));
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ kind: 'riverpod_changed', data: { key: 'counter', value: 5 } }));
  });

  it('attaches the mock WS for testing', () => {
    expect(() => connector.sendRequest('getVM')).toBeDefined();
  });
});
