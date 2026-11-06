import { expect, it } from 'vitest';
import { inspectAndroidAppJournal, inspectAndroidPermissionJournal } from '../../src/android/AndroidRecoveryRecords.js';

const hash = 'a'.repeat(64);
const appRecord = () => ({ version: 3, journalId: '00000000-0000-4000-8000-000000000001', deviceKey: hash,
  leaseKey: 'b'.repeat(64), ownerGeneration: 'c'.repeat(64), operation: 'installed', appId: 'example.app',
  activity: 'example.app.MainActivity', sha256: 'd'.repeat(64), uid: 10123, installedBySession: true,
  minSdk: 23, targetSdk: 35, permissions: ['android.permission.CAMERA'] });
const permissionRecord = () => ({ version: 2, journalId: '00000000-0000-4000-8000-000000000002', deviceKey: hash,
  leaseKey: 'b'.repeat(64), ownerGeneration: 'c'.repeat(64), appSha256: 'd'.repeat(64), appInstalledBySession: true,
  appId: 'example.app', user: 0, appOpPolicy: 'default-package', uid: 10123,
  baseline: [{ permission: 'camera', granted: false, userSet: true, userFixed: false, flags: ['USER_SET'] }],
  declaration: [{ permission: 'camera', state: 'granted' }],
  desired: [{ permission: 'camera', granted: true, userSet: false, userFixed: false, flags: [] }],
  status: 'pending', step: 'grant', permission: 'camera', restored: false });

it('accepts current journals only when their schema and shared owner/install identity are complete', () => {
  expect(inspectAndroidAppJournal(appRecord())).toBe('bound');
  expect(inspectAndroidPermissionJournal(permissionRecord())).toBe('bound');
});

it('requires exact forward evidence for running and removal states only', () => {
  const forward = { hostPort: 45678, devicePort: 34567 };
  expect(inspectAndroidAppJournal({ ...appRecord(), operation: 'forward', forward })).toBe('bound');
  expect(inspectAndroidAppJournal({ ...appRecord(), operation: 'running', forward })).toBe('bound');
  expect(inspectAndroidAppJournal({ ...appRecord(), operation: 'remove-forward', forward })).toBe('bound');
  expect(inspectAndroidAppJournal({ ...appRecord(), operation: 'running' })).toBe('invalid');
  expect(inspectAndroidAppJournal({ ...appRecord(), operation: 'remove-forward' })).toBe('invalid');
  expect(inspectAndroidAppJournal({ ...appRecord(), operation: 'installed', forward })).toBe('invalid');
  expect(inspectAndroidAppJournal({ ...appRecord(), operation: 'running', forward: { hostPort: 0, devicePort: 34567 } })).toBe('invalid');
});

it('recognizes structurally valid v2 app and v1 permission records as legacy, not restorable', () => {
  const app = appRecord(); app.version = 2; delete (app as Partial<typeof app>).leaseKey; delete (app as Partial<typeof app>).ownerGeneration;
  const permission = permissionRecord(); permission.version = 1;
  delete (permission as Partial<typeof permission>).leaseKey; delete (permission as Partial<typeof permission>).ownerGeneration;
  delete (permission as Partial<typeof permission>).appSha256; delete (permission as Partial<typeof permission>).appInstalledBySession;
  expect(inspectAndroidAppJournal(app)).toBe('legacy');
  expect(inspectAndroidPermissionJournal(permission)).toBe('legacy');
});

it.each([
  ['invalid UID', () => ({ ...appRecord(), uid: 0 })],
  ['unknown app field', () => ({ ...appRecord(), privatePath: '/tmp/app.apk' })],
  ['unknown permission flag', () => ({ ...permissionRecord(), baseline: [{ permission: 'camera', granted: false,
    userSet: false, userFixed: false, flags: ['ONE_TIME'] }] })],
  ['duplicate permission', () => ({ ...permissionRecord(), declaration: [
    { permission: 'camera', state: 'granted' }, { permission: 'camera', state: 'denied' }] })],
  ['invalid owner generation', () => ({ ...permissionRecord(), ownerGeneration: 'not-a-hash' })],
] as const)('rejects malformed recovery schema: %s', (_name, make) => {
  const value = make();
  expect('version' in value && value.version === 3 ? inspectAndroidAppJournal(value) : inspectAndroidPermissionJournal(value)).toBe('invalid');
});

it.each([
  ['missing desired baseline entry', () => ({ ...permissionRecord(), desired: [] })],
  ['declaration without captured baseline', () => ({ ...permissionRecord(), declaration: [{ permission: 'microphone', state: 'denied' }] })],
  ['desired state conflicts with declaration', () => ({ ...permissionRecord(), desired: permissionRecord().baseline })],
  ['write without named permission', () => { const value = permissionRecord(); delete (value as Partial<typeof value>).permission; return value; }],
  ['write for uncaptured permission', () => ({ ...permissionRecord(), permission: 'microphone' })],
  ['verified write without readback', () => ({ ...permissionRecord(), status: 'verified' })],
  ['verified readback without observation', () => { const value = permissionRecord(); return { ...value, status: 'verified', step: 'readback', permission: undefined }; }],
  ['verified readback conflicts with desired', () => ({ ...permissionRecord(), status: 'verified', step: 'readback', permission: undefined,
    observed: permissionRecord().baseline })],
  ['restored marker without original state', () => ({ ...permissionRecord(), status: 'verified', step: 'readback', permission: undefined,
    observed: permissionRecord().desired, restored: true })],
  ['partial install binding', () => ({ ...permissionRecord(), appSha256: null })],
] as const)('rejects incomplete or contradictory permission evidence: %s', (_name, make) => {
  expect(inspectAndroidPermissionJournal(make())).toBe('invalid');
});

it('accepts verified restoration and omission of a tracked permission only with its original state', () => {
  const value = permissionRecord();
  expect(inspectAndroidPermissionJournal({ ...value, declaration: [], desired: value.baseline, observed: value.baseline,
    status: 'verified', step: 'readback', permission: undefined, restored: true })).toBe('bound');
  expect(inspectAndroidPermissionJournal({ ...value, appSha256: null, appInstalledBySession: null })).toBe('bound');
});
