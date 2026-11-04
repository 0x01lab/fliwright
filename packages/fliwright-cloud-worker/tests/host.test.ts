import { expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CloudStore, createCloudServer } from '@fliwright/cloud';
import { DeviceDiscovery } from '@fliwright/devices';
import { createHash } from 'node:crypto';
import { hostConfigSchema } from '../src/config.js';
import { runHostWorker } from '../src/host.js';

it('a paired host starts and stops isolated executors when web device bindings change', async () => {
  const root = mkdtempSync(join(tmpdir(), 'auto-worker-host-'));
  const store = new CloudStore(join(root, 'db'));
  store.configure([{ id: 'app', name: 'App', repository: '/app', suites: { smoke: '*.test.ts' }, scenarios: ['clean'] }], [{ id: 'mac', slots: [] }]);
  const server = createCloudServer({ store, dataRoot: join(root, 'reports'), publicUrl: 'https://cloud.test', proxySecret: 'proxy', publicationSecret: 'publication', users: {}, ciTokens: [], workerTokens: [{ workerId: 'mac', hash: createHash('sha256').update('test-host-private-token').digest('hex') }], minFreeBytes: 0 });
  const stop = new AbortController();
  let running: Promise<void> | undefined;
  vi.stubEnv('TEST_HOST_TOKEN', 'test-host-private-token');
  // Host lifecycle is independent of the OS running this test. iOS discovery
  // itself is covered by the devices package against native tool fixtures.
  vi.spyOn(DeviceDiscovery.prototype, 'scan').mockResolvedValue({
    scannedAt: new Date().toISOString(), diagnostics: [],
    devices: [{ id: 'sim-uuid', name: 'iPhone', platform: 'ios', kind: 'simulator', state: 'online' }],
  });
  vi.spyOn(DeviceDiscovery.prototype, 'watch').mockReturnValue(() => {});
  const claims = vi.spyOn(store, 'claim');
  const assignments = vi.spyOn(store, 'workerAssignments');
  try {
    const serverUrl = await server.listen({ host: '127.0.0.1', port: 0 });
    const tool = join(root, 'native-tool');
    writeFileSync(tool, `#!${process.execPath}\nconst arg=process.argv[2]; if(arg==='track-devices'||(arg==='xcdevice'&&process.argv[3]==='observe')) setInterval(()=>{},10000); else console.log(arg==='simctl'?JSON.stringify({devices:{'com.apple.CoreSimulator.SimRuntime.iOS-26-5':[{udid:'sim-uuid',name:'iPhone',state:'Booted',isAvailable:true}]}}):arg==='xcdevice'?'[]':'List of devices attached');`, { mode: 0o700 });
    const config = hostConfigSchema.parse({ serverUrl, tokenEnv: 'TEST_HOST_TOKEN', root: join(root, 'runtime'), deviceTools: { adb: tool, emulator: tool, xcrun: tool } });
    running = runHostWorker(config, join(root, 'worker.json'), stop.signal);
    await vi.waitFor(() => expect(store.listDevices().some(device => device.nativeId === 'sim-uuid')).toBe(true), { timeout: 5000 });
    const device = store.listDevices().find(device => device.nativeId === 'sim-uuid')!;
    const saved = store.updateDevice(device.id, { ...device.settings, managed: true, enabled: true, targets: ['app'] }, 'ops');
    await vi.waitFor(() => expect(store.getDevice(device.id).ready).toBe(true));
    const generated = JSON.parse(readFileSync(join(root, 'runtime', 'slots', saved.settings.slotId!, 'worker.json'), 'utf8'));
    expect(generated).toMatchObject({ workerId: 'mac', deviceId: 'sim-uuid', slotId: saved.settings.slotId });
    expect(JSON.stringify(generated)).not.toContain('test-host-token');
    expect(generated.resetCommands.some((command: { args: string[] }) => command.args.includes('erase'))).toBe(false);
    // Configuration reconciliation must sleep until a pushed change, without an idle loop.
    await new Promise(resolve => setTimeout(resolve, 50));
    const before = assignments.mock.calls.length;
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(assignments.mock.calls.length).toBe(before);
    store.updateDevice(device.id, { ...saved.settings, managed: false, slotId: null }, 'ops');
    await vi.waitFor(() => expect(store.workerAssignments('mac').devices).toHaveLength(0));
    await new Promise(resolve => setTimeout(resolve, 50));
    const stoppedClaims = claims.mock.calls.length;
    store.pauseWorker('mac', false, 'ops');
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(claims.mock.calls.length).toBe(stoppedClaims);
  } finally {
    stop.abort();
    await running;
    await server.close(); store.close();
    vi.unstubAllEnvs(); vi.restoreAllMocks();
    rmSync(root, { recursive: true, force: true });
  }
});
