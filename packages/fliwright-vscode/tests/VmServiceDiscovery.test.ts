import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  discoverVmServiceCandidates,
  discoverVmServiceUrl,
  extractVmServiceUrls,
  normalizeVmServiceUrl,
  resolveVmServiceUrl,
  VmServiceDebugOutput,
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
      workspaceConfigUrl: 'http://127.0.0.1:33333/workspace=/',
      logText: 'A Dart VM Service is available at: http://127.0.0.1:22222/log=/',
      ports: [],
    });

    expect(candidates.map((candidate) => [candidate.source, candidate.url])).toEqual([
      ['log', 'ws://127.0.0.1:22222/log=/ws'],
      ['workspace-config', 'ws://127.0.0.1:33333/workspace=/ws'],
      ['cache', 'ws://127.0.0.1:11111/cache=/ws'],
    ]);
  });

  it.each(['11111/old', '22222/current'])('tries the latest debug endpoint before the cached endpoint %s', async (cached) => {
    const candidates = await discoverVmServiceCandidates({
      cachedUrl: `http://127.0.0.1:${cached}=/`,
      logText: [
        'The Dart VM Service is listening on http://127.0.0.1:11111/old=/',
        'The Dart VM Service is listening on http://127.0.0.1:22222/current=/',
      ].join('\n'),
      ports: [],
    });

    expect(candidates.map(candidate => [candidate.source, candidate.url])).toEqual([
      ['log', 'ws://127.0.0.1:22222/current=/ws'],
      ['log', 'ws://127.0.0.1:11111/old=/ws'],
    ]);
  });

  it('orders repeated log endpoints by their last occurrence', async () => {
    const candidates = await discoverVmServiceCandidates({
      logText: [
        'Dart VM Service: http://127.0.0.1:11111/first=/',
        'Dart VM Service: http://127.0.0.1:22222/second=/',
        'Dart VM Service: http://127.0.0.1:11111/first=/',
      ].join('\n'),
      ports: [],
    });
    expect(candidates.map(candidate => candidate.url)).toEqual([
      'ws://127.0.0.1:11111/first=/ws',
      'ws://127.0.0.1:22222/second=/ws',
    ]);
  });

  it('probes fallback ports concurrently so an unresponsive port does not delay other probes', async () => {
    let releaseFirst!: (response: Response) => void;
    const firstResponse = new Promise<Response>(resolve => { releaseFirst = resolve; });
    const fetch = vi.fn()
      .mockReturnValueOnce(firstResponse)
      .mockResolvedValue({ ok: false });
    vi.stubGlobal('fetch', fetch);

    const discovery = discoverVmServiceCandidates({ ports: [8181, 9189, 54321] });
    try {
      expect(fetch).toHaveBeenCalledTimes(3);
    } finally {
      releaseFirst({ ok: false } as Response);
      await discovery;
    }
  });

  it('only announces a changed endpoint while retaining fragmented debug output', () => {
    const output = new VmServiceDebugOutput();
    expect(output.append('The Dart VM Service is listening on ')).toBeUndefined();
    expect(output.append('http://127.0.0.1:22222/current=/\n')).toBe('ws://127.0.0.1:22222/current=/ws');
    expect(output.append('ordinary application log\n')).toBeUndefined();
    output.clear();
    expect(output.text).toBe('');
    expect(output.append('ordinary application log\n')).toBeUndefined();
    expect(output.append('The Dart VM Service is listening on http://127.0.0.1:22222/current=/\n'))
      .toBe('ws://127.0.0.1:22222/current=/ws');
  });

  it('acquires the forwarded endpoint from Dart debugger events even without console output', () => {
    const output = new VmServiceDebugOutput();
    expect(output.accept({ type: 'event', event: 'dart.debuggerUris', body: {
      vmServiceUri: 'http://127.0.0.1:11111/device=/',
      clientVmServiceUri: 'http://127.0.0.1:22222/forwarded=/',
    } })).toBe('ws://127.0.0.1:22222/forwarded=/ws');
    expect(extractVmServiceUrls(output.text)).toEqual(['ws://127.0.0.1:22222/forwarded=/ws']);
    expect(output.accept({ type: 'event', event: 'output', body: { output: 'application log\n' } })).toBeUndefined();
    expect(output.accept(null)).toBeUndefined();
    expect(output.accept({ type: 'response', event: 'dart.debuggerUris', body: { vmServiceUri: 'http://127.0.0.1:11111/' } }))
      .toBeUndefined();
  });

  it('keeps the debugger-provided forwarded endpoint ahead of later device log URLs', async () => {
    const output = new VmServiceDebugOutput();
    output.accept({ type: 'event', event: 'dart.debuggerUris', body: {
      clientVmServiceUri: 'http://127.0.0.1:22222/forwarded=/',
    } });
    expect(output.append('Dart VM Service: http://127.0.0.1:11111/device=/\n')).toBeUndefined();
    const candidates = await discoverVmServiceCandidates({ logText: output.text, ports: [] });
    expect(candidates[0]?.url).toBe('ws://127.0.0.1:22222/forwarded=/ws');
    output.clear();
    expect(output.append('Dart VM Service: http://127.0.0.1:33333/restarted=/\n'))
      .toBe('ws://127.0.0.1:33333/restarted=/ws');
  });

  it('retains an announced endpoint after verbose logs evict its original line', () => {
    const output = new VmServiceDebugOutput();
    output.append('Dart VM Service: http://127.0.0.1:22222/current=/\n');
    expect(output.append('application log\n'.repeat(2000))).toBeUndefined();
    expect(extractVmServiceUrls(output.text)).toEqual(['ws://127.0.0.1:22222/current=/ws']);
  });
});
