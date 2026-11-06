import { expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { RunnerTestCase } from 'vitest';
import type { NativeDeviceSession } from '@fliwright/native';
import { NativeRuntime, fingerprintScenario, type TestScenario, type RunSession } from '@fliwright/core';
import { setAttemptContext, type AttemptContext } from '../src/AttemptContext.js';
import { prepareTaskNativeSession, taskNativeRuntime, verifyTaskNativeBinding, releaseTaskNativeSession } from '../src/TaskNativeSession.js';

it.each(['match', 'mismatch', 'changed'] as const)('checks the actual resolved scenario rather than trusting matching owner/platform states (%s)', async fault => {
  const task = { id: 'test', context: { signal: new AbortController().signal } } as RunnerTestCase;
  const scenario: TestScenario = { name: 'camera', layers: [{ kind: 'device', permissions: [{ permission: 'camera', state: fault === 'mismatch' ? 'granted' : 'prompt' }] }] };
  const observation = { platform: 'android' as const, deviceKey: createHash('sha256').update('android\0owned').digest('hex'),
    appId: 'example.app', apkSha256: 'b'.repeat(64), uid: 10123, pid: 42,
    permissions: [{ permission: 'camera' as const, granted: false, userSet: false, userFixed: false, flags: [] }] };
  const recorder = { startNode: vi.fn(() => ({ id: 'node' })), passNode: vi.fn(), failNode: vi.fn() };
  const attempt = { runId: 'run', attemptId: '0', recorder, managedApp: { url: 'ws://127.0.0.1:9100/ws', generation: 'managed-1',
    nativeApp: { ...observation, attemptKey: 'run/test/0', scenarioFingerprint: fingerprintScenario(scenario), launchGeneration: 'launch-1' } },
  } as unknown as AttemptContext;
  setAttemptContext(task, attempt);
  const inspectAppState = vi.fn(async () => {
    if (fault === 'changed') scenario.layers = [{ kind: 'device', permissions: [{ permission: 'camera', state: 'granted' }] }];
    return observation;
  }), dispose = vi.fn(async () => {});
  const owner = { inspectAppState, verifyAppProcess: vi.fn(async () => {}), dispose,
    createRuntime: async () => new NativeRuntime({
      identity: { platform: 'android', deviceId: 'owned', appId: 'example.app', backend: 'adb', generation: 'adapter-1' },
      capabilities: async () => ({}), snapshot: vi.fn(), execute: vi.fn(), screenshot: vi.fn(), dispose: vi.fn(),
    }),
  } as unknown as NativeDeviceSession;
  try {
    await prepareTaskNativeSession(task, { enabled: true, platform: 'android', deviceId: 'owned', targetAppId: 'example.app' }, task.context.signal, async () => owner);
    await taskNativeRuntime(task, {} as RunSession, '0');
    const verification = verifyTaskNativeBinding(task, { sendRequest: async () => ({ pid: 42 }) }, '0', scenario);
    if (fault !== 'match') {
      await expect(verification).rejects.toThrow(/declaration/);
      expect(inspectAppState).toHaveBeenCalledTimes(fault === 'mismatch' ? 0 : 1);
      expect(attempt.androidReadback).toBeUndefined();
      expect(recorder.failNode).toHaveBeenCalledOnce();
    } else {
      await verification;
      expect(inspectAppState).toHaveBeenCalledWith(['camera'], expect.objectContaining({ signal: expect.any(AbortSignal) }));
      expect(attempt.androidReadback).toMatchObject({ coverage: 'platform-readback', scenarioFingerprint: fingerprintScenario(scenario) });
      expect(recorder.passNode).toHaveBeenCalledOnce();
    }
  } finally { await releaseTaskNativeSession(task); }
  expect(dispose).toHaveBeenCalledOnce();
});
