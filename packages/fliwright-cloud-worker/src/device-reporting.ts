import {
  DeviceDiscovery,
  type DeviceDiscoveryOptions,
} from '@fliwright/devices';
import type { CloudRequestClient } from '@fliwright/cloud-protocol';

/** Event-driven host inventory reporting; periodic reconciliation also renews freshness. */
export async function reportWorkerDevices(
  client: CloudRequestClient,
  options: {
    signal: AbortSignal;
    tools?: DeviceDiscoveryOptions['tools'];
    intervalMs?: number;
  },
): Promise<void> {
  const discovery = new DeviceDiscovery({ tools: options.tools });
  let pending = true;
  let resume: (() => void) | undefined;
  const invalidate = () => { pending = true; resume?.(); };
  const stopConnections = client.onConnected?.(invalidate);
  const stopWatching = discovery.watch(invalidate, { signal: options.signal });
  const timer = setInterval(invalidate, options.intervalMs ?? 30000);
  options.signal.addEventListener('abort', invalidate, { once: true });
  try {
    while (!options.signal.aborted) {
      if (!pending) {
        await new Promise<void>((resolve) => {
          resume = resolve;
          if (pending || options.signal.aborted) resolve();
        });
        resume = undefined;
      }
      if (options.signal.aborted) break;
      pending = false;
      try {
        const inventory = await discovery.scan({ signal: options.signal });
        options.signal.throwIfAborted();
        await client.request('/api/worker/devices', {
          method: 'POST',
          body: inventory,
          signal: AbortSignal.any([options.signal, AbortSignal.timeout(15000)]),
        });
      } catch {
        if (options.signal.aborted) break;
        console.warn('Device inventory report failed; previous inventory will become stale.');
      }
    }
  } finally {
    clearInterval(timer);
    stopWatching();
    stopConnections?.();
    options.signal.removeEventListener('abort', invalidate);
  }
}
