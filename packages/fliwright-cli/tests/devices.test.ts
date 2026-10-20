import { afterEach, expect, it, vi } from 'vitest';
import { DeviceDiscovery } from '@fliwright/devices';
import { executeCli } from '../src/index.js';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
it('lists host devices through the shared package without an app or inherited session', async () => {
  const inventory = { scannedAt: '2026-10-19T00:00:00.000Z', devices: [{ id: 'phone', name: 'Pixel', platform: 'android', kind: 'physical', state: 'online' }], diagnostics: [] } as const;
  const scan = vi.spyOn(DeviceDiscovery.prototype, 'scan').mockResolvedValue(inventory as never);
  vi.stubEnv('FLIWRIGHT_SESSION', 'missing');
  const result = await executeCli(['devices', 'list', '--platform', 'android', '--json']);
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ command: 'devices.list', ok: true, data: inventory });
  expect(JSON.parse(result.stdout)).not.toHaveProperty('operationId');
  expect(scan).toHaveBeenCalledWith(expect.objectContaining({ platforms: ['android'], signal: expect.any(AbortSignal) }));
});
it('exposes partial detection diagnostics and rejects unsupported platform input before probing', async () => {
  const scan = vi.spyOn(DeviceDiscovery.prototype, 'scan').mockResolvedValue({ scannedAt: '2026-10-19T00:00:00.000Z', devices: [], diagnostics: [{ source: 'adb', code: 'missing-tool', message: 'Install platform tools' }] });
  const result = await executeCli(['devices', 'list', '--json']);
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout).data.diagnostics).toHaveLength(1);
  scan.mockClear();
  expect((await executeCli(['devices', 'list', '--platform', 'windows', '--json'])).exitCode).toBe(2);
  expect(scan).not.toHaveBeenCalled();
});
