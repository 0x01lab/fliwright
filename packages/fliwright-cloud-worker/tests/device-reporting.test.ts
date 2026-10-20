import { expect, it, vi } from 'vitest';
import { DeviceDiscovery } from '@fliwright/devices';
import { reportWorkerDevices } from '../src/device-reporting.js';

it('reports scans independently of task leases and continues after a transient upload failure', async () => {
  const controller = new AbortController();
  const inventory = {
    scannedAt: '2026-10-19T00:00:00.000Z',
    devices: [],
    diagnostics: [],
  };
  const scan = vi
    .spyOn(DeviceDiscovery.prototype, 'scan')
    .mockResolvedValue(inventory);
  const request = vi
    .fn()
    .mockRejectedValueOnce(new Error('server unavailable'))
    .mockImplementationOnce(async () => {
      controller.abort();
    });
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    await reportWorkerDevices({ request } as never, {
      signal: controller.signal,
      intervalMs: 1,
    });
    expect(scan).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1]).toEqual([
      '/api/worker/devices',
      expect.objectContaining({ method: 'POST', body: inventory }),
    ]);
    expect(warn).toHaveBeenCalledTimes(1);
  } finally {
    vi.restoreAllMocks();
  }
});

it('does not upload an interrupted scan or leave a pending loop after cancellation', async () => {
  const controller = new AbortController();
  const scan = vi
    .spyOn(DeviceDiscovery.prototype, 'scan')
    .mockImplementation(async () => {
      controller.abort();
      controller.signal.throwIfAborted();
      throw new Error('unreachable');
    });
  const request = vi.fn();
  try {
    await reportWorkerDevices({ request } as never, {
      signal: controller.signal,
    });
    expect(scan).toHaveBeenCalledOnce();
    expect(request).not.toHaveBeenCalled();
  } finally {
    vi.restoreAllMocks();
  }
});
