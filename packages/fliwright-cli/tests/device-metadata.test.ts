import { afterEach, expect, it, vi } from 'vitest';
import { DeviceDiscovery } from '@fliwright/devices';
import { captureDeviceMetadata } from '../src/DeviceMetadata.js';

afterEach(() => vi.restoreAllMocks());

it('does not infer an attached VM device from other online devices', async () => {
  vi.spyOn(DeviceDiscovery.prototype, 'scan').mockResolvedValue({ scannedAt: '', diagnostics: [], devices: [
    { id: 'other-device', name: 'Other phone', model: 'Pixel 9', platform: 'android', kind: 'physical', state: 'online' },
  ] });
  expect(await captureDeviceMetadata('selected-device')).toEqual({ id: 'selected-device' });
});

it('keeps the selected ID when device discovery is unavailable', async () => {
  vi.spyOn(DeviceDiscovery.prototype, 'scan').mockRejectedValue(new Error('tool unavailable'));
  expect(await captureDeviceMetadata('selected-device')).toEqual({ id: 'selected-device' });
});

it('propagates cancellation instead of starting tests after a cancelled scan', async () => {
  const controller = new AbortController();
  vi.spyOn(DeviceDiscovery.prototype, 'scan').mockImplementation(async () => { controller.abort(); throw controller.signal.reason; });
  await expect(captureDeviceMetadata('selected-device', controller.signal)).rejects.toBe(controller.signal.reason);
});
