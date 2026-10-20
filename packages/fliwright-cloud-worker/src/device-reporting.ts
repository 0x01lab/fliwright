import {
  DeviceDiscovery,
  type DeviceDiscoveryOptions,
} from '@fliwright/devices';
import { setTimeout as delay } from 'node:timers/promises';
import type { CloudClient } from '@fliwright/cloud-protocol';

/** Host inventory reporting runs independently of execution heartbeats and slot polling. */
export async function reportWorkerDevices(
  client: CloudClient,
  options: {
    signal: AbortSignal;
    tools?: DeviceDiscoveryOptions['tools'];
    intervalMs?: number;
  },
): Promise<void> {
  const discovery = new DeviceDiscovery({ tools: options.tools });
  while (!options.signal.aborted) {
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
      console.warn(
        'Device inventory report failed; previous inventory will become stale.',
      );
    }
    await delay(options.intervalMs ?? 30000, undefined, {
      signal: options.signal,
    }).catch(() => {});
  }
}
