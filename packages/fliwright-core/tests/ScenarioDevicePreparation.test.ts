import { writeFliwrightConfigSnapshot } from '@fliwright/core';
import { describe, expect, it, vi } from 'vitest';
import { fliwrightConfigSchema, readFliwrightEnvironment } from '../src/RecordingConfig.js';
import { fingerprintScenario, ScenarioCoordinator, ScenarioResolver, type TestScenario } from '../src/Scenario.js';
import * as devicePreparation from '../src/index.js';
import type { NativeRuntime } from '../src/native/NativeRuntime.js';

function runtimeProbe() {
  const identity = { platform: 'android' as const, deviceId: 'owned-device', appId: 'example.app', backend: 'probe', generation: 'generation-1' };
  const capabilities = vi.fn(async () => ({ 'native.query': { support: 'supported' as const, ready: true, backend: 'probe' } }));
  const device = { capabilities };
  return { adapter: { identity }, device, preflightCapabilities: () => device.capabilities() } as Pick<NativeRuntime, 'adapter' | 'device' | 'preflightCapabilities'>;
}
const requirements: TestScenario = { name: 'native-ui', layers: [{ kind: 'device', requiredCapabilities: ['native.query'] }] };

const declaration = {
  name: 'camera-permission',
  layers: [{ kind: 'device', requiredCapabilities: ['native.query'],
    permissions: [{ permission: 'camera', state: 'prompt' }], baseline: 'clean-camera',
    biometricBaseline: 'fingerprint-enrolled', media: [{ kind: 'image', fixtureId: 'portrait' }],
    cameraSource: { back: { kind: 'image', fixtureId: 'portrait' } },
  }],
};

describe('device scenario declarations', () => {
  it('preserves portable device declarations through strict config and environment transport', () => {
    const config = { scenarios: { camera: declaration } };
    expect(fliwrightConfigSchema.parse(config)).toEqual(config);
    expect(readFliwrightEnvironment({ FLIWRIGHT_CONFIG_PATH: writeFliwrightConfigSnapshot(config) })).toEqual(config);
  });

  it.each([
    { baseline: '/host/baseline' }, { biometricBaseline: '../enrolled' },
    { media: [{ kind: 'image', fixtureId: 'file:///host/photo.jpg' }] },
    { cameraSource: { back: { kind: 'image', fixtureId: '/host/photo.jpg' } } },
    { permissions: [{ permission: 'camera', state: 'permanently-denied' }] },
    { permissions: [{ permission: 'camera', state: 'granted' }, { permission: 'camera', state: 'prompt' }] },
    { cameraSource: {} }, { deviceId: 'machine-specific' },
  ])('rejects invalid or nonportable device declarations: %j', (fields) => {
    expect(fliwrightConfigSchema.safeParse({ scenarios: { camera: {
      name: 'camera', layers: [{ kind: 'device', ...fields }],
    } } }).success).toBe(false);
  });

  it('treats the entire device baseline as one singleton when composing scenarios', () => {
    const resolver = new ScenarioResolver({
      base: { name: 'base', layers: [{ kind: 'device', requiredCapabilities: ['native.query'] }] },
      camera: { name: 'camera', extends: ['base'], layers: [{ kind: 'device', permissions: [{ permission: 'camera', state: 'prompt' }] }] },
    } as Record<string, TestScenario>);
    expect(() => resolver.resolve('camera')).toThrow(/writes 'device' more than once/);
  });

  it.each(['managed-start', 'attach'] as const)('refuses unprepared device layers before any Bridge call in %s', async (mode) => {
    const invoke = vi.fn(async () => undefined);
    const sendRequest = vi.fn(async () => ({ waiting: true }));
    await expect(new ScenarioCoordinator({ app: { invoke }, sendRequest }).apply({
      ...declaration, startupIsolation: mode === 'managed-start' ? 'required' : 'optional',
      layers: [...declaration.layers, { kind: 'app', capability: 'cameraTest', method: 'reset' }],
    } as TestScenario, { mode })).rejects.toThrow(/device.*prepar/i);
    expect(invoke).not.toHaveBeenCalled();
    expect(sendRequest).not.toHaveBeenCalled();
  });

  it('fingerprints device requirements across JSON transport and distinguishes camera fixtures', () => {
    const scenario = declaration as TestScenario;
    expect(fingerprintScenario(scenario)).toBe(fingerprintScenario(JSON.parse(JSON.stringify(scenario))));
    expect(fingerprintScenario(scenario)).not.toBe(fingerprintScenario({
      ...scenario, layers: [{ kind: 'device', cameraSource: { back: { kind: 'image', fixtureId: 'other' } } }],
    } as TestScenario));
  });
});

describe('per-attempt device preparation', () => {
  it('checks device readiness before application setup and reports the verified generation', async () => {
    const runtime = runtimeProbe();
    const prepared = await devicePreparation.prepareScenarioDevice(requirements, runtime, { mode: 'attach', attemptId: 'attempt-1' });
    const invoke = vi.fn(async () => undefined);
    const scenario = { ...requirements, layers: [...requirements.layers, { kind: 'app' as const, capability: 'cameraTest', method: 'reset' }] };
    // The receipt binds the full scenario declaration, not just its device layer.
    const receipt = await devicePreparation.prepareScenarioDevice(scenario, runtime, { mode: 'attach', attemptId: 'attempt-1' });
    const report = await new ScenarioCoordinator({ app: { invoke } }).apply(scenario, {
      mode: 'attach', attemptId: 'attempt-1', devicePreparation: receipt,
    });
    expect(prepared).toBeDefined();
    expect(runtime.device.capabilities).toHaveBeenCalledTimes(3);
    expect(invoke).toHaveBeenCalledExactlyOnceWith('cameraTest', 'reset', undefined);
    expect(report).toMatchObject({ appliedLayers: ['device', 'app'], device: {
      generation: 'generation-1', scenarioFingerprint: fingerprintScenario(scenario), requiredCapabilities: ['native.query'],
    } });
    expect(JSON.stringify(report)).not.toContain('owned-device');
  });

  it.each(['unsupported', 'unverified', 'not-ready', 'missing'])('fails required %s capabilities', async (state) => {
    const runtime = runtimeProbe();
    runtime.device.capabilities = vi.fn(async () => state === 'missing' ? {} : {
      'native.query': { support: state === 'not-ready' ? 'supported' : state as 'unsupported' | 'unverified', ready: state !== 'not-ready', backend: 'probe' },
    });
    await expect(devicePreparation.prepareScenarioDevice(requirements, runtime, { mode: 'attach', attemptId: 'a' }))
      .rejects.toThrow(/native.query/);
  });

  it.each(['attempt', 'generation', 'scenario', 'mode', 'cancelled', 'readiness'])('rejects a %s change before app mutation', async (change) => {
    const runtime = runtimeProbe();
    const cancellation = new AbortController();
    const receipt = await devicePreparation.prepareScenarioDevice(requirements, runtime, { mode: 'attach', attemptId: 'a', signal: cancellation.signal });
    if (change === 'generation') runtime.adapter.identity.generation = 'generation-2';
    if (change === 'cancelled') cancellation.abort();
    if (change === 'readiness') runtime.device.capabilities = vi.fn(async () => ({}));
    const invoke = vi.fn(async () => undefined);
    await expect(new ScenarioCoordinator({ app: { invoke } }).apply(change === 'scenario' ? { ...requirements, name: 'different' } : requirements, {
      mode: change === 'mode' ? 'managed-start' : 'attach', attemptId: change === 'attempt' ? 'b' : 'a', devicePreparation: receipt,
    })).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('consumes preparation once and requires a new check for every retry', async () => {
    const runtime = runtimeProbe();
    const coordinator = new ScenarioCoordinator({});
    const receipt = await devicePreparation.prepareScenarioDevice(requirements, runtime, { mode: 'attach', attemptId: 'a' });
    await coordinator.apply(requirements, { mode: 'attach', attemptId: 'a', devicePreparation: receipt });
    await expect(coordinator.apply(requirements, { mode: 'attach', attemptId: 'a', devicePreparation: receipt })).rejects.toThrow(/consumed/);
    const retry = await devicePreparation.prepareScenarioDevice(requirements, runtime, { mode: 'attach', attemptId: 'b' });
    await expect(coordinator.apply(requirements, { mode: 'attach', attemptId: 'b', devicePreparation: retry })).resolves.toMatchObject({ ready: true });
  });

  it.each(['baseline', 'biometricBaseline', 'permissions', 'media', 'cameraSource'])('refuses unimplemented %s preparation before platform reads', async (field) => {
    const runtime = runtimeProbe();
    const layer = declaration.layers[0];
    await expect(devicePreparation.prepareScenarioDevice({ name: 'pending', layers: [{ kind: 'device', [field]: layer[field as keyof typeof layer] }] } as TestScenario,
      runtime, { mode: 'managed-start', attemptId: 'a' })).rejects.toThrow(/prelaunch|preboot/i);
    expect(runtime.device.capabilities).not.toHaveBeenCalled();
  });
});
