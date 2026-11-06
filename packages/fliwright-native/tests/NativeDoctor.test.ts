import { expect, it, vi } from 'vitest';
import { inspectNativeEnvironment } from '../src/NativeDoctor.js';
import type { NativeConfig } from '@fliwright/core';
import type { DiscoveredDevice } from '@fliwright/devices';

const config: NativeConfig = { enabled: true, platform: 'android', deviceId: 'chosen', targetAppId: 'example.app' };
const device: DiscoveredDevice = { id: 'chosen', name: 'Test', platform: 'android', kind: 'physical', state: 'online', osVersion: '17' };
function setup(selected = device) {
  const scan = vi.fn(async () => ({ scannedAt: new Date().toISOString(), devices: [selected], diagnostics: [] }));
  const executor = vi.fn(async (_file: string, args: readonly string[]) => Buffer.from(args.includes('version') ? 'Android Debug Bridge version 1.0.41'
    : args.join(' ').includes('pm path') ? 'package:/data/app/example/base.apk' : '17'));
  return { discovery: { scan }, executor };
}

it('probes an explicit Android device without starting an adapter or mutating its UI', async () => {
  const options = setup();
  const result = await inspectNativeEnvironment(config, options);
  expect(result.ready).toBe(true);
  expect(result.device).toMatchObject({ id: 'chosen', kind: 'physical' });
  expect(result.capabilities['biometrics.match']).toMatchObject({ support: 'unsupported', ready: false });
  const calls = options.executor.mock.calls.map(([, args]) => args);
  expect(calls).toContainEqual(['-s', 'chosen', 'shell', "pm path 'example.app'"]);
  expect(calls.flat().join(' ')).not.toMatch(/dump|input|install|grant|revoke|erase|boot/);
});

it('distinguishes an unauthorized selected device from no devices and never probes another device', async () => {
  const options = setup({ ...device, state: 'unauthorized' });
  const result = await inspectNativeEnvironment(config, options);
  expect(result.ready).toBe(false);
  expect(result.checks).toContainEqual(expect.objectContaining({ name: 'device', passed: false, message: expect.stringContaining('unauthorized') }));
  expect(options.executor).not.toHaveBeenCalled();
});

it('preserves discovery/tool diagnostics when the selected device cannot be found', async () => {
  const options = setup();
  options.discovery.scan.mockResolvedValue({ devices: [], diagnostics: [{ source: 'adb', code: 'missing-tool', message: 'ADB missing' }] } as never);
  const result = await inspectNativeEnvironment(config, options);
  expect(result.ready).toBe(false);
  expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'missing-tool' }));
  expect(options.executor).not.toHaveBeenCalled();
});

it('fails app readiness when pm does not identify the installed target package', async () => {
  const options = setup(); options.executor.mockResolvedValue(Buffer.from(''));
  const result = await inspectNativeEnvironment(config, options);
  expect(result.ready).toBe(false);
  expect(result.checks).toContainEqual(expect.objectContaining({ name: 'target-app', passed: false }));
  expect(result.capabilities['native.click'].ready).toBe(false);
});

it('reports iOS Runner preparation separately and never starts XCTest in doctor', async () => {
  const options = setup({ ...device, platform: 'ios', kind: 'simulator' });
  options.executor.mockResolvedValue(Buffer.from('/simulator/app/container'));
  const result = await inspectNativeEnvironment({ ...config, platform: 'ios' }, options);
  expect(result.ready).toBe(false);
  expect(result.checks).toContainEqual(expect.objectContaining({ name: 'runner-product', passed: false }));
  expect(result.capabilities['biometrics.match']).toMatchObject({ support: 'unverified', ready: false });
  expect(options.executor.mock.calls.flatMap(([, args]) => args)).not.toContain('test-without-building');
});

it('propagates cancellation instead of reporting a successful diagnostic', async () => {
  const options = setup();
  const controller = new AbortController(); controller.abort();
  await expect(inspectNativeEnvironment(config, { ...options, signal: controller.signal })).rejects.toMatchObject({ code: 'cancelled' });
  expect(options.discovery.scan).not.toHaveBeenCalled();
});
