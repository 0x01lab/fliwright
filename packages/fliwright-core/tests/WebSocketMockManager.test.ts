import { describe, expect, it, vi } from 'vitest';
import { WebSocketMockManager } from '../src/WebSocketMockManager.js';

describe('WebSocketMockManager', () => {
  it('sends generic rules to the bridge without transport-specific fields', async () => {
    const sendRequest = vi.fn(async () => ({ success: true, rules: 1 }));
    const manager = new WebSocketMockManager(sendRequest);
    const rules = [{
      id: 'order-created',
      connection: 'public',
      channel: 'orders',
      suppressRemote: true,
      onSubscribe: [{ payload: { type: 'order.created', id: 'order-1' }, delayMs: 25 }],
    }];

    await expect(manager.setRules(rules)).resolves.toEqual({ success: true, rules: 1 });
    expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.websocket.setRules', {
      rules: JSON.stringify(rules),
    });
  });

  it('pushes an application-defined payload, clears calls, and reads runtime state', async () => {
    const sendRequest = vi
      .fn()
      .mockResolvedValueOnce({ success: true, matchedSessions: 1, deliveredSessions: 1 })
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({
        success: true,
        rules: [{ id: 'orders', connection: 'public', channel: 'orders' }],
      })
      .mockResolvedValueOnce({
        success: true,
        calls: [{ connection: 'public', channel: 'orders', direction: 'mock', payload: { id: 'order-1' } }],
      });
    const manager = new WebSocketMockManager(sendRequest);

    await expect(manager.push({ connection: 'public', channel: 'orders', payload: { id: 'order-1' } })).resolves.toEqual({
      matchedSessions: 1,
      deliveredSessions: 1,
    });
    await manager.clearCalls();
    await expect(manager.getRules()).resolves.toEqual([
      { id: 'orders', connection: 'public', channel: 'orders' },
    ]);
    await expect(manager.getCalls()).resolves.toEqual([
      { connection: 'public', channel: 'orders', direction: 'mock', payload: { id: 'order-1' } },
    ]);
    expect(sendRequest).toHaveBeenNthCalledWith(1, 'ext.fliwright.websocket.push', {
      push: JSON.stringify({ connection: 'public', channel: 'orders', payload: { id: 'order-1' } }),
    });
    expect(sendRequest).toHaveBeenNthCalledWith(2, 'ext.fliwright.websocket.clearCalls', undefined);
    expect(sendRequest).toHaveBeenNthCalledWith(3, 'ext.fliwright.websocket.getRules', undefined);
  });

  it('throws when the application rejects an invalid rule', async () => {
    const sendRequest = vi.fn(async () => ({ success: false, error: 'connection is required' }));
    const manager = new WebSocketMockManager(sendRequest);

    await expect(manager.setRules([])).rejects.toThrow('connection is required');
  });

  it('discovers the optional module through the core-owned handshake protocol', async () => {
    const sendRequest = vi.fn(async () => ({
      result: JSON.stringify({ bridgeCapabilities: { modules: [{ id: 'websocketMock' }] } }),
    }));
    const manager = new WebSocketMockManager(sendRequest);

    await expect(manager.isSupported()).resolves.toBe(true);
    expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.handshake', { protocolVersion: '1' });
  });

  it('treats missing or failed handshakes as unsupported', async () => {
    const manager = new WebSocketMockManager(vi.fn(async () => ({ bridgeCapabilities: { modules: [] } })));
    await expect(manager.isSupported()).resolves.toBe(false);
  });
});
