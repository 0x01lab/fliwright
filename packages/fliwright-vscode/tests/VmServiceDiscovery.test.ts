import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  discoverVmServiceCandidates,
  discoverVmServiceUrl,
  extractVmServiceUrls,
  normalizeVmServiceUrl,
  resolveVmServiceUrl,
} from '../src/session/VmServiceDiscovery.js';

describe('VmServiceDiscovery', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('normalizes http VM Service URLs to websocket URLs', () => {
    expect(normalizeVmServiceUrl('http://127.0.0.1:8181')).toBe('ws://127.0.0.1:8181/ws');
    expect(normalizeVmServiceUrl('http://127.0.0.1:51830/u37pq71Re0k=/')).toBe('ws://127.0.0.1:51830/u37pq71Re0k=/ws');
    expect(normalizeVmServiceUrl('ws://127.0.0.1:8181/ws')).toBe('ws://127.0.0.1:8181/ws');
  });

  it('extracts VM Service URLs from Flutter and DevTools output', () => {
    const output = [
      'The Dart VM Service is listening on http://127.0.0.1:51830/u37pq71Re0k=/',
      'Debug service listening on ws://127.0.0.1:51999/abc=/ws.',
      'DevTools: http://127.0.0.1:9100/?uri=http%3A%2F%2F127.0.0.1%3A52000%2FdevToken%3D%2F',
    ].join('\n');

    expect(extractVmServiceUrls(output)).toEqual([
      'ws://127.0.0.1:51830/u37pq71Re0k=/ws',
      'ws://127.0.0.1:51999/abc=/ws',
      'ws://127.0.0.1:52000/devToken=/ws',
    ]);
  });

  it('ignores non-VM localhost URLs from Flutter debug output', () => {
    const output = [
      '[fliwright.mock.dio] Dio mock controller set to http://127.0.0.1:52450',
      'GET http://127.0.0.1:8080/api/profile',
      'The Dart VM Service is listening on http://127.0.0.1:51830/u37pq71Re0k=/',
    ].join('\n');

    expect(extractVmServiceUrls(output)).toEqual([
      'ws://127.0.0.1:51830/u37pq71Re0k=/ws',
    ]);
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

  it('returns candidates from logs, cache, and local port scans ordered by confidence', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('closed'));
    vi.stubGlobal('fetch', fetch);

    const candidates = await discoverVmServiceCandidates({
      cachedUrl: 'http://127.0.0.1:11111/cache=/',
      logText: 'A Dart VM Service is available at: http://127.0.0.1:22222/log=/',
      ports: [],
    });

    expect(candidates.map((candidate) => [candidate.source, candidate.url])).toEqual([
      ['log', 'ws://127.0.0.1:22222/log=/ws'],
      ['cache', 'ws://127.0.0.1:11111/cache=/ws'],
    ]);
  });
});
