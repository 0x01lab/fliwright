import { describe, expect, it, vi } from 'vitest';
import { Uri } from 'vscode';
import { WebSocketMockService } from '../src/websocket/WebSocketMockService.js';

describe('WebSocketMockService', () => {
  it('delegates profile, push, and runtime operations to the core WebSocket manager', async () => {
    const websocketMock = {
      setRules: vi.fn(),
      isSupported: vi.fn().mockResolvedValue(true),
      clearRules: vi.fn(),
      push: vi.fn().mockResolvedValue({ matchedSessions: 1, deliveredSessions: 1 }),
      getRules: vi.fn().mockResolvedValue([{ id: 'orders', connection: 'public', channel: '/topic/orders' }]),
      getCalls: vi.fn().mockResolvedValue([]),
      clearCalls: vi.fn(),
    };
    const driver = { websocketMock } as never;
    const profile = {
      kind: 'websocketProfile' as const,
      uri: Uri.file('/tmp/orders.json'),
      profile: {
        version: 1 as const,
        name: 'Orders',
        rules: [{ id: 'orders', connection: 'public', channel: '/topic/orders' }],
      },
    };
    const service = new WebSocketMockService();

    await expect(service.isSupported(driver)).resolves.toBe(true);
    await service.applyProfile(driver, profile);
    await expect(service.sendPush(driver, {
      name: 'filled', connection: 'public', channel: '/topic/orders', payload: { id: 'order-1' },
    })).resolves.toEqual({ matchedSessions: 1, deliveredSessions: 1 });
    await service.clearRules(driver);
    await service.clearCalls(driver);
    await expect(service.getActiveRules(driver)).resolves.toHaveLength(1);
    await expect(service.getCalls(driver)).resolves.toEqual([]);

    expect(websocketMock.setRules).toHaveBeenCalledWith(profile.profile.rules);
    expect(websocketMock.push).toHaveBeenCalledWith(expect.objectContaining({ channel: '/topic/orders' }));
    expect(websocketMock.clearRules).toHaveBeenCalledOnce();
    expect(websocketMock.clearCalls).toHaveBeenCalledOnce();
  });
});
