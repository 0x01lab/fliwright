import { afterEach, describe, expect, it, vi } from 'vitest';
import { discoverVmServiceUrl, normalizeVmServiceUrl, resolveVmServiceUrl } from '../src/session/VmServiceDiscovery.js';

describe('VmServiceDiscovery', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('normalizes http VM Service URLs to websocket URLs', () => {
    expect(normalizeVmServiceUrl('http://127.0.0.1:8181')).toBe('ws://127.0.0.1:8181/ws');
    expect(normalizeVmServiceUrl('ws://127.0.0.1:8181/ws')).toBe('ws://127.0.0.1:8181/ws');
  });

  it('uses explicit, config, then environment URL before discovery', async () => {
    vi.stubEnv('FLIWRIGHT_VM_URL', 'ws://env/ws');

    await expect(resolveVmServiceUrl({ userInput: 'ws://input/ws' })).resolves.toBe('ws://input/ws');
    await expect(resolveVmServiceUrl({ configUrl: 'ws://config/ws' })).resolves.toBe('ws://config/ws');
    await expect(resolveVmServiceUrl({ autoDiscover: false })).resolves.toBe('ws://env/ws');
  });

  it('discovers the first responsive local service', async () => {
    const fetch = vi.fn()
      .mockRejectedValueOnce(new Error('closed'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ webSocketDebuggerUrl: 'ws://127.0.0.1:9189/custom-ws' }),
      });
    vi.stubGlobal('fetch', fetch);

    const url = await discoverVmServiceUrl([8181, 9189]);

    expect(url).toBe('ws://127.0.0.1:9189/custom-ws');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
