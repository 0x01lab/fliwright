import { DeviceDiscovery } from '@fliwright/devices';
import { z } from 'zod';
import type { CommandRegistry } from '../CommandRegistry.js';

export function registerDevices(registry: CommandRegistry): void {
  registry.add({
    path: 'devices.list',
    description: 'Discover local iOS and Android devices and simulators',
    input: z.object({ platform: z.enum(['ios', 'android']).optional() }),
    effects: ['environment-probe'],
    output: 'DeviceInventory',
    execute: (input, context) => new DeviceDiscovery().scan({ platforms: input.platform ? [input.platform] : undefined, signal: context.signal }),
  });
}
