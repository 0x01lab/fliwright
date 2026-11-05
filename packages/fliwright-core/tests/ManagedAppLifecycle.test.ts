import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { ManagedAppLifecycle, prepareManagedAppAttempt, type ManagedAppAttemptRequest } from '../src/ManagedAppLifecycle.js';
import { prepareScenarioDevice } from '../src/ScenarioDevicePreparation.js';

const request = { attemptKey: 'run/test/attempt-0', scenarioName: 'camera', scenarioFingerprint: 'a'.repeat(64) };
const servers: ManagedAppLifecycle[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.allSettled(servers.splice(0).map(server => server.dispose())); });
async function start(handler: ConstructorParameters<typeof ManagedAppLifecycle>[0]['prepare'], timeoutMs = 1000) {
  const server = new ManagedAppLifecycle({ prepare: handler, timeoutMs, cleanupTimeoutMs: 20 }); servers.push(server);
  const control = await server.start();
  return { server, control };
}

describe('supervised app attempt lifecycle', () => {
  it.each(['unsupported', 'unverified', 'not-ready', 'missing'] as const)('reports a safe native capability diagnostic (%s) without leaking the platform reason', async state => {
    const { control } = await start(async (_request, _signal, reportPhase) => {
      reportPhase('prepare-device');
      const capabilities = async () => state === 'missing' ? {} : {
        'native.fill.unicode': { support: state === 'not-ready' ? 'supported' as const : state,
          ready: state !== 'not-ready', backend: 'test', reason: 'ws://localhost/private-token/ws /private/host secret-value' },
      };
      await prepareScenarioDevice({ name: 'input', layers: [{ kind: 'device', requiredCapabilities: ['native.fill.unicode'] }] }, {
        adapter: { identity: { platform: 'ios', deviceId: 'private-device', appId: 'private-app', backend: 'test', generation: 'g' } },
        device: { capabilities }, preflightCapabilities: capabilities,
      } as Parameters<typeof prepareScenarioDevice>[1], { mode: 'managed-start', attemptId: 'a' });
      return { url: 'ws://localhost/ws' };
    });
    const failure = await prepareManagedAppAttempt(control, request).catch(error => error as Error);
    expect(failure.message).toContain('prepare-device');
    expect(failure.message).toContain('native.fill.unicode');
    expect(failure.message).toContain(state);
    expect(failure.message).not.toMatch(/private-token|private\/host|secret-value|private-device|private-app/);
    const next = await prepareManagedAppAttempt(control, { ...request, attemptKey: 'next' }).catch(error => error as Error);
    expect(next.message).toContain('unusable');
    expect(next.message).toContain('native.fill.unicode');
    expect(next.message).toContain(state);
  });

  it('does not serialize arbitrary capability names from a scenario', async () => {
    const { control } = await start(async (_request, _signal, reportPhase) => {
      reportPhase('prepare-device');
      await prepareScenarioDevice({ name: 'input', layers: [{ kind: 'device', requiredCapabilities: ['private-token'] }] }, {
        adapter: { identity: { platform: 'ios', deviceId: 'private-device', appId: 'private-app', backend: 'test', generation: 'g' } },
        device: { capabilities: async () => ({}) }, preflightCapabilities: async () => ({}),
      } as Parameters<typeof prepareScenarioDevice>[1], { mode: 'managed-start', attemptId: 'a' });
      return { url: 'ws://localhost/ws' };
    });
    const failure = await prepareManagedAppAttempt(control, request).catch(error => error as Error);
    expect(failure.message).toContain('prepare-device');
    expect(failure.message).not.toContain('private-token');
  });

  it('reports only a known preparation phase while retaining the original failure for the supervisor', async () => {
    const original = new Error('ws://127.0.0.1:9100/private-token/ws /private/host/app secret-value');
    const onError = vi.fn();
    const server = new ManagedAppLifecycle({ onError, async prepare(_request, _signal, reportPhase) {
      reportPhase('launch-app');
      throw original;
    } });
    servers.push(server);
    const control = await server.start();
    const failure = await prepareManagedAppAttempt(control, request).then(() => { throw new Error('Expected preparation to fail.'); }, error => error as Error);
    expect(failure.message).toContain('preparation failed during launch-app');
    expect(failure.message).not.toMatch(/private-token|private\/host|secret-value/);
    expect(onError).toHaveBeenCalledExactlyOnceWith(original);
    await expect(prepareManagedAppAttempt(control, { ...request, attemptKey: 'next' })).rejects.toThrow(/unusable/);
  });

  it('retains the active phase when the deadline expires before platform work settles', async () => {
    let complete!: () => void;
    const server = new ManagedAppLifecycle({ timeoutMs: 50, async prepare(_request, _signal, reportPhase) {
      reportPhase('verify-endpoint');
      await new Promise<void>(resolve => { complete = resolve; });
      return { url: 'ws://127.0.0.1:9100/private/ws' };
    } });
    servers.push(server);
    const control = await server.start();
    try {
      await expect(prepareManagedAppAttempt(control, request)).rejects.toThrow('preparation failed during verify-endpoint');
    } finally { complete?.(); }
  });

  it('rejects arbitrary phase text without exposing it to the client', async () => {
    const server = new ManagedAppLifecycle({ async prepare(_request, _signal, reportPhase) {
      reportPhase('launch-app');
      reportPhase('secret-token /private/host' as never);
      return { url: 'ws://127.0.0.1:9100/ws' };
    } });
    servers.push(server);
    const control = await server.start();
    const failure = await prepareManagedAppAttempt(control, request).then(() => { throw new Error('Expected preparation to fail.'); }, error => error as Error);
    expect(failure.message).toContain('preparation failed during launch-app');
    expect(failure.message).not.toMatch(/secret-token|private\/host/);
  });

  const nativeApp = { platform: 'android' as const, deviceKey: 'd'.repeat(64), appId: 'example.app', apkSha256: 'b'.repeat(64), uid: 10123, pid: 42,
    permissions: [], attemptKey: request.attemptKey, scenarioFingerprint: request.scenarioFingerprint, launchGeneration: 'launch-1' };

  it('carries a strictly validated supervisor expectation bound to this request, without treating it as readback', async () => {
    const { control } = await start(async () => ({ url: 'ws://127.0.0.1:9100/ws', nativeApp }));
    expect((await prepareManagedAppAttempt(control, request)).nativeApp).toEqual(nativeApp);
  });

  it.each([{ ...nativeApp, attemptKey: 'other' }, { ...nativeApp, scenarioFingerprint: undefined },
    { ...nativeApp, baselineVerified: true }, { ...nativeApp, apkPath: '/private/app.apk' }])('fences malformed or stale supervisor expectation', async metadata => {
    const { control } = await start(async () => ({ url: 'ws://127.0.0.1:9100/ws', nativeApp: metadata }));
    await expect(prepareManagedAppAttempt(control, request)).rejects.toThrow(/preparation failed/);
    await expect(prepareManagedAppAttempt(control, { ...request, attemptKey: 'next' })).rejects.toThrow(/unusable/);
  });

  it('independently rejects malformed endpoint metadata at the child protocol boundary', async () => {
    const { control } = await start(async () => ({ url: 'ws://127.0.0.1:9100/ws' }));
    const fetch = vi.spyOn(globalThis, 'fetch');
    for (const response of [
      { url: 'ws://127.0.0.1:9100/ws', generation: 'g', nativeApp: { ...nativeApp, pid: '42' } },
      { url: 'ws://127.0.0.1:9100/ws', generation: 'g', nativeApp: { ...nativeApp, attemptKey: 'other' } },
      { url: 'ws://127.0.0.1:9100/ws', generation: 'g', readiness: true },
    ]) {
      fetch.mockResolvedValueOnce(new Response(JSON.stringify(response)));
      await expect(prepareManagedAppAttempt(control, request)).rejects.toThrow();
    }
  });

  it('returns a new endpoint generation per attempt across a real child process', async () => {
    let launches = 0;
    const { control } = await start(async () => ({ url: `ws://127.0.0.1:${9100 + ++launches}/token/ws` }));
    const child = spawn(process.execPath, ['--input-type=module', '--eval', `
      const control=JSON.parse(process.env.TEST_CONTROL);
      const endpoints=[];
      for(let n=0;n<2;n++){
        const response=await fetch(control.url+'/prepare',{method:'POST',headers:{
          authorization:'Bearer '+control.token,'content-type':'application/json'
        },body:JSON.stringify({protocolVersion:1,sessionId:control.sessionId,
          ...${JSON.stringify(request)},attemptKey:'run/test/attempt-'+n})});
        if(!response.ok)throw Error('prepare failed');
        endpoints.push(await response.json());
      }
      process.stdout.write(JSON.stringify(endpoints));
    `], { env: { ...process.env, TEST_CONTROL: JSON.stringify(control) }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', errors = '';
    child.stdout.on('data', chunk => output += chunk); child.stderr.on('data', chunk => errors += chunk);
    expect(await new Promise(resolve => child.once('exit', resolve)), errors).toBe(0);
    const endpoints = JSON.parse(output);
    expect(endpoints.map((item: { url: string }) => item.url)).toEqual(['ws://127.0.0.1:9101/token/ws', 'ws://127.0.0.1:9102/token/ws']);
    expect(endpoints[0].generation).not.toBe(endpoints[1].generation);
    expect(launches).toBe(2);
  });

  it('refuses bad credentials, non-loopback controls and malformed requests before app work', async () => {
    const prepare = vi.fn(async () => ({ url: 'ws://127.0.0.1:9100/ws' }));
    const { control } = await start(prepare);
    await expect(prepareManagedAppAttempt({ ...control, token: 'b'.repeat(64) }, request)).rejects.toThrow();
    await expect(prepareManagedAppAttempt({ ...control, url: 'http://example.com' }, request)).rejects.toThrow(/loopback/i);
    await expect(prepareManagedAppAttempt(control, { ...request, scenarioFingerprint: '../host' })).rejects.toThrow();
    expect(prepare).not.toHaveBeenCalled();
  });

  it('allows attempts without a scenario and rejects incomplete scenario identity at the server boundary', async () => {
    const prepare = vi.fn(async (_request: ManagedAppAttemptRequest) => ({ url: 'ws://127.0.0.1:9100/ws' }));
    const { control } = await start(prepare);
    for (const input of [
      { scenarioName: 'camera' }, { scenarioFingerprint: request.scenarioFingerprint },
      { scenarioName: '', scenarioFingerprint: request.scenarioFingerprint },
      { scenarioName: 'camera', scenarioFingerprint: 'invalid' },
      { scenarioName: null, scenarioFingerprint: null }, { extra: 'unknown' },
    ]) {
      const response = await fetch(`${control.url}/prepare`, { method: 'POST',
        headers: { authorization: `Bearer ${control.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ protocolVersion: 1, sessionId: control.sessionId, attemptKey: 'invalid', ...input }),
      });
      expect(response.status).toBe(400);
      await response.json();
    }
    expect(prepare).not.toHaveBeenCalled();
    await prepareManagedAppAttempt(control, { attemptKey: 'no-scenario' });
    await prepareManagedAppAttempt(control, request);
    expect(prepare.mock.calls.map(call => call[0])).toEqual([
      { attemptKey: 'no-scenario', scenarioName: undefined, scenarioFingerprint: undefined }, request,
    ]);
  });

  it('never replays a duplicate attempt or a failed preparation', async () => {
    const prepare = vi.fn(async () => ({ url: 'ws://127.0.0.1:9100/ws' }));
    const { control } = await start(prepare);
    await prepareManagedAppAttempt(control, request);
    await expect(prepareManagedAppAttempt(control, request)).rejects.toThrow(/already/i);
    expect(prepare).toHaveBeenCalledOnce();
    prepare.mockRejectedValueOnce(new Error('stop outcome unknown'));
    await expect(prepareManagedAppAttempt(control, { ...request, attemptKey: 'second' })).rejects.toThrow(/preparation failed/i);
    await expect(prepareManagedAppAttempt(control, { ...request, attemptKey: 'third' })).rejects.toThrow(/unusable/i);
    expect(prepare).toHaveBeenCalledTimes(2);
  });

  it('rejects competing requests, bounds preparation and prevents further app work after timeout', async () => {
    const signals: AbortSignal[] = [];
    const { control } = await start(async (_request, signal) => {
      signals.push(signal); return new Promise(() => {});
    }, 50);
    const first = prepareManagedAppAttempt(control, request);
    while (!signals.length) await new Promise(resolve => setTimeout(resolve, 1));
    await expect(prepareManagedAppAttempt(control, { ...request, attemptKey: 'concurrent' })).rejects.toThrow(/busy/i);
    await expect(first).rejects.toThrow(/preparation failed/i);
    expect(signals[0].aborted).toBe(true);
    await expect(prepareManagedAppAttempt(control, { ...request, attemptKey: 'later' })).rejects.toThrow(/unusable/i);
    expect(signals).toHaveLength(1);
  });

  it('cancels a disconnected client and does not report clean disposal while work remains', async () => {
    let entered!: () => void;
    const ready = new Promise<void>(resolve => entered = resolve);
    const { server, control } = await start(async () => { entered(); return new Promise(() => {}); });
    const abort = new AbortController();
    const pending = prepareManagedAppAttempt(control, request, { signal: abort.signal });
    await ready; abort.abort(new Error('caller cancelled'));
    await expect(pending).rejects.toThrow();
    await expect(server.dispose()).rejects.toThrow(/cleanup.*confirmed/i);
    servers.splice(servers.indexOf(server), 1);
  });
});
