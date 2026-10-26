import { expect, it } from 'vitest';
import { hostConfigSchema } from '../src/config.js';
import { executorSettings } from '../src/host.js';
import type { ManagedDevice } from '@fliwright/cloud-protocol';

const device = {
  id: 'registry', workerId: 'mac', nativeId: 'simulator-uuid',
  observation: { id: 'simulator-uuid', platform: 'ios', kind: 'simulator', state: 'online', name: 'iPhone' },
  settings: { managed: true, enabled: true, targets: ['app'], slotId: 'device-registry' },
  slot: { id: 'device-registry', state: 'idle' },
} as ManagedDevice;
it('runs a paired host with no manually supplied worker, device or slot IDs', () => {
  const config = hostConfigSchema.parse({ serverUrl: 'https://cloud.test', credentialFile: '/private/credentials.json' });
  const resolved = executorSettings(config, device, '/private/runtime');
  expect(resolved).toMatchObject({ workerId: 'mac', deviceId: 'simulator-uuid', slotId: 'device-registry', root: '/private/runtime/slots/device-registry', credentialFile: '/private/credentials.json' });
  expect(resolved.resetCommands).toEqual([
    { program: 'xcrun', args: ['simctl', 'shutdown', '{deviceId}'], acceptExitCodes: [0, 149] },
    { program: 'xcrun', args: ['simctl', 'boot', '{deviceId}'] },
    { program: 'xcrun', args: ['simctl', 'bootstatus', '{deviceId}', '-b'] },
  ]);
  expect(JSON.stringify(resolved)).not.toContain('erase');
});
it('keeps physical device reset policy explicit and never accepts server-supplied shell commands', () => {
  const config = hostConfigSchema.parse({ serverUrl: 'https://cloud.test', tokenEnv: 'TOKEN' });
  expect(() => executorSettings(config, { ...device, observation: { ...device.observation, kind: 'physical' } }, '/runtime')).toThrow(/resetCommands/);
  const custom = hostConfigSchema.parse({ ...config, resetCommands: [{ program: 'local-reset', args: ['{deviceId}'] }] });
  expect(executorSettings(custom, device, '/runtime').resetCommands).toEqual(custom.resetCommands);
});
