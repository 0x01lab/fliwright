import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DeviceDiscovery } from '../src/index.js';
import { runTool } from '../src/commands.js';

vi.mock('../src/commands.js', () => ({ runTool: vi.fn() }));
const command = vi.mocked(runTool);
const tools = { adb: 'adb', emulator: 'emulator', xcrun: 'xcrun' };
const ios = new DeviceDiscovery({ hostPlatform: 'darwin', tools });
beforeEach(() => { command.mockReset(); });

describe('device discovery', () => {
  it('lists booted and stopped iOS simulators and physical iOS devices without macOS or duplicate simulators', async () => {
    command.mockImplementation(async (_bin, args) => {
      if (args[0] === 'simctl') return JSON.stringify({ devices: {
        'com.apple.CoreSimulator.SimRuntime.iOS-18-5': [
          { udid: 'sim-booted', name: 'QA phone', deviceTypeIdentifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro', state: 'Booted', isAvailable: true },
          { udid: 'sim-stopped', name: 'iPad', state: 'Shutdown', isAvailable: true },
          { udid: 'sim-broken', name: 'Old iPhone', state: 'Shutdown', isAvailable: false },
        ],
        'com.apple.CoreSimulator.SimRuntime.tvOS-18-5': [{ udid: 'tv', name: 'TV', state: 'Booted', isAvailable: true }],
      } });
      return JSON.stringify([
        { identifier: 'phone', name: 'USB iPhone', platform: 'com.apple.platform.iphoneos', simulator: false, available: true, operatingSystemVersion: '18.5 (build)', interface: 'usb' },
        { identifier: 'unpaired', name: 'Locked phone', platform: 'com.apple.platform.iphoneos', simulator: false, available: false, error: { description: 'Unlock and trust this computer' } },
        { identifier: 'sim-booted', platform: 'com.apple.platform.iphonesimulator', simulator: true, available: true },
        { identifier: 'mac', platform: 'com.apple.platform.macosx', simulator: false, available: true },
      ]);
    });
    const result = await ios.scan({ platforms: ['ios'] });
    expect(result.diagnostics).toEqual([]);
    expect(result.devices).toHaveLength(5);
    expect(result.devices).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'sim-booted', name: 'QA phone', model: 'iPhone 17 Pro', platform: 'ios', kind: 'simulator', state: 'online', osVersion: '18.5' }),
      expect.objectContaining({ id: 'sim-stopped', kind: 'simulator', state: 'shutdown' }),
      expect.objectContaining({ id: 'sim-broken', state: 'unavailable' }),
      expect.objectContaining({ id: 'phone', kind: 'physical', state: 'online', osVersion: '18.5 (build)' }),
      expect.objectContaining({ id: 'unpaired', state: 'unavailable', detail: 'Unlock and trust this computer' }),
    ]));
    expect(command.mock.calls.every(([bin]) => bin === 'xcrun')).toBe(true);
  });

  it('lists Android real devices, unauthorized/offline devices and stopped AVDs, merging a running AVD by name', async () => {
    command.mockImplementation(async (bin, args) => {
      if (bin === 'emulator') return 'Pixel_API_35\nTablet_API_35\n';
      if (args[0] === 'devices') return 'List of devices attached\nusb-1 device product:p model:Pixel_9 device:tokay transport_id:1\nusb-2 unauthorized usb:1-1\nemulator-5554 device product:sdk model:sdk_gphone64_arm64\nemulator-5556 offline\n';
      if (args.includes('emu')) return 'Pixel_API_35\nOK\n';
      return '15\n';
    });
    const result = await ios.scan({ platforms: ['android'] });
    expect(result.diagnostics).toEqual([]);
    expect(result.devices).toHaveLength(5);
    expect(result.devices).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'usb-1', name: 'Pixel 9', platform: 'android', kind: 'physical', state: 'online', osVersion: '15' }),
      expect.objectContaining({ id: 'usb-2', state: 'unauthorized' }),
      expect.objectContaining({ id: 'emulator-5554', kind: 'simulator', avdName: 'Pixel_API_35', state: 'online' }),
      expect.objectContaining({ id: 'emulator-5556', state: 'offline' }),
      expect.objectContaining({ id: 'avd:Tablet_API_35', avdName: 'Tablet_API_35', state: 'unknown' }),
    ]));
    expect(command.mock.calls.filter(([, args]) => args.includes('getprop'))).toHaveLength(2);
  });

  it('preserves useful results when another source is missing or malformed', async () => {
    command.mockImplementation(async (_bin, args) => {
      if (args[0] === 'devices') throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      if (args[0] === 'simctl') return 'not json';
      if (args[0] === 'xcdevice') return '[]';
      return 'Pixel\n';
    });
    const result = await ios.scan();
    expect(result.devices).toEqual([expect.objectContaining({ id: 'avd:Pixel', state: 'unknown' })]);
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'adb', code: 'missing-tool' }),
      expect.objectContaining({ source: 'ios-simulator', code: 'invalid-output' }),
    ]));
  });

  it('reports unsupported iOS hosts and rejects cancellation without probing tools', async () => {
    const scanner = new DeviceDiscovery({ hostPlatform: 'linux', tools });
    const result = await scanner.scan({ platforms: ['ios'] });
    expect(result.devices).toEqual([]);
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'unsupported-host' })]);
    expect(command).not.toHaveBeenCalled();
    const controller = new AbortController();
    controller.abort();
    await expect(ios.scan({ signal: controller.signal })).rejects.toThrow();
    expect(command).not.toHaveBeenCalled();
  });

  it('keeps an online device when optional metadata fails and reports incomplete detection', async () => {
    command.mockImplementation(async (bin, args) => {
      if (bin === 'emulator') return '';
      if (args[0] === 'devices') return 'List of devices attached\nphone device model:Pixel\n';
      throw new Error('tool timed out');
    });
    const result = await ios.scan({ platforms: ['android'] });
    expect(result.devices).toEqual([expect.objectContaining({ id: 'phone', state: 'online' })]);
    expect(result.diagnostics).toEqual([expect.objectContaining({ source: 'adb', code: 'command-failed' })]);
  });
});
