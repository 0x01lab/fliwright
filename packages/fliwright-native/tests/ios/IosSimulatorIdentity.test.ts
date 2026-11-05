import { expect, it, vi } from 'vitest';
import { readSimulatorBootGeneration, readSimulatorRunnerPids } from '../../src/ios/IosSimulatorIdentity.js';
import type { NativeConfig, NativeOperationContext } from '@fliwright/core';
import type { ToolExecutor } from '../../src/ToolExecutor.js';

const context = (): NativeOperationContext => ({ requestId: 'boot-identity', deadline: Date.now() + 5000, signal: new AbortController().signal });
const config: NativeConfig = { enabled: true, platform: 'ios', deviceId: 'SIM-1', targetAppId: 'fixture.app' };
const device = (overrides: Record<string, unknown> = {}) => ({ udid: 'sim-1', state: 'Booted', lastBootedAt: '2026-11-04T02:00:00Z', ...overrides });

it('binds the exact booted Simulator UDID to CoreSimulator lastBootedAt', async () => {
  const executor: ToolExecutor = vi.fn(async (_bin, args) => {
    expect(args).toEqual(['simctl', 'list', '-j', 'devices', 'booted']);
    return Buffer.from(JSON.stringify({ devices: { runtime: [device()] } }));
  });
  expect(await readSimulatorBootGeneration({ ...config, tools: { xcrun: '/tools/xcrun' } }, context(), executor))
    .toBe('2026-11-04T02:00:00.000Z');
  expect(executor).toHaveBeenCalledTimes(1);
});

it.each([
  { devices: { runtime: [device({ state: 'Shutdown' })] } },
  { devices: { runtime: [device({ lastBootedAt: undefined })] } },
  { devices: { runtime: [device({ lastBootedAt: '2026-02-31T02:00:00Z' })] } },
  { devices: { runtime: [device(), device()] } },
  { devices: { runtime: [{ ...device(), udid: 'another-sim' }] } },
])('rejects absent, ambiguous or incomplete Simulator boot identity', async data => {
  const executor: ToolExecutor = async () => Buffer.from(JSON.stringify(data));
  await expect(readSimulatorBootGeneration(config, context(), executor)).rejects.toMatchObject({ code: 'device_mismatch' });
});

it('rejects malformed CoreSimulator output', async () => {
  const executor: ToolExecutor = async () => Buffer.from('not json');
  await expect(readSimulatorBootGeneration(config, context(), executor)).rejects.toMatchObject({ code: 'protocol_mismatch' });
});

it.each(['', 'error: service unavailable', 'PID Status Label\ninvalid row', '456 0 dev.fliwright.NativeRunner.xctrunner'])('does not interpret incomplete launchd output as an absent Runner: %s', async output => {
  await expect(readSimulatorRunnerPids(config, context(), async () => Buffer.from(output)))
    .rejects.toMatchObject({ code: 'protocol_mismatch' });
});

it('reads only exact Runner labels from a complete launchd inventory', async () => {
  const inventory = ['PID Status Label', '- 0 dev.fliwright.NativeRunner.xctrunner',
    '987 0 dev.fliwright.NativeRunner.xctrunner.other',
    '456 0 UIKitApplication:dev.fliwright.NativeRunner.xctrunner[AB12][rb-legacy]'].join('\n');
  expect(await readSimulatorRunnerPids(config, context(), async () => Buffer.from(inventory))).toEqual([456]);
  expect(await readSimulatorRunnerPids(config, context(), async () => Buffer.from('PID Status Label\n- 0 another.service'))).toEqual([]);
});
