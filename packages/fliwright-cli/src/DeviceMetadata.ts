import { DeviceDiscovery } from '@fliwright/devices';
import { z } from 'zod';

const text = z.string().trim().min(1);
/** Device snapshot associated with a run, independent of the tested build identity. */
export const deviceMetadataSchema = z.object({
  id: text.optional(), name: text.optional(), model: text.optional(),
  platform: z.enum(['ios', 'android']).optional(),
  kind: z.enum(['physical', 'simulator']).optional(), osVersion: text.optional(),
}).strict();
export type DeviceMetadata = z.infer<typeof deviceMetadataSchema>;

/** Capture only the explicitly selected device. Missing host tools must not prevent a test run. */
export async function captureDeviceMetadata(deviceId: string, signal?: AbortSignal): Promise<DeviceMetadata> {
  try {
    const inventory = await new DeviceDiscovery().scan({ signal, timeoutMs: 1500 });
    const device = inventory.devices.find(entry => entry.id === deviceId);
    if (device) return deviceMetadataSchema.parse({ id: device.id, name: device.name, model: device.model,
      platform: device.platform, kind: device.kind, osVersion: device.osVersion });
  } catch {
    signal?.throwIfAborted();
  }
  return { id: deviceId };
}
