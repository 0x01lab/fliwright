import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { CloudStore } from '../src/CloudStore.js';

it('migrates existing scanner and device grants to project bindings once', () => {
  const root = mkdtempSync(join(tmpdir(), 'cloud-project-binding-'));
  const path = join(root, 'db');
  const seed = new CloudStore(path);
  seed.configure(['device-app', 'scan-app'].map(id => ({ id, name: id, repository: '/fixture', suites: { smoke: '*.test.ts' } })),
    [{ id: 'mac', slots: [{ id: 'ios', deviceId: 'phone', targets: ['device-app'] }] }]);
  seed.db.exec(`
    DROP TABLE project_workers;
    ALTER TABLE workers ADD COLUMN catalog_projects TEXT NOT NULL DEFAULT '[]';
    UPDATE workers SET catalog_projects='["scan-app","missing"]' WHERE id='mac';
    PRAGMA user_version=8;
  `);
  seed.close();
  const store = new CloudStore(path);
  try {
    expect(store.workerStatuses(new Set())[0].projectIds).toEqual(['device-app', 'scan-app']);
    store.setProjectWorkers('scan-app', [], ['mac'], 'admin');
    store.configure([], [{ id: 'mac', catalogProjects: ['scan-app'], slots: [] }]);
    expect(store.workerStatuses(new Set())[0].projectIds).toEqual(['device-app']);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

it('upgrades version-one databases and persists inventory independently of worker lease health', () => {
  const root = mkdtempSync(join(tmpdir(), 'cloud-devices-'));
  const path = join(root, 'db');
  const old = new DatabaseSync(path);
  old.exec(
    "CREATE TABLE workers(id TEXT PRIMARY KEY, paused INTEGER NOT NULL DEFAULT 0, seen_at INTEGER NOT NULL DEFAULT 0); INSERT INTO workers(id) VALUES('mac'); PRAGMA user_version=1;",
  );
  old.close();
  let store = new CloudStore(path, () => 1000);
  try {
    expect(store.listWorkers()[0]).toMatchObject({
      id: 'mac',
      health: 'unseen',
    });
    const inventory = {
      scannedAt: '2026-10-19T00:00:00.000Z',
      devices: [],
      diagnostics: [],
    };
    store.recordDeviceInventory('mac', inventory);
    expect(() => store.recordDeviceInventory('unknown', inventory)).toThrow(
      'Worker not registered',
    );
    store.close();
    store = new CloudStore(path, () => 91000);
    expect(store.listWorkers()[0]).toMatchObject({
      health: 'unseen',
      inventory: { ...inventory, receivedAt: 1000, stale: true },
    });
    expect(store.db.prepare('PRAGMA user_version').get()).toMatchObject({
      user_version: 9,
    });
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
it('migrates v2 occupied slots without losing generation or lease and preserves web configuration after restart', () => {
  const root = mkdtempSync(join(tmpdir(), 'cloud-device-migration-'));
  const path = join(root, 'db');
  const old = new DatabaseSync(path);
  old.exec(`CREATE TABLE workers(id TEXT PRIMARY KEY, paused INTEGER NOT NULL DEFAULT 0, seen_at INTEGER NOT NULL DEFAULT 0);
    INSERT INTO workers(id) VALUES('mac');
    CREATE TABLE slots(worker_id TEXT NOT NULL, id TEXT NOT NULL, device_id TEXT NOT NULL UNIQUE, targets TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'idle', generation INTEGER NOT NULL DEFAULT 0, attempt_id TEXT, PRIMARY KEY(worker_id,id));
    INSERT INTO slots VALUES('mac','ios','device','[]','busy',7,'attempt-1'); PRAGMA user_version=2;`);
  old.close();
  let store = new CloudStore(path, () => 1000);
  try {
    expect(store.slot('mac', 'ios')).toMatchObject({
      state: 'busy',
      generation: 7,
      attemptId: 'attempt-1',
    });
    store.recordDeviceInventory('mac', {
      scannedAt: new Date().toISOString(),
      devices: [
        {
          id: 'device',
          name: 'Phone',
          platform: 'ios',
          kind: 'physical',
          state: 'online',
        },
      ],
      diagnostics: [],
    });
    const device = store.listDevices()[0];
    store.updateDevice(
      device.id,
      { ...device.settings, alias: 'Persistent', enabled: false },
      'ops',
    );
    store.close();
    store = new CloudStore(path, () => 2000);
    store.configure(
      [],
      [
        {
          id: 'mac',
          slots: [{ id: 'ios', deviceId: 'other', targets: ['app'] }],
        },
      ],
    );
    expect(store.getDevice(device.id)).toMatchObject({
      settings: { alias: 'Persistent', enabled: false },
      slot: { generation: 7, attemptId: 'attempt-1', state: 'busy' },
    });
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
