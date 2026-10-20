import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { runTool } from './commands.js';
import type { DeviceDiscoveryOptions, DeviceInventory, DeviceScanOptions, DiscoveredDevice, DiscoverySource } from './types.js';

class InvalidOutput extends Error {}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InvalidOutput();
  return value as Record<string, unknown>;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new InvalidOutput();
  return value;
}
function json(text: string): unknown {
  try { return JSON.parse(text); } catch { throw new InvalidOutput(); }
}
function required(value: unknown): string {
  if (typeof value !== 'string' || !value) throw new InvalidOutput();
  return value;
}
function text(value: unknown): string | undefined { return typeof value === 'string' && value ? value : undefined; }

function androidTool(name: 'adb' | 'emulator', host: NodeJS.Platform): string {
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || (host === 'darwin'
    ? join(homedir(), 'Library', 'Android', 'sdk')
    : host === 'win32' ? join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'Android', 'Sdk') : join(homedir(), 'Android', 'Sdk'));
  const path = join(sdk, name === 'adb' ? 'platform-tools' : 'emulator', host === 'win32' ? `${name}.exe` : name);
  return existsSync(path) ? path : name;
}

/** Read-only device discovery. Tool failures return diagnostics while other sources remain usable. */
export class DeviceDiscovery {
  private readonly host: NodeJS.Platform;
  private readonly tools: Record<'adb' | 'emulator' | 'xcrun', string>;
  constructor(options: DeviceDiscoveryOptions = {}) {
    this.host = options.hostPlatform ?? process.platform;
    this.tools = { adb: androidTool('adb', this.host), emulator: androidTool('emulator', this.host), xcrun: 'xcrun', ...options.tools };
  }

  /** Detect devices without launching apps or booting, erasing, pairing or unlocking devices. Cancellation rejects. */
  async scan(options: DeviceScanOptions = {}): Promise<DeviceInventory> {
    options.signal?.throwIfAborted();
    const timeoutMs = options.timeoutMs ?? 8000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error('timeoutMs must be a positive integer');
    const platforms = options.platforms ?? (this.host === 'darwin' ? ['ios', 'android'] : ['android']);
    const inventory: DeviceInventory = { scannedAt: '', devices: [], diagnostics: [] };
    const run = (bin: string, args: string[]) => runTool(bin, args, { timeoutMs, signal: options.signal });
    const probe = async <T>(source: DiscoverySource, work: () => Promise<T>): Promise<T | undefined> => {
      try { return await work(); } catch (error) {
        options.signal?.throwIfAborted();
        const code = error instanceof InvalidOutput ? 'invalid-output'
          : (error as NodeJS.ErrnoException)?.code === 'ENOENT' ? 'missing-tool' : 'command-failed';
        inventory.diagnostics.push({ source, code, message: code === 'missing-tool' ? `${source}: required tool is not installed or not on PATH.`
          : code === 'invalid-output' ? `${source}: unexpected tool output; detection is incomplete.` : `${source}: command failed or timed out; check tool permissions and device access.` });
        return undefined;
      }
    };
    const ios = async () => {
      if (this.host !== 'darwin') {
        inventory.diagnostics.push({ source: 'ios-device', code: 'unsupported-host', message: 'iOS device discovery requires macOS and Xcode.' });
        return;
      }
      const results = await Promise.all([
        probe('ios-simulator', async () => {
          const groups = object(object(json(await run(this.tools.xcrun, ['simctl', 'list', 'devices', '--json']))).devices);
          const devices: DiscoveredDevice[] = [];
          for (const [runtime, rows] of Object.entries(groups)) {
            if (!runtime.includes('.iOS-')) continue;
            for (const value of array(rows)) {
              const d = object(value);
              devices.push({ id: required(d.udid), name: required(d.name), platform: 'ios', kind: 'simulator',
                state: d.isAvailable === false ? 'unavailable' : d.state === 'Booted' ? 'online' : d.state === 'Shutdown' ? 'shutdown' : 'unknown',
                osVersion: runtime.split('.iOS-')[1]?.replaceAll('-', '.'), detail: text(d.availabilityError) });
            }
          }
          return devices;
        }),
        probe('ios-device', async () => array(json(await run(this.tools.xcrun, ['xcdevice', 'list', '--timeout', '3'])))
          .map(object).filter((d) => d.platform === 'com.apple.platform.iphoneos' && d.simulator === false && d.ignored !== true)
          .map((d): DiscoveredDevice => ({ id: required(d.identifier), name: required(d.name), platform: 'ios', kind: 'physical',
            state: d.available === true ? 'online' : 'unavailable', osVersion: text(d.operatingSystemVersion), model: text(d.modelName), detail: d.error ? text(object(d.error).description) : undefined }))),
      ]);
      for (const devices of results) if (devices) inventory.devices.push(...devices);
    };
    const android = async () => {
      const [connected, avds] = await Promise.all([
        probe('adb', async () => {
          const output = await run(this.tools.adb, ['devices', '-l']);
          if (!output.includes('List of devices attached')) throw new InvalidOutput();
          return output.split(/\r?\n/).slice(output.split(/\r?\n/).findIndex((line) => line.startsWith('List of devices attached')) + 1)
            .filter((line) => line.trim() && !line.startsWith('*')).map((line): DiscoveredDevice => {
              const [id, status] = line.trim().split(/\s+/);
              if (!id || !status) throw new InvalidOutput();
              const model = line.match(/\bmodel:(\S+)/)?.[1]?.replaceAll('_', ' ');
              return { id, name: model ?? id, model, platform: 'android', kind: id.startsWith('emulator-') ? 'simulator' : 'physical',
                state: status === 'device' ? 'online' : status === 'offline' ? 'offline' : status === 'unauthorized' ? 'unauthorized' : status === 'no' ? 'unavailable' : 'unknown' };
            });
        }),
        probe('android-emulator', async () => {
          const lines = (await run(this.tools.emulator, ['-list-avds'])).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
          if (lines.some((line) => !/^[\w.-]+$/.test(line))) throw new InvalidOutput();
          return [...new Set(lines)];
        }),
      ]);
      await Promise.all((connected ?? []).map(async (device) => {
        if (device.state !== 'online') return;
        const [version, avdName] = await Promise.all([
          probe('adb', () => run(this.tools.adb, ['-s', device.id, 'shell', 'getprop', 'ro.build.version.release'])),
          device.kind === 'simulator' ? probe('adb', async () => {
            const name = (await run(this.tools.adb, ['-s', device.id, 'emu', 'avd', 'name'])).split(/\r?\n/)[0]?.trim();
            return required(name);
          }) : undefined,
        ]);
        device.osVersion = version?.trim() || undefined;
        if (avdName) { device.avdName = avdName; device.name = avdName; }
      }));
      inventory.devices.push(...(connected ?? []));
      const names = new Set(connected?.map((device) => device.avdName).filter(Boolean));
      const complete = connected !== undefined && !connected.some((device) => device.kind === 'simulator' && !device.avdName);
      for (const name of avds ?? []) if (!names.has(name)) inventory.devices.push({ id: `avd:${name}`, name, platform: 'android', kind: 'simulator', state: complete ? 'shutdown' : 'unknown', avdName: name });
    };
    await Promise.all([...(platforms.includes('ios') ? [ios()] : []), ...(platforms.includes('android') ? [android()] : [])]);
    options.signal?.throwIfAborted();
    inventory.devices = [...new Map(inventory.devices.map((device) => [`${device.platform}:${device.id}`, device])).values()]
      .sort((a, b) => a.platform.localeCompare(b.platform) || a.id.localeCompare(b.id));
    inventory.diagnostics.sort((a, b) => a.source.localeCompare(b.source) || a.code.localeCompare(b.code));
    inventory.scannedAt = new Date().toISOString();
    return inventory;
  }
}
