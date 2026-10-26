import { afterEach, expect, it } from 'vitest';
import { CloudStore } from '../src/CloudStore.js';

const stores: CloudStore[] = [];
afterEach(() => stores.splice(0).forEach(store => store.close()));
function setup() {
  const store = new CloudStore(':memory:');
  stores.push(store);
  store.configure([{ id: 'app', name: 'App', repository: '/app', suites: { smoke: '*.test.ts' }, scenarios: ['clean'] }], [{ id: 'mac', slots: [] }, { id: 'other', slots: [] }]);
  store.recordDeviceInventory('mac', { scannedAt: new Date().toISOString(), devices: [{ id: 'native', name: 'Simulator', platform: 'ios', kind: 'simulator', state: 'online' }], diagnostics: [] });
  return store;
}
it('automatically allocates a stable slot when enrolling a device without an explicit slot ID', () => {
  const store = setup(), device = store.listDevices()[0]!;
  const saved = store.updateDevice(device.id, { ...device.settings, managed: true, enabled: true, targets: ['app'] }, 'ops');
  expect(saved.settings.slotId).toEqual(expect.any(String));
  expect(saved.slot).toMatchObject({ id: saved.settings.slotId, deviceId: 'native', targets: ['app'] });
  const again = store.updateDevice(device.id, { ...saved.settings, slotId: null }, 'ops');
  expect(again.settings.slotId).toBe(saved.settings.slotId);
  expect(store.listWorkers()[0]!.slots).toHaveLength(1);
});
it('derives scan authorization from managed device application bindings and revokes it on removal', () => {
  const store = setup(), device = store.listDevices()[0]!;
  store.createCatalogScan('app', 'a'.repeat(40));
  expect(store.claimCatalogScan('mac')).toBeNull();
  const saved = store.updateDevice(device.id, { ...device.settings, managed: true, enabled: true, targets: ['app'] }, 'ops');
  expect(store.claimCatalogScan('other')).toBeNull();
  const lease = store.claimCatalogScan('mac');
  expect(lease?.project.id).toBe('app');
  store.updateCatalogScan(lease!.scan.scanId, 'failed');
  store.updateDevice(device.id, { ...saved.settings, enabled: false }, 'ops');
  store.createCatalogScan('app', 'b'.repeat(40));
  expect(store.claimCatalogScan('mac')).toBeNull();
  store.updateDevice(device.id, { ...saved.settings, targets: [] }, 'ops');
  expect(store.claimCatalogScan('mac')).toBeNull();
});
it('repairs an already enrolled device with no slot when the host synchronizes assignments', () => {
  const store = setup(), device = store.listDevices()[0]!;
  store.db.prepare('UPDATE managed_devices SET settings=? WHERE id=?').run(JSON.stringify({ ...device.settings, managed: true, enabled: true, targets: ['app'] }), device.id);
  const assignments = store.workerAssignments('mac');
  expect(assignments.devices).toHaveLength(1);
  expect(assignments.devices[0]!.settings.slotId).toEqual(expect.any(String));
  expect(assignments.devices[0]!.slot?.targets).toEqual(['app']);
});
