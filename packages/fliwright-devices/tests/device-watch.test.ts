import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { watch, readdirSync } from 'node:fs';
import { DeviceDiscovery } from '../src/index.js';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
vi.mock('node:fs', async (original) => ({ ...await original<typeof import('node:fs')>(), watch: vi.fn(), readdirSync: vi.fn() }));
const children: Array<EventEmitter & { stdout: PassThrough; stderr: PassThrough; kill: ReturnType<typeof vi.fn> }> = [];
const files = new Map<string, { callback: (event: string, filename: string) => void; close: ReturnType<typeof vi.fn> }>();
beforeEach(() => {
  vi.useFakeTimers();
  children.length = 0;
  files.clear();
  vi.mocked(spawn).mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
    children.push(child);
    return child as never;
  });
  vi.mocked(readdirSync).mockReturnValue(['sim-1'] as never);
  vi.mocked(watch).mockImplementation((path, listener: any) => {
    const watcher = Object.assign(new EventEmitter(), { close: vi.fn() });
    files.set(String(path), { callback: listener, close: watcher.close });
    return watcher as never;
  });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it('notifies on Android connection events without a scan interval and stops native observers on disposal', async () => {
  const changed = vi.fn();
  const stop = new DeviceDiscovery({ hostPlatform: 'linux', tools: { adb: '/sdk/adb' } }).watch(changed);
  expect(spawn).toHaveBeenCalledWith('/sdk/adb', ['track-devices'], expect.anything());
  children[0].stdout.write('0010usb-1\tdevice\n');
  await vi.advanceTimersByTimeAsync(150);
  expect(changed).toHaveBeenCalledOnce();
  stop();
  children[0].stdout.write('0000');
  await vi.advanceTimersByTimeAsync(10000);
  expect(changed).toHaveBeenCalledOnce();
  expect(children[0].kill).toHaveBeenCalled();
  expect([...files.values()].every((file) => file.close.mock.calls.length === 1)).toBe(true);
});

it('observes iOS physical connections and simulator state files, ignoring app data writes', async () => {
  const changed = vi.fn();
  const abort = new AbortController();
  new DeviceDiscovery({ hostPlatform: 'darwin', tools: { adb: 'adb', xcrun: 'xcrun' } }).watch(changed, { signal: abort.signal });
  expect(spawn).toHaveBeenCalledWith('xcrun', ['xcdevice', 'observe', '--both'], expect.anything());
  const sim = [...files.entries()].find(([path]) => path.endsWith('/Devices/sim-1'))![1];
  sim.callback('change', 'data');
  await vi.advanceTimersByTimeAsync(150);
  expect(changed).not.toHaveBeenCalled();
  sim.callback('rename', 'device.plist');
  children[1].stdout.write('Attach: phone');
  await vi.advanceTimersByTimeAsync(150);
  expect(changed).toHaveBeenCalledOnce();
  abort.abort();
  expect(children.every((child) => child.kill.mock.calls.length === 1)).toBe(true);
});

it('restarts a failed native observer and requests reconciliation after its stream is lost', async () => {
  const changed = vi.fn();
  const stop = new DeviceDiscovery({ hostPlatform: 'linux', tools: { adb: 'adb' } }).watch(changed);
  children[0].emit('error', new Error('adb stopped'));
  children[0].emit('close', 1);
  await vi.advanceTimersByTimeAsync(150);
  expect(changed).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(5000);
  expect(spawn).toHaveBeenCalledTimes(2);
  stop();
});
