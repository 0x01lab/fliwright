import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CloudStore, digest } from '../src/CloudStore.js';
import { projectSchema, unresolvedCatalogCommit, type CatalogScanLease, type TestCatalog } from '@fliwright/cloud-protocol';
const clean: Array<() => void> = [];
afterEach(() => { for (const dispose of clean.splice(0).reverse()) dispose(); });
function setup() {
  let now = 100000;
  const root = mkdtempSync(join(tmpdir(), 'project-catalog-'));
  clean.push(() => rmSync(root, { recursive: true, force: true }));
  const store = new CloudStore(join(root, 'db'), () => now);
  clean.push(() => store.close());
  store.configure([], [{ id: 'worker', slots: [] }, { id: 'other', slots: [] }]);
  store.createProject(projectSchema.parse({ id: 'app', name: 'App', repository: 'https://git.example.com/app.git', suites: { smoke: '*.test.ts' }, scenarios: ['clean'] }));
  store.db.prepare("INSERT INTO slots(worker_id,id,device_id,targets) VALUES('worker','slot','phone','[\"app\"]')").run();
  store.setProjectWorkers('app', ['worker'], [], 'admin');
  return { store, advance: (ms: number) => { now += ms; } };
}
const sha = (letter: string) => letter.repeat(40);
function catalog(lease: CatalogScanLease): TestCatalog {
  const file = 'example.test.ts', titlePath = ['nested', 'same'];
  return { catalogId: lease.scan.scanId, projectId: lease.scan.projectId, commit: lease.scan.commit, configRevision: lease.scan.configRevision, createdAt: 100000, status: 'ready', scenarios: [{ name: 'clean', fingerprint: digest('scenario') }], suites: [{ id: 'smoke', pattern: '*.test.ts', files: [file], cases: [0, 1].map(duplicateIndex => ({ caseId: digest(JSON.stringify([file, titlePath, duplicateIndex])), file, titlePath, duplicateIndex })) }], scannerVersion: 'test', fliwrightVersion: 'test' };
}
it('pins each selected branch under its scan lease and keeps the original version on rerun', () => {
  const { store } = setup();
  const oldBranch = 'releases/v1.5.0', newBranch = 'releases/v1.6.0';
  const first = store.createCatalogScan('app', undefined, undefined, oldBranch);
  const second = store.createCatalogScan('app', undefined, undefined, newBranch);
  expect(second.scanId).not.toBe(first.scanId);
  expect(store.createCatalogScan('app', undefined, undefined, oldBranch).scanId).toBe(first.scanId);
  expect(first).toMatchObject({ branch: oldBranch, commit: unresolvedCatalogCommit });
  const oldLease = store.claimCatalogScan('worker')!;
  const oldCatalog = { ...catalog(oldLease), commit: sha('a') };
  expect(() => store.finishCatalogScan('worker', first.scanId, oldLease.token, oldCatalog)).toThrow(/does not match scan/);
  expect(() => store.pinCatalogScanCommit('other', first.scanId, oldLease.token, sha('a'))).toThrow(/lease lost/);
  expect(store.pinCatalogScanCommit('worker', first.scanId, oldLease.token, sha('a'))).toMatchObject({ branch: oldBranch, commit: sha('a') });
  expect(store.pinCatalogScanCommit('worker', first.scanId, oldLease.token, sha('a')).commit).toBe(sha('a'));
  expect(() => store.pinCatalogScanCommit('worker', first.scanId, oldLease.token, sha('b'))).toThrow(/already fixed/);
  expect(store.finishCatalogScan('worker', first.scanId, oldLease.token, { ...oldCatalog, branch: newBranch }).branch).toBe(oldBranch);
  const request = store.submitProject({ projectId: 'app', commit: sha('a'), catalogId: first.scanId, mode: 'suite', suite: 'smoke' }, 'member', 'original');
  expect(request.input).toMatchObject({ commit: sha('a'), source: { branch: oldBranch } });

  const newLease = store.claimCatalogScan('worker')!;
  expect(newLease.scan.scanId).toBe(second.scanId);
  store.pinCatalogScanCommit('worker', second.scanId, newLease.token, sha('b'));
  store.finishCatalogScan('worker', second.scanId, newLease.token, { ...catalog(newLease), commit: sha('b') });
  const advanced = store.createCatalogScan('app', undefined, undefined, oldBranch);
  const advancedLease = store.claimCatalogScan('worker')!;
  store.pinCatalogScanCommit('worker', advanced.scanId, advancedLease.token, sha('c'));
  store.finishCatalogScan('worker', advanced.scanId, advancedLease.token, { ...catalog(advancedLease), commit: sha('c') });
  expect(store.rerun(request.id, 'member', 'rerun')).toMatchObject({ catalogId: first.scanId, input: request.input, source: { kind: 'manual', branch: oldBranch } });

  store.db.prepare("INSERT INTO slots(worker_id,id,device_id,targets) VALUES('worker','second','phone2','[\"app\"]')").run();
  store.recordDeviceInventory('worker', { scannedAt: new Date().toISOString(), devices: ['phone', 'phone2'].map(id => ({ id, name: id, platform: 'ios', kind: 'physical', state: 'online' })), diagnostics: [] });
  store.submitProject({ projectId: 'app', commit: sha('b'), catalogId: second.scanId, mode: 'suite', suite: 'smoke' }, 'member', 'new-version');
  expect(store.claim('worker', 'slot', 'phone')?.request).toMatchObject({ catalogId: first.scanId, input: { commit: sha('a') } });
  expect(store.claim('worker', 'second', 'phone2')?.request).toMatchObject({ catalogId: second.scanId, input: { commit: sha('b') } });
});
it('retains catalogs without scenarios and runs only scenarios discovered in the selected catalog', () => {
  const { store } = setup();
  store.createCatalogScan('app', sha('a'));
  const lease = store.claimCatalogScan('worker')!;
  const value = { ...catalog(lease), scenarios: [] };
  value.suites[0]!.cases[0]!.description = '1. Open Home.\n2. Check the selected tab.';
  store.finishCatalogScan('worker', lease.scan.scanId, lease.token, value);
  expect(store.catalogs('app')[0]?.suites[0]?.cases).toHaveLength(2);
  expect(store.catalogs('app')[0]?.suites[0]?.cases[0]?.description).toBe('1. Open Home.\n2. Check the selected tab.');
  const input = { projectId: 'app', commit: sha('a'), catalogId: value.catalogId, mode: 'suite', suite: 'smoke', scenario: 'clean' };
  expect(() => store.submitProject(input, 'member', 'empty')).toThrow(/Unknown catalog/);

  store.createCatalogScan('app', sha('b'));
  const next = store.claimCatalogScan('worker')!;
  store.finishCatalogScan('worker', next.scan.scanId, next.token, { ...catalog(next), scenarios: [{ name: 'guest', fingerprint: digest('guest') }] });
  expect(store.submitProject({ ...input, commit: sha('b'), catalogId: next.scan.scanId, scenario: 'guest' }, 'member', 'discovered'))
    .toMatchObject({ input: { scenario: 'guest' } });
  expect(() => store.submitProject({ ...input, commit: sha('b'), catalogId: next.scan.scanId }, 'member', 'stale')).toThrow(/Unknown catalog/);
});
it('queues suites and exact cases without scenarios, including catalogs that declare optional scenarios', () => {
  const { store } = setup();
  store.updateProject('app', { ...store.project('app'), scenarios: [] });
  for (const [index, scenarios] of [[], [{ name: 'guest', fingerprint: digest('guest') }]].entries()) {
    const commit = sha(index === 0 ? 'a' : 'b');
    store.createCatalogScan('app', commit);
    const lease = store.claimCatalogScan('worker')!, value = { ...catalog(lease), scenarios };
    store.finishCatalogScan('worker', lease.scan.scanId, lease.token, value);
    const input = { projectId: 'app', commit, catalogId: value.catalogId, suite: 'smoke' };
    const suite = store.submitProject({ ...input, mode: 'suite' }, 'member', `suite-${index}`);
    expect(suite.input).not.toHaveProperty('scenario');
    const exact = store.submitProject({ ...input, mode: 'case', caseId: value.suites[0]!.cases[1]!.caseId }, 'member', `case-${index}`);
    expect(exact.selection).toMatchObject({ mode: 'case', duplicateIndex: 1 });
    expect(exact.selection).not.toHaveProperty('scenario');
    expect(store.rerun(exact.id, 'member', `rerun-${index}`).input).not.toHaveProperty('scenario');
    expect(() => store.submitProject({ ...input, mode: 'suite', scenario: 'missing' }, 'member', `invalid-${index}`)).toThrow(/Unknown catalog/);
  }
});
it('automatically queues and supersedes direct runs without requiring catalog scenarios', () => {
  const { store, advance } = setup();
  store.updateProject('app', { ...store.project('app'), scenarios: [], autoRun: { enabled: true, branch: 'main', selections: [{ suite: 'smoke' }], revision: 1 } });
  const policyRevision = store.project('app').autoRun.revision;
  for (const commit of [sha('a'), sha('b')]) {
    store.createCatalogScan('app', commit, { branch: 'main', deliveryId: commit, policyRevision });
    const lease = store.claimCatalogScan('worker')!;
    store.finishCatalogScan('worker', lease.scan.scanId, lease.token, { ...catalog(lease), scenarios: [] }, commit);
    advance(1);
  }
  expect(store.queue()).toHaveLength(1);
  expect(store.queue()[0]!.input).toMatchObject({ commit: sha('b'), suite: 'smoke' });
  expect(store.queue()[0]!.input).not.toHaveProperty('scenario');
  expect(store.listRequests({ projectId: 'app' }).items.some(item => item.state === 'superseded')).toBe(true);
});
it('fences scan leases independently of device slots, freezes config and retains catalogs', () => {
  const { store, advance } = setup();
  const scan = store.createCatalogScan('app', sha('a'));
  expect(store.claimCatalogScan('other')).toBeNull();
  const lease = store.claimCatalogScan('worker')!;
  expect(lease.scan.scanId).toBe(scan.scanId);
  expect(store.claimCatalogScan('worker')).toBeNull();
  expect((store.db.prepare("SELECT state FROM slots WHERE worker_id='worker'").get() as { state: string }).state).toBe('idle');
  store.updateProject('app', { ...store.project('app'), name: 'New config' });
  expect(lease.project.configRevision).toBe(1);
  expect(() => store.finishCatalogScan('other', scan.scanId, lease.token, catalog(lease))).toThrow(/lease lost/);
  const result = store.finishCatalogScan('worker', scan.scanId, lease.token, catalog(lease));
  expect(result.configRevision).toBe(1);
  expect(store.catalogs('app')).toHaveLength(1);
  expect(() => store.saveCatalog({ ...result, createdAt: 200000 })).toThrow(/immutable/);
  const expiring = store.createCatalogScan('app', sha('b'));
  const expired = store.claimCatalogScan('worker')!;
  advance(31000);
  expect(() => store.heartbeatCatalogScan('worker', expiring.scanId, expired.token)).toThrow(/lease lost/);
  store.claimCatalogScan('worker');
  expect(store.catalogScan('app', expiring.scanId).status).toBe('failed');
});
it('assigns the local checkout only to its scan Worker and holds it until cleanup or recovery', () => {
  const { store } = setup();
  store.db.prepare("INSERT INTO slots(worker_id,id,device_id,targets) VALUES('worker','second','phone2','[\"app\"]'),('other','slot','phone3','[\"app\"]')").run();
  for (const [worker, phones] of [['worker', ['phone', 'phone2']], ['other', ['phone3']]] as const) {
    store.recordDeviceInventory(worker, { scannedAt: new Date().toISOString(), devices: phones.map(id => ({ id, name: id, platform: 'ios', kind: 'physical', state: 'online' })), diagnostics: [] });
  }
  store.createCatalogScan('app', sha('a'));
  const scan = store.claimCatalogScan('worker')!, value = catalog(scan);
  store.finishCatalogScan('worker', scan.scan.scanId, scan.token, value);
  const input = { projectId: 'app', commit: value.commit, catalogId: value.catalogId, mode: 'suite', suite: 'smoke' };
  const first = store.submitProject(input, 'member', 'first');
  const second = store.submit({ targetId: 'app', commit: value.commit, suite: 'smoke' }, 'member', 'second');
  expect(second.catalogId).toBe(value.catalogId);
  expect(store.claim('other', 'slot', 'phone3')).toBeNull();
  const active = store.claim('worker', 'slot', 'phone')!;
  expect(active.request.id).toBe(first.id);
  expect(store.claim('worker', 'second', 'phone2')).toBeNull();
  store.finish(active, { verdict: 'unknown', infrastructure: 'permanent', cleanup: 'failed', publication: 'unavailable' });
  expect(store.claim('worker', 'second', 'phone2')).toBeNull();
  store.recoverSlot('worker', 'slot', 'processes and device reset verified');
  expect(store.claim('worker', 'second', 'phone2')?.request.id).toBe(second.id);
});
it('freezes exact duplicate selection and makes retries independent of subsequent config edits', () => {
  const { store } = setup();
  store.createCatalogScan('app', sha('a'));
  const lease = store.claimCatalogScan('worker')!, value = catalog(lease);
  store.finishCatalogScan('worker', lease.scan.scanId, lease.token, value);
  const input = { projectId: 'app', commit: sha('a'), catalogId: value.catalogId, mode: 'case', suite: 'smoke', scenario: 'clean', caseId: value.suites[0]!.cases[1]!.caseId };
  const request = store.submitProject(input, 'member', 'key');
  expect(request.selection?.duplicateIndex).toBe(1);
  expect(() => store.submitProject(input, 'member', '')).toThrow(/Idempotency/);
  store.updateProject('app', { ...store.project('app'), entry: 'lib/new.dart' });
  expect(store.submitProject(input, 'member', 'key')).toEqual(request);
  expect(store.getRequest(request.id).target.entry).toBe('lib/main.dart');
  expect(() => store.submitProject(input, 'member', 'new-key')).toThrow(/revision/);
  expect(() => store.submitProject({ ...input, suite: 'toString' }, 'member', 'prototype')).toThrow(/Unknown/);
  expect(() => store.deleteProject('app')).toThrow(/active/);
});
it('allows unbound target submissions and binds only when a project ID is provided', () => {
  const { store } = setup();
  const request = store.submit({ targetId: 'app', commit: sha('a'), suite: 'smoke', scenario: 'clean' }, 'member', 'legacy');
  expect(request).not.toHaveProperty('projectId');
  expect(request).toMatchObject({ selection: { mode: 'suite', suite: 'smoke', scenario: 'clean' }, source: { kind: 'manual' } });
  expect(store.listRequests({ projectId: 'app' }).items.map(item => item.id)).not.toContain(request.id);
  expect(store.listRequests({ targetId: 'app' }).items.map(item => item.id)).toContain(request.id);
  const rerun = store.rerun(request.id, 'member', 'rerun');
  expect(rerun).not.toHaveProperty('projectId');
  const bound = store.submit({ targetId: 'app', commit: sha('b'), suite: 'smoke', scenario: 'clean' }, 'member', 'bound', 'app');
  expect(bound).toMatchObject({ projectId: 'app', configRevision: 1 });
  expect(() => store.submit({ targetId: 'app', commit: sha('b'), suite: 'smoke', scenario: 'clean' }, 'member', 'bound'))
    .toThrow(/Idempotency conflict/);
  expect(store.listRequests({ projectId: 'app' }).items.map(item => item.id)).toContain(bound.id);
  expect(() => store.submit({ targetId: 'app', commit: sha('c'), suite: 'smoke', scenario: 'clean' }, 'member', 'unknown-project', 'missing'))
    .toThrow(/Project not found/);
});
it('coalesces only queued auto requests, deduplicates commit/policy and ignores delayed old HEAD', () => {
  const { store, advance } = setup();
  store.updateProject('app', { ...store.project('app'), autoRun: { enabled: true, branch: 'main', selections: [{ suite: 'smoke', scenario: 'clean' }], revision: 1 } });
  const policyRevision = store.project('app').autoRun.revision;
  const push = (commit: string, deliveryId: string, head = commit) => {
    store.createCatalogScan('app', commit, { branch: 'main', deliveryId, policyRevision });
    const lease = store.claimCatalogScan('worker')!;
    store.finishCatalogScan('worker', lease.scan.scanId, lease.token, catalog(lease), head);
    advance(1);
  };
  push(sha('a'), 'one');
  const first = store.queue()[0]!;
  expect(first.state).toBe('queued');
  const manual = store.submitProject({ projectId: 'app', commit: sha('a'), mode: 'suite', suite: 'smoke', scenario: 'clean' }, 'member', 'manual');
  push(sha('b'), 'two');
  expect(store.getRequest(first.id)).toMatchObject({ state: 'superseded', supersededBy: expect.any(String) });
  expect(store.getRequest(manual.id).state).toBe('queued');
  expect(store.queue()).toHaveLength(2);
  push(sha('b'), 'duplicate-different-delivery');
  expect(store.queue()).toHaveLength(2);
  push(sha('a'), 'delayed', sha('b'));
  expect(store.branchHead('app', 'main')?.commit).toBe(sha('b'));
  expect(store.queue()).toHaveLength(2);
});
it('publishes discovery even when an automatic policy references a removed repository scenario', () => {
  const { store } = setup();
  store.updateProject('app', { ...store.project('app'), autoRun: { enabled: true, branch: 'main', selections: [{ suite: 'smoke', scenario: 'clean' }], revision: 1 } });
  store.createCatalogScan('app', sha('a'), { branch: 'main', deliveryId: 'removed-scenario', policyRevision: store.project('app').autoRun.revision });
  const lease = store.claimCatalogScan('worker')!;
  store.finishCatalogScan('worker', lease.scan.scanId, lease.token, { ...catalog(lease), scenarios: [] }, sha('a'));
  expect(store.catalogScan('app', lease.scan.scanId).status).toBe('ready');
  expect(store.catalogs('app')[0]?.scenarios).toEqual([]);
  expect(store.queue()).toHaveLength(0);
});
it('rejects result identity/path/size violations, cancellation and obsolete policies', () => {
  const { store } = setup();
  store.createCatalogScan('app', sha('a'));
  const lease = store.claimCatalogScan('worker')!;
  expect(() => store.finishCatalogScan('worker', lease.scan.scanId, lease.token, { ...catalog(lease), commit: sha('b') })).toThrow(/match scan/);
  const invalid = catalog(lease); invalid.suites[0]!.cases[0]!.file = '../escape.ts';
  expect(() => store.finishCatalogScan('worker', lease.scan.scanId, lease.token, invalid)).toThrow();
  store.cancelCatalogScan('app', lease.scan.scanId);
  expect(() => store.finishCatalogScan('worker', lease.scan.scanId, lease.token, catalog(lease))).toThrow(/lease lost/);
  store.updateProject('app', { ...store.project('app'), autoRun: { enabled: true, branch: 'main', selections: [{ suite: 'smoke', scenario: 'clean' }], revision: 1 } });
  store.createCatalogScan('app', sha('b'), { branch: 'main', deliveryId: 'old-policy', policyRevision: store.project('app').autoRun.revision });
  const old = store.claimCatalogScan('worker')!;
  store.updateProject('app', { ...store.project('app'), autoRun: { ...store.project('app').autoRun, enabled: false } });
  store.finishCatalogScan('worker', old.scan.scanId, old.token, catalog(old), sha('b'));
  expect(store.queue()).toHaveLength(0);
});
