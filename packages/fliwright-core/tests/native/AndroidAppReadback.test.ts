import { expect, it, vi } from 'vitest';
import { createAndroidAppReadback, parseAndroidAppExpectation } from '../../src/native/AndroidAppReadback.js';
import type { NativeIdentity } from '../../src/native/types.js';
import { createHash } from 'node:crypto';

const identity: NativeIdentity = { platform: 'android', deviceId: 'owned', appId: 'example.app', backend: 'adb', generation: 'adapter-1' };
const context = { attemptKey: 'run/task/attempt-0', attemptId: 'attempt-0', managedAppGeneration: 'managed-1', scenarioFingerprint: 'a'.repeat(64) };
const observation = { platform: 'android' as const, deviceKey: createHash('sha256').update('android\0owned').digest('hex'), appId: 'example.app',
  apkSha256: 'b'.repeat(64), uid: 10123, pid: 42, permissions: [{ permission: 'camera' as const, granted: false, userSet: false, userFixed: false, flags: [] as string[] }] };
const expected = { ...structuredClone(observation), attemptKey: context.attemptKey, scenarioFingerprint: context.scenarioFingerprint, launchGeneration: 'launch-1' };

it('consumes an independent live read once, bound to attempt, scenario, installation, process and Adapter generation', async () => {
  const read = vi.fn(async () => structuredClone(observation));
  const handle = createAndroidAppReadback(expected, { ...context, identity }, read);
  expect(read).not.toHaveBeenCalled();
  expected.permissions[0].granted = true;
  try {
    const report = await handle.consume({ ...context, identity: { ...identity } });
    expect(report).toMatchObject({ ...context, ...observation, adapterGeneration: 'adapter-1', launchGeneration: 'launch-1', coverage: 'platform-readback' });
    expect(report.permissions[0].granted).toBe(false);
    expect(read).toHaveBeenCalledOnce();
    await expect(handle.consume({ ...context, identity })).rejects.toThrow(/consumed/);
    expect(JSON.stringify(report)).not.toContain('owned');
    expect(JSON.stringify(report)).not.toMatch(/auth=|127\.0\.0\.1|apkPath/);
  } finally { expected.permissions[0].granted = false; }
});

it.each(['attemptKey', 'attemptId', 'managedAppGeneration', 'scenarioFingerprint', 'generation', 'deviceId'] as const)('rejects a changed %s context before reading platform state', async field => {
  const read = vi.fn(async () => observation);
  const handle = createAndroidAppReadback(expected, { ...context, identity }, read);
  const current = { ...context, identity: { ...identity } };
  if (field === 'generation' || field === 'deviceId') current.identity[field] = 'other';
  else current[field] = 'other';
  await expect(handle.consume(current)).rejects.toThrow(/identity|context/);
  expect(read).not.toHaveBeenCalled();
  await expect(handle.consume({ ...context, identity })).rejects.toThrow(/consumed/);
});

it.each(['deviceKey', 'appId', 'apkSha256', 'uid', 'pid', 'permissions'] as const)('rejects independently observed %s mismatches without producing a receipt', async field => {
  const actual = structuredClone(observation);
  if (field === 'permissions') { actual.permissions[0].userSet = true; actual.permissions[0].flags = ['USER_SET']; }
  else if (field === 'uid' || field === 'pid') actual[field]++;
  else actual[field] = field === 'deviceKey' || field === 'apkSha256' ? 'c'.repeat(64) : 'other.app';
  const handle = createAndroidAppReadback(expected, { ...context, identity }, async () => actual);
  await expect(handle.consume({ ...context, identity })).rejects.toThrow(/readback|match/);
});

it('checks cancellation and identity again after an asynchronous read and never reuses a failed receipt', async () => {
  const controller = new AbortController(), current = { ...identity };
  const read = vi.fn(async () => { current.generation = 'adapter-2'; return observation; });
  const handle = createAndroidAppReadback(expected, { ...context, identity: current, signal: controller.signal }, read);
  await expect(handle.consume({ ...context, identity: current })).rejects.toThrow(/identity/);
  const cancelled = createAndroidAppReadback(expected, { ...context, identity }, async () => { controller.abort(); return observation; }, controller.signal);
  await expect(cancelled.consume({ ...context, identity })).rejects.toThrow();
});

it('bounds consumption by cancellation even when platform readback has not settled', async () => {
  const abort = new AbortController();
  let started!: () => void, finish!: (value: typeof observation) => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const pending = new Promise<typeof observation>(resolve => { finish = resolve; });
  const handle = createAndroidAppReadback(expected, { ...context, identity }, async () => { started(); return pending; }, abort.signal);
  const consumption = handle.consume({ ...context, identity });
  const failure = expect(consumption).rejects.toThrow('cancelled');
  await ready; abort.abort(Error('cancelled')); await failure;
  finish(observation);
  await expect(handle.consume({ ...context, identity })).rejects.toThrow(/consumed/);
});

it('validates metadata strictly, including flags and a complete permission set, without accepting paths or self-certified readiness', () => {
  expect(parseAndroidAppExpectation(expected, context)).toEqual(expected);
  for (const malformed of [
    { ...expected, attemptKey: 'other' }, { ...expected, scenarioFingerprint: undefined },
    { ...expected, pid: '42' }, { ...expected, uid: 1000 }, { ...expected, apkSha256: 'invalid' },
    { ...expected, baselineVerified: true }, { ...expected, apkPath: '/private/app.apk' },
    { ...expected, permissions: [observation.permissions[0], observation.permissions[0]] },
    { ...expected, permissions: new Array(1) },
    { ...expected, permissions: [{ ...observation.permissions[0], userSet: true }] },
    { ...expected, permissions: [{ ...observation.permissions[0], flags: new Array(1) }] },
    { ...expected, permissions: [{ ...observation.permissions[0], flags: ['SYSTEM_FIXED'] }] },
  ]) expect(() => parseAndroidAppExpectation(malformed, context)).toThrow();
});

it('rejects matching owner and platform states that contradict the independently supplied scenario declaration', async () => {
  const read = vi.fn(async () => structuredClone(observation));
  const current = { ...context, identity, permissionDeclaration: [{ permission: 'camera' as const, state: 'granted' as const }] };
  const handle = createAndroidAppReadback(expected, current, read);
  await expect(handle.consume(current)).rejects.toThrow(/declaration/);
  expect(read).not.toHaveBeenCalled();
});

it('rejects declaration changes while an independent platform read is pending', async () => {
  const current = { ...context, identity, permissionDeclaration: [{ permission: 'camera' as const, state: 'prompt' as 'prompt' | 'granted' }] };
  const handle = createAndroidAppReadback(expected, current, async () => {
    current.permissionDeclaration[0].state = 'granted';
    return structuredClone(observation);
  });
  await expect(handle.consume(current)).rejects.toThrow(/declaration/);
});
