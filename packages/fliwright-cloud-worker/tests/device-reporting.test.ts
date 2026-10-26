import { beforeEach, expect, it, vi } from 'vitest';
import { DeviceDiscovery } from '@fliwright/devices';
import { reportWorkerDevices } from '../src/device-reporting.js';

beforeEach(() => { vi.spyOn(DeviceDiscovery.prototype, 'watch').mockReturnValue(() => {}); });

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


it('immediately rescans on device events and reconciles changes arriving during an upload without overlap', async () => {
  const controller = new AbortController();
  let changed!: () => void;
  const stopWatching = vi.fn();
  vi.mocked(DeviceDiscovery.prototype.watch).mockImplementation((listener) => {
    changed = listener;
    return stopWatching;
  });
  let finishUpload!: () => void;
  const initial = { scannedAt: '2026-10-22T00:00:00Z', devices: [], diagnostics: [] };
  const scan = vi.spyOn(DeviceDiscovery.prototype, 'scan').mockResolvedValue(initial);
  const request = vi.fn()
    .mockResolvedValueOnce({})
    .mockImplementationOnce(() => new Promise<void>((resolve) => { finishUpload = resolve; }))
    .mockImplementationOnce(async () => { controller.abort(); });
  try {
    const running = reportWorkerDevices({ request } as never, { signal: controller.signal, intervalMs: 60000 });
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    changed();
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    changed();
    changed();
    expect(scan).toHaveBeenCalledTimes(2);
    finishUpload();
    await running;
    expect(scan).toHaveBeenCalledTimes(3);
    expect(stopWatching).toHaveBeenCalledOnce();
  } finally { controller.abort(); vi.restoreAllMocks(); }
});


it('reconciles immediately after WS reconnect and unsubscribes when stopped', async () => {
  const controller = new AbortController();
  let connected!: () => void;
  const unsubscribe = vi.fn();
  vi.spyOn(DeviceDiscovery.prototype, 'scan').mockResolvedValue({ scannedAt: new Date().toISOString(), devices: [], diagnostics: [] });
  const request = vi.fn().mockResolvedValueOnce({}).mockImplementationOnce(async () => { controller.abort(); });
  try {
    const running = reportWorkerDevices({ request, onConnected(listener) { connected = listener; return unsubscribe; } }, {
      signal: controller.signal, intervalMs: 60000,
    });
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
    connected();
    await running;
    expect(request).toHaveBeenCalledTimes(2);
    expect(unsubscribe).toHaveBeenCalledOnce();
  } finally { controller.abort(); vi.restoreAllMocks(); }
});
