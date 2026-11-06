import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { prepareManagedAppAttempt } from '@fliwright/core';
import type { NativeDeviceSession } from '@fliwright/native';
import { prepareNativeRun } from '../src/ManagedNativeRun.js';
import type { withFlutterAndroidApk } from '../src/FlutterAndroidBuild.js';
import type { ManagedNativePhaseEvent, ManagedNativePhaseObserver } from '../src/ManagedNativeTelemetry.js';

const roots: string[] = [];
const runs: Array<{ dispose(): Promise<void> }> = [];
afterEach(async () => {
  await Promise.allSettled(runs.splice(0).map(run => run.dispose()));
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});
async function fixture(kind: 'physical' | 'simulator' = 'simulator') {
  const root = await mkdtemp(join(tmpdir(), 'managed-installed-')); roots.push(root);
  await writeFile(join(root, 'fliwright.config.ts'), `export default {native:{enabled:true,platform:'android',deviceId:'chosen',targetAppId:'example.app',tools:{apkAnalyzer:'owned-analyzer'}}};`);
  const events: string[] = [], sha256 = 'a'.repeat(64);
  let generation = 0;
  const owner = {
    deviceKind: kind, delegate: vi.fn(async () => ({ rootDir: root, key: 'b'.repeat(64), token: 'c'.repeat(64) })),
    installApp: vi.fn(async () => { events.push('install'); return { sha256, appId: 'example.app', uid: 10123, permissions: [] as string[] }; }),
    preparePermissions: vi.fn(async () => { events.push('permissions'); return []; }),
    stopApp: vi.fn(async () => { events.push('stop'); }),
    launchApp: vi.fn(async () => { events.push('launch'); return { url: `ws://127.0.0.1:1234/auth-${++generation}=/ws`, pid: 40 + generation, generation: String(generation) }; }),
    verifyAppProcess: vi.fn(async (_pid: unknown) => { events.push('bind'); }), createRuntime: vi.fn(), quarantine: vi.fn(async () => {}),
    quiesce: vi.fn(async () => { events.push('quiesce'); }), dispose: vi.fn(async () => { events.push('release'); }),
  };
  const build = vi.fn<typeof withFlutterAndroidApk>(async (options, consume) => {
    options.signal?.throwIfAborted(); events.push('build');
    return consume({ apkPath: '/private/app.apk', sha256, bytes: 100, projectDirectory: root, target: 'lib/main.dart' });
  });
  const verifyEndpoint = vi.fn(async (_url: string, pid: number) => { events.push('verify'); return pid; });
  const openDevice = vi.fn(async () => owner as unknown as NativeDeviceSession);
  const launch = { target: 'lib/native.dart', flutterBin: '/owned/flutter', flutterArgs: ['--flavor=qa'], requiredCapabilities: ['snap'] };
  const open = async (onPhase?: ManagedNativePhaseObserver, onError?: (error: unknown) => void) => {
    const run = await prepareNativeRun(root, { deviceId: 'chosen', launch }, { openDevice, buildAndroid: build as typeof withFlutterAndroidApk, verifyEndpoint, onPhase, onError });
    if (run) runs.push(run);
    return run!;
  };
  return { root, owner, openDevice, build, verifyEndpoint, launch, events, open };
}

it('builds and installs only on the first actual attempt, then relaunches the same installed bytes with fresh endpoints', async () => {
  const f = await fixture(), originalArgs = [...f.launch.flutterArgs];
  const opening = f.open();
  f.launch.target = 'changed.dart'; f.launch.flutterArgs.push('--release');
  const run = await opening;
  expect(run.managedAppControl).toMatchObject({ timeoutMs: 600000 });
  expect(f.events).toEqual([]);
  const first = await prepareManagedAppAttempt(run.managedAppControl!, { attemptKey: 'first' });
  const retry = await prepareManagedAppAttempt(run.managedAppControl!, { attemptKey: 'retry' });
  expect(first.generation).not.toBe(retry.generation); expect(first.url).not.toBe(retry.url);
  expect(f.events).toEqual(['build', 'install', 'stop', 'permissions', 'launch', 'verify', 'bind', 'stop', 'permissions', 'launch', 'verify', 'bind']);
  expect(first.nativeApp).toMatchObject({ appId: 'example.app', apkSha256: 'a'.repeat(64), uid: 10123, pid: 41, attemptKey: 'first', launchGeneration: '1', permissions: [] });
  expect(retry.nativeApp).toMatchObject({ pid: 42, attemptKey: 'retry', launchGeneration: '2' });
  expect(f.owner.preparePermissions).toHaveBeenCalledWith([], expect.objectContaining({ mode: 'managed-start' }));
  expect(JSON.stringify(first.nativeApp)).not.toMatch(/chosen|private|apkPath|auth-/);
  expect(f.build).toHaveBeenCalledOnce(); expect(f.owner.installApp).toHaveBeenCalledOnce();
  expect(f.build).toHaveBeenCalledWith(expect.objectContaining({ projectRoot: f.root, target: 'lib/native.dart', flutterBin: '/owned/flutter', flutterArgs: originalArgs }), expect.any(Function));
  expect(f.owner.installApp).toHaveBeenCalledWith({ apkPath: '/private/app.apk', apkAnalyzerPath: 'owned-analyzer' }, expect.objectContaining({ mode: 'managed-start', signal: expect.any(AbortSignal) }));
  expect(f.owner.verifyAppProcess.mock.calls.map(args => args[0])).toEqual([41, 42]);
  await run.quiesce();
  expect(f.events.at(-1)).toBe('quiesce'); expect(f.owner.dispose).not.toHaveBeenCalled();
  await expect(prepareManagedAppAttempt(run.managedAppControl!, { attemptKey: 'late' })).rejects.toThrow();
  await run.dispose(); expect(f.events.at(-1)).toBe('release');
});

it('records actual retained owner phases and closes build at staged handoff before installation, with fresh attempt correlation', async () => {
  const f = await fixture(), events: ManagedNativePhaseEvent[] = [];
  let lifecycleError: unknown;
  f.owner.installApp.mockImplementation(async () => {
    expect(events.at(-1)).toMatchObject({ type: 'started', phase: 'native.install' });
    expect(events.filter(event => event.type === 'finished' && event.phase === 'native.build')).toHaveLength(1);
    return { sha256: 'a'.repeat(64), appId: 'example.app', uid: 10123, permissions: [] };
  });
  const run = await f.open(event => { events.push(event); }, error => { lifecycleError = error; });
  expect(events.filter(event => event.type === 'started').map(event => event.phase)).toEqual(['native.acquire']);
  const firstError = await prepareManagedAppAttempt(run.managedAppControl!, { attemptKey: 'first-private-test' }).then(() => undefined, error => error);
  expect(lifecycleError, String(firstError)).toBeUndefined();
  if (firstError) throw firstError;
  await prepareManagedAppAttempt(run.managedAppControl!, { attemptKey: 'retry-private-test' });
  expect(lifecycleError).toBeUndefined();
  await run.quiesce(); await run.dispose(); await run.dispose();
  const phases = events.filter(event => event.type === 'started').map(event => event.phase);
  expect(phases).toEqual(['native.acquire', 'native.build', 'native.install', 'native.stop', 'native.prepare', 'native.prepare', 'native.launch', 'native.verify',
    'native.stop', 'native.prepare', 'native.prepare', 'native.launch', 'native.verify', 'native.cleanup', 'native.cleanup', 'native.release']);
  for (const event of events.filter(event => event.type === 'started')) {
    expect(events.filter(other => other.type === 'finished' && other.id === event.id)).toEqual([
      expect.objectContaining({ phase: event.phase, status: 'succeeded' }),
    ]);
  }
  for (const [attemptKey, expected] of [['first-private-test', ['native.build', 'native.install', 'native.stop', 'native.prepare', 'native.prepare', 'native.launch', 'native.verify']],
    ['retry-private-test', ['native.stop', 'native.prepare', 'native.prepare', 'native.launch', 'native.verify']]] as const) {
    const attemptKeyHash = createHash('sha256').update(attemptKey).digest('hex');
    expect(events.filter(event => event.type === 'started' && event.attemptKeyHash === attemptKeyHash).map(event => event.phase)).toEqual(expected);
  }
  expect(JSON.stringify(events)).not.toMatch(/private-test|chosen|private\/app|auth-|owned\/flutter/);
});

it.each(['build', 'install', 'stop', 'permissions', 'launch', 'verify', 'hash'] as const)('fences all later writes after %s failure without falling back to Flutter launch', async failure => {
  const f = await fixture();
  if (failure === 'build') f.build.mockRejectedValue(new Error('build failed'));
  if (failure === 'install') f.owner.installApp.mockRejectedValue(new Error('install failed'));
  if (failure === 'stop') f.owner.stopApp.mockRejectedValue(new Error('stop failed'));
  if (failure === 'permissions') f.owner.preparePermissions.mockRejectedValue(new Error('permission preparation failed'));
  if (failure === 'launch') f.owner.launchApp.mockRejectedValue(new Error('launch failed'));
  if (failure === 'verify') f.verifyEndpoint.mockRejectedValue(new Error('VM mismatch'));
  if (failure === 'hash') f.owner.installApp.mockResolvedValue({ sha256: 'd'.repeat(64), appId: 'example.app', uid: 10123, permissions: [] });
  const run = await f.open();
  const phases = { build: 'build-app', install: 'install-app', stop: 'stop-app', permissions: 'prepare-device', launch: 'launch-app', verify: 'verify-endpoint', hash: 'install-app' };
  await expect(prepareManagedAppAttempt(run.managedAppControl!, { attemptKey: 'first' })).rejects.toThrow(`preparation failed during ${phases[failure]}`);
  await expect(prepareManagedAppAttempt(run.managedAppControl!, { attemptKey: 'retry' })).rejects.toThrow();
  expect(f.build).toHaveBeenCalledOnce();
  expect(f.owner.launchApp).toHaveBeenCalledTimes(failure === 'verify' || failure === 'launch' ? 1 : 0);
  expect(f.owner.verifyAppProcess).not.toHaveBeenCalled();
  await run.dispose(); expect(f.owner.quiesce).toHaveBeenCalledOnce();
});

it('cancels and awaits a supervised build before closing platform state or allowing reset', async () => {
  const f = await fixture(); let entered!: () => void, finish!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { finish = resolve; });
  f.build.mockImplementation(async (options) => {
    entered();
    await new Promise<void>(resolve => options.signal!.addEventListener('abort', () => { f.events.push('cancel'); resolve(); }, { once: true }));
    await gate; f.events.push('build-ended'); throw new Error('cancelled build');
  });
  const run = await f.open();
  const attempt = prepareManagedAppAttempt(run.managedAppControl!, { attemptKey: 'first' }).catch(() => undefined);
  await ready;
  const closing = run.quiesce();
  await vi.waitFor(() => expect(f.events).toContain('cancel'));
  expect(f.owner.quiesce).not.toHaveBeenCalled();
  finish(); await closing; await attempt;
  expect(f.events).toEqual(['cancel', 'build-ended', 'quiesce']);
  expect(f.owner.installApp).not.toHaveBeenCalled();
});

it('keeps physical Android on its existing launcher and rejects installed-session keepalive before device mutation', async () => {
  const physical = await fixture('physical'), run = await physical.open();
  expect(run.managedAppControl).toBeUndefined(); expect(physical.build).not.toHaveBeenCalled();
  const f = await fixture();
  await expect(prepareNativeRun(f.root, { deviceId: 'chosen', launch: { ...f.launch, keepAppAlive: true } }, { openDevice: f.openDevice, buildAndroid: f.build as typeof withFlutterAndroidApk })).rejects.toThrow(/keep.*alive/i);
  expect(f.owner.installApp).not.toHaveBeenCalled(); expect(f.owner.dispose).toHaveBeenCalledOnce();
});

it('retains a host cleanup failure and prevents successful quiescence even when no APK was installed', async () => {
  const f = await fixture();
  const { FlutterBuildError } = await import('../src/FlutterBuildProcess.js');
  f.build.mockRejectedValue(new FlutterBuildError('BUILD_CLEANUP_UNCONFIRMED', 'unconfirmed build group', false));
  const run = await f.open();
  await expect(prepareManagedAppAttempt(run.managedAppControl!, { attemptKey: 'first' })).rejects.toThrow();
  await expect(run.quiesce()).rejects.toThrow('unconfirmed build group');
  expect(f.owner.quarantine).toHaveBeenCalledOnce();
  await expect(run.dispose()).rejects.toThrow('unconfirmed build group');
  expect(f.owner.installApp).not.toHaveBeenCalled();
});
