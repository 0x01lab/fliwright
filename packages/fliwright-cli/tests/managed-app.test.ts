import { expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fingerprintScenario, prepareManagedAppAttempt, ScenarioResolver } from '@fliwright/core';
import { startManagedAppControl } from '../src/ManagedAppRun.js';

it.each(['stop-app', 'prepare-device', 'launch-app', 'verify-endpoint'] as const)('identifies %s failures without exposing platform errors or replaying writes', async phase => {
  const root = await mkdtemp(join(tmpdir(), 'managed-phase-'));
  const original = new Error('private-token ws://localhost/secret/ws /private/host');
  const onError = vi.fn();
  const stop = vi.fn(async () => { if (phase === 'stop-app') throw original; });
  const prepareDevice = vi.fn(async () => { if (phase === 'prepare-device') throw original; });
  const launch = vi.fn(async (_signal, _request, reportPhase) => {
    if (phase === 'verify-endpoint') reportPhase('verify-endpoint');
    throw original;
  });
  const managed = await startManagedAppControl(root, { stop, prepareDevice, launch, onError });
  try {
    await expect(prepareManagedAppAttempt(managed.control, { attemptKey: 'first' })).rejects.toThrow(`preparation failed during ${phase}`);
    expect(onError).toHaveBeenCalledExactlyOnceWith(original);
    await expect(prepareManagedAppAttempt(managed.control, { attemptKey: 'retry' })).rejects.toThrow(/unusable/);
    expect(stop).toHaveBeenCalledOnce();
    expect(launch).toHaveBeenCalledTimes(phase === 'launch-app' || phase === 'verify-endpoint' ? 1 : 0);
  } finally { await managed.dispose(); await rm(root, { recursive: true, force: true }); }
});

it('validates the frozen scenario before stopping, then performs stop and verified launch for every attempt', async () => {
  const root = await mkdtemp(join(tmpdir(), 'managed-app-'));
  const scenario = { name: 'system', layers: [{ kind: 'device' as const, requiredCapabilities: ['native.query'] }] };
  await writeFile(join(root, 'fliwright.config.ts'), `export default {scenarios:{system:${JSON.stringify(scenario)}}};`);
  const calls: string[] = [];
  const stop = vi.fn(async () => { calls.push('stop'); });
  const launch = vi.fn(async () => { calls.push('launch-and-verify'); return { url: 'ws://127.0.0.1:9123/fresh/ws' }; });
  const managed = await startManagedAppControl(root, { stop, launch });
  try {
    const request = { scenarioName: 'system', scenarioFingerprint: fingerprintScenario(new ScenarioResolver({ system: scenario }).resolve('system')), attemptKey: 'first' };
    const first = await prepareManagedAppAttempt(managed.control, request);
    const second = await prepareManagedAppAttempt(managed.control, { ...request, attemptKey: 'retry' });
    expect(first.url).toBe('ws://127.0.0.1:9123/fresh/ws');
    expect(first.generation).not.toBe(second.generation);
    expect(calls).toEqual(['stop', 'launch-and-verify', 'stop', 'launch-and-verify']);
    await expect(prepareManagedAppAttempt(managed.control, { ...request, attemptKey: 'invalid', scenarioFingerprint: 'f'.repeat(64) })).rejects.toThrow();
    expect(stop).toHaveBeenCalledTimes(2);
  } finally { await managed.dispose(); await rm(root, { recursive: true, force: true }); }
});

it('does not launch after stop fails or after cancellation during stop', async () => {
  for (const canceled of [false, true]) {
    const root = await mkdtemp(join(tmpdir(), 'managed-app-'));
    const scenario = { name: 'system', layers: [{ kind: 'device' as const }] };
    await writeFile(join(root, 'fliwright.config.ts'), `export default {scenarios:{system:${JSON.stringify(scenario)}}};`);
    const controller = new AbortController();
    const launch = vi.fn(async () => ({ url: 'ws://127.0.0.1:9123/ws' }));
    const managed = await startManagedAppControl(root, { signal: controller.signal, launch,
      stop: async () => { if (canceled) controller.abort(); else throw Error('stop failed'); } });
    try {
      await expect(prepareManagedAppAttempt(managed.control, {
        scenarioName: 'system', scenarioFingerprint: fingerprintScenario(new ScenarioResolver({ system: scenario }).resolve('system')), attemptKey: 'first',
      })).rejects.toThrow();
      expect(launch).not.toHaveBeenCalled();
    } finally { await managed.dispose(); await rm(root, { recursive: true, force: true }); }
  }
});

it('prepares the retained device after stop and before launch, including attempts without a scenario', async () => {
  const root = await mkdtemp(join(tmpdir(), 'managed-app-device-'));
  const calls: string[] = [];
  const prepareDevice = vi.fn(async (request: { attemptKey: string }, signal: AbortSignal) => {
    signal.throwIfAborted(); calls.push(`prepare:${request.attemptKey}`);
  });
  const managed = await startManagedAppControl(root, {
    stop: async () => { calls.push('stop'); }, prepareDevice,
    launch: async () => { calls.push('launch'); return { url: 'ws://127.0.0.1:9123/ws' }; },
  });
  try {
    await prepareManagedAppAttempt(managed.control, { attemptKey: 'first' });
    await prepareManagedAppAttempt(managed.control, { attemptKey: 'retry' });
    expect(calls).toEqual(['stop', 'prepare:first', 'launch', 'stop', 'prepare:retry', 'launch']);
  } finally { await managed.dispose(); await rm(root, { recursive: true, force: true }); }
});

it.each([false, true])('fences relaunch when retained device preparation fails or is cancelled (cancel: %s)', async canceled => {
  const root = await mkdtemp(join(tmpdir(), 'managed-app-device-fail-'));
  const launch = vi.fn(async () => ({ url: 'ws://127.0.0.1:9123/ws' }));
  const controller = new AbortController();
  const prepareDevice = vi.fn(async () => {
    if (canceled) { controller.abort(); return; }
    throw new Error('device preparation failed');
  });
  const managed = await startManagedAppControl(root, { signal: controller.signal, stop: async () => {}, prepareDevice, launch });
  try {
    await expect(prepareManagedAppAttempt(managed.control, { attemptKey: 'first' })).rejects.toThrow();
    await expect(prepareManagedAppAttempt(managed.control, { attemptKey: 'second' })).rejects.toThrow();
    expect(prepareDevice).toHaveBeenCalledOnce();
    expect(launch).not.toHaveBeenCalled();
  } finally { await managed.dispose(); await rm(root, { recursive: true, force: true }); }
});

it('passes the fingerprint-validated frozen inherited scene to preparation and refuses unreleased permissions before stop', async () => {
  const root = await mkdtemp(join(tmpdir(), 'managed-frozen-declaration-'));
  const scenarios = {
    base: { name: 'base', layers: [{ kind: 'device' as const, requiredCapabilities: ['native.query'] }] },
    child: { name: 'child', extends: ['base'], layers: [] },
    denied: { name: 'denied', layers: [{ kind: 'device' as const, permissions: [{ permission: 'camera', state: 'denied' as const }] }] },
  };
  await writeFile(join(root, 'fliwright.config.ts'), `export default {scenarios:${JSON.stringify(scenarios)}};`);
  const stop = vi.fn(async () => {}), prepareDevice = vi.fn(async (_request, _signal, _scenario) => {});
  const managed = await startManagedAppControl(root, { stop, prepareDevice, launch: async () => ({ url: 'ws://127.0.0.1:9123/ws' }) });
  try {
    const resolved = new ScenarioResolver(scenarios);
    await writeFile(join(root, 'fliwright.config.ts'), 'export default {scenarios:{}};');
    await prepareManagedAppAttempt(managed.control, { attemptKey: 'first', scenarioName: 'child', scenarioFingerprint: fingerprintScenario(resolved.resolve('child')) });
    expect(prepareDevice).toHaveBeenCalledWith(expect.objectContaining({ attemptKey: 'first' }), expect.any(AbortSignal), resolved.resolve('child'));
    await expect(prepareManagedAppAttempt(managed.control, { attemptKey: 'denied', scenarioName: 'denied', scenarioFingerprint: fingerprintScenario(resolved.resolve('denied')) })).rejects.toThrow();
    expect(stop).toHaveBeenCalledOnce();
    expect(prepareDevice).toHaveBeenCalledOnce();
  } finally { await managed.dispose(); await rm(root, { recursive: true, force: true }); }
});
