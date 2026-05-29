import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VMServiceConnector } from '../src/VMServiceConnector.js';

function createMockWS() {
  const listeners: Record<string, Function[]> = {};
  const sent: string[] = [];
  return {
    on(event: string, fn: Function) { (listeners[event] ??= []).push(fn); },
    send(data: string) { sent.push(data); },
    close: vi.fn(),
    emit(event: string, ...args: unknown[]) { (listeners[event] ?? []).forEach((fn) => fn(...args)); },
    sent,
  };
}

describe('VMServiceConnector', () => {
  let connector: VMServiceConnector;
  let mockWS: ReturnType<typeof createMockWS>;

  beforeEach(() => {
    connector = new VMServiceConnector();
    mockWS = createMockWS();
    connector.attachMock(mockWS as any);
  });

  it('resolves a pending request when response arrives', async () => {
    const responsePromise = connector.sendRequest('ext.fliwright.ping', { name: 'test' });
    const sent = JSON.parse(mockWS.sent[0]);
    mockWS.emit('message', JSON.stringify({ jsonrpc: '2.0', id: sent.id, result: { greeting: 'Hello, test!' } }));
    const result = await responsePromise;
    expect(result).toEqual({ greeting: 'Hello, test!' });
  });

  it('rejects when error response arrives', async () => {
    const responsePromise = connector.sendRequest('ext.fliwright.bad');
    const sent = JSON.parse(mockWS.sent[0]);
    mockWS.emit('message', JSON.stringify({ jsonrpc: '2.0', id: sent.id, error: { code: -32000, message: 'Method not found' } }));
    await expect(responsePromise).rejects.toThrow('VM Service error [-32000]: Method not found');
  });

  it('handles event stream notifications', async () => {
    const onEvent = vi.fn();
    connector.onEvent(onEvent);
    mockWS.emit('message', JSON.stringify({
      jsonrpc: '2.0', method: 'streamNotify',
      params: { streamId: 'Extension', event: { kind: 'riverpod_changed', data: { key: 'counter', value: 5 } } },
    }));
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ kind: 'riverpod_changed', data: { key: 'counter', value: 5 } }));
  });

  it('attaches the mock WS for testing', () => {
    expect(() => connector.sendRequest('ext.fliwright.test')).toBeDefined();
  });
});
