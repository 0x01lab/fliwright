import { describe, it, expect, vi } from 'vitest';
import { RiverpodStateAdapter } from '../src/RiverpodStateAdapter.js';

function createMockSendRequest(responses: Record<string, unknown>) {
  return vi.fn().mockImplementation((method: string, params?: Record<string, unknown>) => {
    const key = `${method}:${params?.provider ?? ''}`;
    if (responses[key] !== undefined) return Promise.resolve(responses[key]);
    if (responses[method] !== undefined) return Promise.resolve(responses[method]);
    return Promise.resolve({});
  });
}

describe('RiverpodStateAdapter', () => {
  it('reads a provider value via VM Service', async () => {
    const sendRequest = createMockSendRequest({
      'ext.fliwright.riverpod.read': { provider: 'counter', value: 42, found: true },
    });
    const adapter = new RiverpodStateAdapter(sendRequest);
    const value = await adapter.read('counter');
    expect(value).toEqual(42);
    expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.riverpod.read', { provider: 'counter' });
  });

  it('writes a provider value via override', async () => {
    const sendRequest = createMockSendRequest({
      'ext.fliwright.riverpod.override': { provider: 'counter', overridden: true },
    });
    const adapter = new RiverpodStateAdapter(sendRequest);
    await adapter.write('counter', 99);
    expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.riverpod.override', { provider: 'counter', value: '99' });
  });

  it('lists providers', async () => {
    const sendRequest = createMockSendRequest({
      'ext.fliwright.riverpod.list': {
        providers: [
          { name: 'counter', type: 'int', value: 0 },
          { name: 'userProvider', type: 'User?', value: null },
        ],
      },
    });
    const adapter = new RiverpodStateAdapter(sendRequest);
    const providers = await adapter.listProviders();
    expect(providers).toHaveLength(2);
    expect(providers[0].name).toBe('counter');
  });

  it('returns riverpod bridge status', async () => {
    const sendRequest = createMockSendRequest({
      'ext.fliwright.riverpod.status': {
        observerInstalled: true,
        containerReady: false,
        providerCount: 2,
        watching: ['counter'],
      },
    });
    const adapter = new RiverpodStateAdapter(sendRequest);

    await expect(adapter.status()).resolves.toEqual({
      observerInstalled: true,
      containerReady: false,
      providerCount: 2,
      watching: ['counter'],
    });
  });

  it('throws bridge errors instead of returning false success', async () => {
    const sendRequest = createMockSendRequest({
      'ext.fliwright.riverpod.read': { error: 'ProviderObserver not installed' },
    });
    const adapter = new RiverpodStateAdapter(sendRequest);

    await expect(adapter.read('counter')).rejects.toThrow('ProviderObserver not installed');
  });

  it('overrides a provider', async () => {
    const sendRequest = createMockSendRequest({
      'ext.fliwright.riverpod.override': { provider: 'user', overridden: true },
    });
    const adapter = new RiverpodStateAdapter(sendRequest);
    await adapter.override('user', { name: 'Alice' });
    expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.riverpod.override', { provider: 'user', value: '{"name":"Alice"}' });
  });

  it('watch returns an unsubscribe function', async () => {
    const sendRequest = createMockSendRequest({
      'ext.fliwright.riverpod.watch': { watching: true, provider: 'counter' },
      'ext.fliwright.riverpod.unwatch': { watching: false, provider: 'counter' },
    });
    const onEvent = vi.fn();
    const adapter = new RiverpodStateAdapter(sendRequest);
    const unsub = await adapter.watch('counter', onEvent);
    expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.riverpod.watch', { provider: 'counter' });
    await unsub();
    expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.riverpod.unwatch', { provider: 'counter' });
  });
});
