import { afterEach, describe, expect, it, vi } from 'vitest';
import { VmServiceConnectionController } from '../src/session/VmServiceConnectionController.js';

const options = { reason: 'Flutter debug output', interactive: false };

describe('VmServiceConnectionController', () => {
  afterEach(() => vi.useRealTimers());

  it('does not postpone discovery indefinitely while debug events keep arriving', async () => {
    vi.useFakeTimers();
    const discover = vi.fn(async () => true);
    const controller = new VmServiceConnectionController(discover, vi.fn());

    controller.schedule(options, 100);
    await vi.advanceTimersByTimeAsync(90);
    controller.schedule(options, 100);
    await vi.advanceTimersByTimeAsync(10);

    expect(discover).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it('serializes manual scans, auto scans and explicit connection operations', async () => {
    vi.useFakeTimers();
    let finishScan!: (connected: boolean) => void;
    const discover = vi.fn()
      .mockImplementationOnce(() => new Promise<boolean>(resolve => { finishScan = resolve; }))
      .mockResolvedValue(true);
    const controller = new VmServiceConnectionController(discover, vi.fn());
    const manualScan = controller.discover({ reason: 'Manual scan', interactive: true });
    await Promise.resolve();

    controller.schedule({ ...options, forceReconnect: true }, 0);
    await vi.advanceTimersByTimeAsync(0);
    const disconnect = vi.fn(async () => undefined);
    const disconnected = controller.run(disconnect);
    expect(discover).toHaveBeenCalledTimes(1);
    expect(disconnect).not.toHaveBeenCalled();

    finishScan(true);
    await manualScan;
    await disconnected;
    expect(discover).toHaveBeenCalledTimes(2);
    expect(discover).toHaveBeenLastCalledWith({ ...options, forceReconnect: true });
    expect(disconnect).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it('retries a bounded number of times when the bridge is not ready yet', async () => {
    vi.useFakeTimers();
    const discover = vi.fn(async () => false);
    const controller = new VmServiceConnectionController(discover, vi.fn());
    controller.schedule(options, 0);
    await vi.runAllTimersAsync();

    expect(discover).toHaveBeenCalledTimes(4);
    controller.dispose();
  });

  it('reports automatic failures and still permits a later manual scan', async () => {
    vi.useFakeTimers();
    const error = new Error('discovery failed');
    const discover = vi.fn().mockRejectedValueOnce(error).mockResolvedValue(true);
    const reportError = vi.fn();
    const controller = new VmServiceConnectionController(discover, reportError);
    controller.schedule(options, 0);
    await vi.advanceTimersByTimeAsync(0);

    expect(reportError).toHaveBeenCalledWith(error);
    await expect(controller.discover({ reason: 'Manual scan', interactive: true })).resolves.toBe(true);
    controller.dispose();
  });

  it('cancels automatic retries and queued scans when the user disconnects', async () => {
    vi.useFakeTimers();
    const discover = vi.fn(async () => false);
    const controller = new VmServiceConnectionController(discover, vi.fn());
    controller.schedule(options, 0);
    await vi.advanceTimersByTimeAsync(0);
    controller.cancelScheduled();
    await vi.runAllTimersAsync();

    expect(discover).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it('uses a newly announced endpoint when it arrives during the retry delay', async () => {
    vi.useFakeTimers();
    const discover = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
    const controller = new VmServiceConnectionController(discover, vi.fn());
    controller.schedule(options, 0);
    await vi.advanceTimersByTimeAsync(0);
    controller.schedule({ reason: 'New Flutter endpoint', interactive: false, forceReconnect: true }, 100);
    await vi.advanceTimersByTimeAsync(100);

    expect(discover).toHaveBeenCalledTimes(2);
    expect(discover).toHaveBeenLastCalledWith({ reason: 'New Flutter endpoint', interactive: false, forceReconnect: true });
    controller.dispose();
  });
});
