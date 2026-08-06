import { describe, expect, it, vi } from 'vitest';
import { Uri } from 'vscode';
import { WebSocketMockTreeProvider } from '../src/views/WebSocketMockTreeProvider.js';
import type { WebSocketMockConfigService } from '../src/websocket/WebSocketMockConfigService.js';

const profile = {
  kind: 'websocketProfile' as const,
  uri: Uri.file('/tmp/orders.json'),
  profile: {
    version: 1 as const,
    name: 'Orders',
    rules: [{
      id: 'orders',
      connection: 'public',
      channel: '/topic/orders',
      suppressRemote: true,
      onSubscribe: [{ payload: { id: 'order-1' } }],
    }],
    pushes: [{ name: 'Filled', connection: 'public', channel: '/topic/orders', payload: { id: 'order-1' } }],
  },
};

describe('WebSocketMockTreeProvider', () => {
  it('reports the unsupported state returned by capability discovery', async () => {
    const provider = providerWithProfiles();
    provider.setSupported(false);

    await expect(provider.getChildren()).resolves.toEqual([
      expect.objectContaining({ kind: 'empty', label: expect.stringContaining('not registered') }),
    ]);
  });

  it('marks the profile active from runtime rules and exposes push templates', async () => {
    const provider = providerWithProfiles();
    provider.setSupported(true);
    provider.setRuntimeState([{
      ...profile.profile.rules[0]!,
      onSubscribe: [{
        connection: 'public',
        channel: '/topic/orders',
        payload: { id: 'order-1' },
        delayMs: 0,
      }],
    }], [{ connection: 'public', channel: '/topic/orders', direction: 'mock' }]);

    const root = await provider.getChildren();
    const item = provider.getTreeItem(profile);
    const children = await provider.getChildren(profile);

    expect(root).toContainEqual(expect.objectContaining({ kind: 'websocketCallsRoot' }));
    expect(item.contextValue).toBe('websocketProfileActive');
    expect(children).toEqual([
      expect.objectContaining({ kind: 'websocketRule' }),
      expect.objectContaining({ kind: 'websocketPush' }),
    ]);

    const callItem = provider.getTreeItem({
      kind: 'websocketCall',
      connection: 'public',
      channel: '/topic/orders',
      direction: 'mock',
      payload: { id: 'order-1' },
    });
    expect(callItem.command).toMatchObject({ command: 'fliwright.inspectWebSocketMockCall' });
  });
});

function providerWithProfiles(): WebSocketMockTreeProvider {
  return new WebSocketMockTreeProvider({
    discover: vi.fn().mockResolvedValue({
      root: Uri.file('/tmp/.fliwright/mocks/websocket'),
      profiles: [profile],
      invalid: [],
    }),
  } as unknown as WebSocketMockConfigService);
}
