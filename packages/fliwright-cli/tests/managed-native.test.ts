import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareNativeRun } from '../src/ManagedNativeRun.js';
import { fingerprintScenario, NativeRuntime, ScenarioResolver } from '@fliwright/core';
import { scenarioApplyCommand } from '../src/commands/scenario.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function setup(enabled = true) {
  const root = await mkdtemp(join(tmpdir(), 'managed-native-')); roots.push(root);
  await writeFile(join(root, 'fliwright.config.ts'), `export default {native:{enabled:${enabled},platform:'android',deviceId:'chosen',targetAppId:'example.app'}};`);
  const delegation = { rootDir: root, key: 'a'.repeat(64), token: 'b'.repeat(64) };
  const owner = { deviceKind: 'simulator' as const, delegate: vi.fn(async () => delegation), dispose: vi.fn(async () => {}), quiesce: vi.fn(async () => {}), quarantine: vi.fn(async () => {}),
    createRuntime: vi.fn(), verifyAppProcess: vi.fn() };
  const openDevice = vi.fn(async () => owner);
  return { root, owner, openDevice, delegation };
}

it('owns the selected device before managed launch and explicitly delegates to the child', async () => {
  const f = await setup();
  const prepared = await prepareNativeRun(f.root, { deviceId: 'chosen' }, { openDevice: f.openDevice });
  expect(f.openDevice).toHaveBeenCalledWith(expect.objectContaining({ deviceId: 'chosen' }), expect.anything());
  expect(prepared?.delegation).toEqual(f.delegation);
  expect(f.owner.createRuntime).not.toHaveBeenCalled();
  await prepared?.dispose();
  expect(f.owner.dispose).toHaveBeenCalledOnce();
});

it('quiesces platform state before reset while retaining the owner until explicit release', async () => {
  const f = await setup();
  const run = await prepareNativeRun(f.root, { deviceId: 'chosen' }, { openDevice: f.openDevice });
  await run!.quiesce();
  await run!.quiesce();
  expect(f.owner.quiesce).toHaveBeenCalledOnce();
  expect(f.owner.dispose).not.toHaveBeenCalled();
  await expect(run!.prepareAttempt({ attemptKey: 'late' }, new AbortController().signal)).rejects.toThrow(/unusable|closed/);
  await run!.dispose();
  expect(f.owner.dispose).toHaveBeenCalledOnce();
});

it('keeps a failed quiescence terminal and preserves its error with final release failure', async () => {
  const f = await setup(), cleanup = new Error('app still running'), release = new Error('release failed');
  f.owner.quiesce.mockRejectedValue(cleanup); f.owner.dispose.mockRejectedValue(release);
  const run = await prepareNativeRun(f.root, { deviceId: 'chosen' }, { openDevice: f.openDevice });
  await expect(run!.quiesce()).rejects.toBe(cleanup);
  await expect(run!.quiesce()).rejects.toBe(cleanup);
  const error = await run!.dispose().catch(error => error);
  expect(error).toBeInstanceOf(AggregateError);
  expect(error.errors).toEqual([cleanup, release]);
  expect(f.owner.quiesce).toHaveBeenCalledOnce();
});

it('does no device work when native is disabled and rejects a different managed device', async () => {
  const f = await setup(false);
  expect(await prepareNativeRun(f.root, { deviceId: 'chosen' }, { openDevice: f.openDevice })).toBeUndefined();
  expect(f.openDevice).not.toHaveBeenCalled();
  const enabled = await setup();
  await expect(prepareNativeRun(enabled.root, { deviceId: 'other' }, { openDevice: enabled.openDevice })).rejects.toMatchObject({ code: 'NATIVE_DEVICE_MISMATCH' });
  expect(enabled.openDevice).not.toHaveBeenCalled();
});

it('releases a failed delegation without hiding its original failure', async () => {
  const f = await setup();
  f.owner.delegate.mockRejectedValue(new Error('grant failed'));
  await expect(prepareNativeRun(f.root, { deviceId: 'chosen' }, { openDevice: f.openDevice })).rejects.toThrow('grant failed');
  expect(f.owner.dispose).toHaveBeenCalledOnce();
});

it('quarantines unconfirmed managed app cleanup and disposes idempotently', async () => {
  const f = await setup();
  const prepared = await prepareNativeRun(f.root, { deviceId: 'chosen' }, { openDevice: f.openDevice });
  await prepared?.dispose({ cleanupConfirmed: false });
  await prepared?.dispose();
  expect(f.owner.quarantine).toHaveBeenCalledOnce();
  expect(f.owner.dispose).toHaveBeenCalledOnce();
});

async function withScenario(layer: object, enabled = true) {
  const f = await setup(enabled);
  await writeFile(join(f.root, 'fliwright.config.ts'), `export default {
    native:{enabled:${enabled},platform:'android',deviceId:'chosen',targetAppId:'example.app'},
    defaultScenario:'selected',scenarios:{selected:{name:'selected',layers:[${JSON.stringify(layer)}]}}
  };`);
  return f;
}

it.each([true, false])('rejects unimplemented device baselines before platform work (native enabled: %s)', async (enabled) => {
  const f = await withScenario({ kind: 'device', permissions: [{ permission: 'camera', state: 'prompt' }] }, enabled);
  await expect(prepareNativeRun(f.root, { deviceId: 'chosen' }, { openDevice: f.openDevice })).rejects.toThrow(/prelaunch/);
  expect(f.openDevice).not.toHaveBeenCalled();
});

it('requires native automation for a selected device scenario before launching', async () => {
  const f = await withScenario({ kind: 'device', requiredCapabilities: ['native.query'] }, false);
  await expect(prepareNativeRun(f.root, { deviceId: 'chosen' }, { openDevice: f.openDevice })).rejects.toThrow(/enable.*native/i);
  expect(f.openDevice).not.toHaveBeenCalled();
});

it.each([true, false])('checks selected capabilities before delegation and closes the preparation Adapter (ready: %s)', async (ready) => {
  const f = await withScenario({ kind: 'device', requiredCapabilities: ['native.query'] });
  const capabilities = vi.fn(async () => ({ 'native.query': { support: 'supported' as const, ready, backend: 'probe' } }));
  const dispose = vi.fn(async () => {});
  f.owner.createRuntime.mockResolvedValue(new NativeRuntime({
    identity: { platform: 'android', deviceId: 'chosen', appId: 'example.app', backend: 'probe', generation: 'prelaunch' },
    capabilities, dispose, snapshot: vi.fn(), screenshot: vi.fn(), execute: vi.fn(),
  }));
  const preparation = prepareNativeRun(f.root, { deviceId: 'chosen' }, { openDevice: f.openDevice });
  if (ready) {
    const run = await preparation;
    expect(dispose.mock.invocationCallOrder[0]).toBeLessThan(f.owner.delegate.mock.invocationCallOrder[0]);
    await run?.dispose();
  } else {
    await expect(preparation).rejects.toThrow(/native.query/);
    expect(f.owner.delegate).not.toHaveBeenCalled();
  }
  expect(capabilities).toHaveBeenCalledOnce();
  expect(dispose).toHaveBeenCalledOnce();
  expect(f.owner.dispose).toHaveBeenCalledOnce();
});

it('allows explicit direct execution to disable a configured device scenario', async () => {
  const f = await withScenario({ kind: 'device', baseline: 'pending-baseline' });
  const run = await prepareNativeRun(f.root, { deviceId: 'chosen', scenario: null }, { openDevice: f.openDevice });
  expect(f.owner.createRuntime).not.toHaveBeenCalled();
  await run?.dispose();
});

it('rejects application-only scenario.apply before connecting a device scenario to the Bridge', async () => {
  const f = await withScenario({ kind: 'device', requiredCapabilities: ['native.query'] });
  const sessionProvider = vi.fn(async () => { throw new Error('unexpected connection'); });
  await expect(scenarioApplyCommand({ cwd: f.root, name: 'selected' }, { sessionProvider })).rejects.toThrow(/device.*prepar/i);
  expect(sessionProvider).not.toHaveBeenCalled();
});

it('rechecks every managed attempt under its retained owner and rejects stale scenario identity before platform work', async () => {
  const f = await withScenario({ kind: 'device', requiredCapabilities: ['native.query'] });
  let ready = true;
  const capabilities = vi.fn(async () => ({ 'native.query': { support: 'supported' as const, ready, backend: 'probe' } }));
  const disposals: ReturnType<typeof vi.fn>[] = [];
  f.owner.createRuntime.mockImplementation(async () => {
    const dispose = vi.fn(async () => {}); disposals.push(dispose);
    return new NativeRuntime({ identity: { platform: 'android', deviceId: 'chosen', appId: 'example.app', backend: 'probe', generation: String(disposals.length) },
      capabilities, dispose, snapshot: vi.fn(), screenshot: vi.fn(), execute: vi.fn() });
  });
  const run = await prepareNativeRun(f.root, { deviceId: 'chosen' }, { openDevice: f.openDevice });
  const scenario = new ScenarioResolver({ selected: { name: 'selected', layers: [{ kind: 'device', requiredCapabilities: ['native.query'] }] } }).resolve('selected');
  const request = { attemptKey: 'first', scenarioName: 'selected', scenarioFingerprint: fingerprintScenario(scenario) };
  try {
    await expect(run!.prepareAttempt!({ ...request, scenarioFingerprint: 'f'.repeat(64) }, new AbortController().signal)).rejects.toThrow(/scenario/i);
    expect(capabilities).toHaveBeenCalledOnce();
    await run!.prepareAttempt!(request, new AbortController().signal);
    await run!.prepareAttempt!({ attemptKey: 'ordinary-peer' }, new AbortController().signal);
    expect(capabilities).toHaveBeenCalledTimes(2);
    ready = false;
    await expect(run!.prepareAttempt!({ ...request, attemptKey: 'retry' }, new AbortController().signal)).rejects.toThrow(/native.query/);
    ready = true;
    await expect(run!.prepareAttempt!({ ...request, attemptKey: 'after-failure' }, new AbortController().signal)).rejects.toThrow(/unusable|failed|unconfirmed/i);
    expect(disposals.every(dispose => dispose.mock.calls.length === 1)).toBe(true);
    expect(f.openDevice).toHaveBeenCalledOnce();
  } finally { await run?.dispose(); }
});
