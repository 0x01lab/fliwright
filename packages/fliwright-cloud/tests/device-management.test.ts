import { afterEach, expect, it } from 'vitest';
import { CloudStore } from '../src/CloudStore.js';
import type { DeviceInventory } from '@fliwright/cloud-protocol';
const stores: CloudStore[] = [];
afterEach(() => stores.splice(0).forEach((s) => s.close()));
const target = {
  id: 'app',
  name: 'App',
  repository: '/app',
  suites: { smoke: '*.test.ts' },
  scenarios: ['clean'],
};
function setup(slots = true) {
  let now = 1000;
  const store = new CloudStore(':memory:', () => now);
  stores.push(store);
  store.configure(
    [target],
    [
      {
        id: 'mac',
        slots: slots
          ? [{ id: 'ios', deviceId: 'device', targets: ['app'] }]
          : [],
      },
    ],
  );
  const scan = (
    state: DeviceInventory['devices'][number]['state'] = 'online',
  ) =>
    store.recordDeviceInventory('mac', {
      scannedAt: new Date().toISOString(),
      devices: [
        {
          id: 'device',
          name: 'Phone',
          platform: 'ios',
          kind: 'physical',
          state,
        },
      ],
      diagnostics: [],
    });
  const submit = (key: string) =>
    store.submit(
      {
        targetId: 'app',
        commit: 'a'.repeat(40),
        suite: 'smoke',
        scenario: 'clean',
      },
      'alice',
      key,
    );
  return {
    store,
    scan,
    submit,
    advance: () => {
      now += 91000;
    },
  };
}
it('scopes native identities to hosts and retains AVD settings across boot and disappearance', () => {
  const { store } = setup(false);
  store.configure([], [{ id: 'other', slots: [] }]);
  const scan = (worker: string, id: string, state: string) =>
    store.recordDeviceInventory(worker, {
      scannedAt: new Date().toISOString(),
      devices: [
        {
          id,
          name: 'Pixel',
          avdName: 'Pixel_API',
          platform: 'android',
          kind: 'simulator',
          state,
        },
      ],
      diagnostics: [],
    });
  scan('mac', 'avd:Pixel_API', 'shutdown');
  const first = store.listDevices()[0];
  expect(first.settings.managed).toBe(false);
  store.updateDevice(
    first.id,
    {
      alias: 'QA Pixel',
      tags: ['qa'],
      managed: true,
      enabled: false,
      targets: ['app'],
      slotId: 'pixel',
    },
    'ops',
  );
  scan('mac', 'emulator-5554', 'online');
  scan('other', 'emulator-5554', 'online');
  const devices = store.listDevices();
  expect(devices).toHaveLength(2);
  expect(store.getDevice(first.id)).toMatchObject({
    nativeId: 'emulator-5554',
    settings: { alias: 'QA Pixel', tags: ['qa'] },
  });
  store.recordDeviceInventory('mac', {
    scannedAt: new Date().toISOString(),
    devices: [],
    diagnostics: [],
  });
  expect(store.getDevice(first.id)).toMatchObject({
    present: false,
    blockers: expect.arrayContaining(['missing']),
  });
});
it('requires fresh online discovery and matching deployed runtime before scheduling', () => {
  const { store, scan, submit, advance } = setup();
  submit('one');
  expect(store.claim('mac', 'ios', 'device')).toBeNull();
  scan('unauthorized');
  expect(store.claim('mac', 'ios', 'device')).toBeNull();
  scan();
  expect(store.claim('mac', 'ios', 'wrong-device')).toBeNull();
  advance();
  expect(store.claim('mac', 'ios', 'device')).toBeNull();
  scan();
  expect(store.claim('mac', 'ios', 'device')?.request.state).toBe('assigned');
});
it('persists web settings over startup seeds and pauses only future assignments', () => {
  const { store, scan, submit } = setup();
  scan();
  submit('one');
  submit('two');
  const lease = store.claim('mac', 'ios', 'device')!;
  const device = store.listDevices()[0];
  store.updateDevice(
    device.id,
    { ...device.settings, enabled: false, alias: 'My phone' },
    'ops',
  );
  expect(store.heartbeat(lease, 'running').cancelRequested).toBe(false);
  expect(() =>
    store.updateDevice(
      device.id,
      { ...device.settings, slotId: 'other' },
      'ops',
    ),
  ).toThrow(/occupied|quarantined/i);
  store.finish(lease, {
    verdict: 'passed',
    cleanup: 'clean',
    publication: 'unavailable',
  });
  store.configure(
    [target],
    [
      {
        id: 'mac',
        slots: [{ id: 'ios', deviceId: 'wrong', targets: ['app'] }],
      },
    ],
  );
  expect(store.getDevice(device.id).settings).toMatchObject({
    enabled: false,
    alias: 'My phone',
  });
  expect(store.slot('mac', 'ios')?.deviceId).toBe('device');
  expect(store.claim('mac', 'ios', 'device')).toBeNull();
  expect(
    store
      .events(null, 0)
      .some((e) => e.kind === 'device-updated' && e.data.actor === 'ops'),
  ).toBe(true);
});
it('supports enrollment without pretending a slot is deployed, validates applications and fences quarantine', () => {
  const { store, scan } = setup(false);
  scan();
  const device = store.listDevices()[0];
  const settings = {
    alias: '',
    tags: [],
    managed: true,
    enabled: true,
    targets: ['app'],
    slotId: 'phone',
  };
  expect(() =>
    store.updateDevice(device.id, { ...settings, targets: ['unknown'] }, 'ops'),
  ).toThrow(/target/i);
  store.updateDevice(device.id, settings, 'ops');
  expect(store.getDevice(device.id).blockers).toContain('runtime-missing');
  store.db
    .prepare("UPDATE slots SET state='quarantined' WHERE worker_id='mac'")
    .run();
  expect(() =>
    store.updateDevice(
      device.id,
      { ...settings, managed: false, slotId: null },
      'ops',
    ),
  ).toThrow(/occupied|quarantined/i);
  expect(store.getDevice(device.id).blockers).toContain('quarantined');
});
it('allows identical native IDs on different hosts and migrates the old globally unique slot schema', () => {
  const { store, scan } = setup();
  scan();
  store.configure(
    [],
    [
      {
        id: 'other',
        slots: [{ id: 'ios', deviceId: 'device', targets: ['app'] }],
      },
    ],
  );
  expect(store.listWorkers()).toHaveLength(2);
});
it.each(['offline', 'shutdown', 'unavailable', 'unknown'] as const)(
  'refuses new assignments for %s devices',
  (state) => {
    const { store, scan, submit } = setup();
    scan(state);
    submit('one');
    expect(store.claim('mac', 'ios', 'device')).toBeNull();
  },
);
it('persists unbinding across repeated startup seeds and blocks paused hosts and disallowed apps', () => {
  const { store, scan, submit } = setup();
  scan();
  submit('one');
  const device = store.listDevices()[0];
  store.pauseWorker('mac', true, 'ops');
  expect(store.claim('mac', 'ios', 'device')).toBeNull();
  store.pauseWorker('mac', false, 'ops');
  store.updateDevice(device.id, { ...device.settings, targets: [] }, 'ops');
  expect(store.claim('mac', 'ios', 'device')).toBeNull();
  store.updateDevice(
    device.id,
    { ...device.settings, managed: false, slotId: null },
    'ops',
  );
  store.configure(
    [target],
    [
      {
        id: 'mac',
        slots: [{ id: 'ios', deviceId: 'device', targets: ['app'] }],
      },
    ],
  );
  expect(store.slot('mac', 'ios', false)).toBeUndefined();
});
it('binds an idle bootstrap slot to a discovered AVD and keeps its policy across native ID changes', () => {
  const { store } = setup();
  store.recordDeviceInventory('mac', {
    scannedAt: new Date().toISOString(),
    devices: [
      {
        id: 'avd:Pixel',
        name: 'Pixel',
        avdName: 'Pixel',
        platform: 'android',
        kind: 'simulator',
        state: 'shutdown',
      },
    ],
    diagnostics: [],
  });
  const device = store.listDevices()[0];
  store.updateDevice(
    device.id,
    {
      alias: '',
      tags: [],
      managed: true,
      enabled: true,
      targets: ['app'],
      slotId: 'ios',
    },
    'ops',
  );
  expect(store.getDevice(device.id).slot?.deviceId).toBe('avd:Pixel');
  store.recordDeviceInventory('mac', {
    scannedAt: new Date().toISOString(),
    devices: [
      {
        id: 'emulator-5554',
        name: 'Pixel',
        avdName: 'Pixel',
        platform: 'android',
        kind: 'simulator',
        state: 'online',
      },
      {
        id: 'other',
        name: 'Phone',
        platform: 'ios',
        kind: 'physical',
        state: 'online',
      },
    ],
    diagnostics: [],
  });
  expect(store.claim('mac', 'ios', 'emulator-5554')).toBeNull(); // no queued request; runtime still announced
  expect(store.getDevice(device.id)).toMatchObject({
    ready: true,
    settings: { targets: ['app'] },
  });
  const other = store.listDevices().find((d) => d.nativeId === 'other')!;
  expect(() =>
    store.updateDevice(
      other.id,
      { ...store.getDevice(device.id).settings },
      'ops',
    ),
  ).toThrow(/already configured/i);
});
