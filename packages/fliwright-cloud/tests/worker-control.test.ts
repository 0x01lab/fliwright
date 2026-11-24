import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { WorkerControlClient, type CatalogScanLease, type ExecutionLease } from '@fliwright/cloud-protocol';
import { CloudStore, digest } from '../src/CloudStore.js';
import { createCloudServer } from '../src/server.js';

const cleanup: Array<() => unknown> = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
async function setup() {
  const root = mkdtempSync(join(tmpdir(), 'worker-control-'));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const store = new CloudStore(join(root, 'db'));
  cleanup.push(() => store.close());
  store.configure([{ id: 'app', name: 'App', repository: '/synthetic', suites: { smoke: '*.test.ts' }, scenarios: ['clean'] }],
    [{ id: 'mac', catalogProjects: ['app'], slots: [{ id: 'ios', deviceId: 'device', targets: ['app'] }] }]);
  store.recordDeviceInventory('mac', { scannedAt: new Date().toISOString(), devices: [{ id: 'device', name: 'Phone', platform: 'ios', kind: 'physical', state: 'online' }], diagnostics: [] });
  const server = createCloudServer({ store, dataRoot: join(root, 'reports'), publicUrl: 'https://cloud.test', proxySecret: 'proxy', publicationSecret: 'publication', users: { admin: 'admin', operator: 'operator' }, ciTokens: [{ name: 'ci', hash: digest('ci-token') }], workerTokens: [{ workerId: 'mac', hash: digest('worker-token') }], minFreeBytes: 0 });
  cleanup.push(() => server.close());
  const peers = new Set<import('node:net').Socket>();
  server.server.on('connection', socket => { peers.add(socket); socket.on('close', () => peers.delete(socket)); });
  const url = await server.listen({ host: '127.0.0.1', port: 0 });
  const client = new WorkerControlClient(url, 'worker-token', { reconnectMs: 10 });
  cleanup.push(() => client.close());
  return { store, server, url, client, peers };
}
it('wakes an idle Worker on submission and pushes cancellation over the authenticated socket', async () => {
  const { store, client, server } = await setup();
  await client.ready();
  const revision = client.revision;
  expect(await client.request('/api/worker/claim', { body: { slotId: 'ios', deviceId: 'device' } })).toBeNull();
  const wake = client.waitForWork(revision, AbortSignal.timeout(2000));
  const request = store.submit({ targetId: 'app', commit: 'a'.repeat(40), suite: 'smoke', scenario: 'clean' }, 'alice', 'key');
  await wake;
  const lease = await client.request<ExecutionLease>('/api/worker/claim', { body: { slotId: 'ios', deviceId: 'device' } });
  expect(lease.request.id).toBe(request.id);
  const cancelled = new Promise<void>((resolve) => client.watchLease(lease, (reason) => { if (reason === 'cancelled') resolve(); }));
  store.cancel(request.id, 'alice');
  await cancelled;
  await expect(client.request('/api/projects')).rejects.toThrow();
  expect((await server.inject({ method: 'POST', url: '/api/worker/claim', payload: {}, headers: { authorization: 'Bearer worker-token' } })).statusCode).toBe(404);
});
it('rejects CI credentials at the WebSocket handshake', async () => {
  const { url } = await setup();
  const wrong = new WorkerControlClient(url, 'ci-token', { reconnectMs: 10 });
  cleanup.push(() => wrong.close());
  await expect(wrong.ready(AbortSignal.timeout(1000))).rejects.toThrow();
});
it('pins a selected branch through the authenticated scan control operation', async () => {
  const { store, client } = await setup();
  const branch = 'releases/v1.6.0';
  const scan = store.createCatalogScan('app', undefined, undefined, branch);
  const lease = await client.request<CatalogScanLease>('/api/worker/scans/claim');
  const body = { scanId: scan.scanId, token: lease.token, commit: 'a'.repeat(40) };
  await expect(client.request('/api/worker/scans/pin', { body })).resolves.toMatchObject({ branch, commit: body.commit });
  await expect(client.request('/api/worker/scans/pin', { body: { ...body, commit: 'b'.repeat(40) } })).rejects.toMatchObject({ statusCode: 409 });
  expect(store.catalogScan('app', scan.scanId).commit).toBe(body.commit);
});
it('pins uploaded secure files to an execution lease and returns only metadata to browser admins', async () => {
  const { server, store, client } = await setup();
  const path = '.env/sentry.dev.json';
  const headers = { 'x-cloud-user': 'admin', 'x-cloud-proxy-secret': 'proxy', origin: 'https://cloud.test' };
  const payload = Buffer.from('{"fixture":"private-file-content"}');
  const upload = (name: string, role = 'admin') => server.inject({ method: 'POST',
    url: `/api/projects/app/secure-files?${new URLSearchParams({ path: name })}`,
    headers: { ...headers, 'x-cloud-user': role, 'content-type': 'application/octet-stream' }, payload });
  expect((await upload('../outside.json')).statusCode).toBe(400);
  expect((await upload(path, 'operator')).statusCode).toBe(403);
  const uploaded = await upload(path);
  expect(uploaded.statusCode).toBe(201);
  const { id } = uploaded.json();
  expect((await upload(path)).statusCode).toBe(409);
  const listed = await server.inject({ url: '/api/projects/app/secure-files', headers });
  expect(listed.json()).toEqual([{ id, path, size: payload.length, createdAt: expect.any(Number) }]);
  const { ciphertext } = store.db.prepare('SELECT ciphertext FROM project_secure_files WHERE id=?').get(id)!;
  expect(Buffer.from(ciphertext as Uint8Array).equals(payload)).toBe(false);
  store.updateProject('app', { ...store.project('app'), flutterArgs: [`--dart-define-from-file=${path}`] });
  const request = store.submit({ targetId: 'app', commit: 'c'.repeat(40), suite: 'smoke' }, 'alice', 'secure-files');
  expect(request.secureFiles).toEqual([{ id, path }]);
  expect(JSON.stringify(request)).not.toContain('private-file-content');
  const remove = () => server.inject({ method: 'DELETE', url: `/api/projects/app/secure-files/${id}`, headers });
  expect((await remove()).statusCode).toBe(409);
  const slot = { slotId: 'ios', deviceId: 'device' };
  expect(await client.request('/api/worker/claim', { body: slot })).toBeNull();
  const lease = await client.request<ExecutionLease>('/api/worker/claim', { body: { ...slot, supportsSecureFiles: true } });
  const key = { workerId: lease.workerId, slotId: lease.slotId, attemptId: lease.attemptId, generation: lease.generation };
  const read = (fileId = id, workerId = key.workerId) => client.request('/api/worker/secure-files/read', { body: { ...key, workerId, fileId } });
  await expect(read(id, 'other')).rejects.toMatchObject({ statusCode: 403 });
  await expect(read('00000000-0000-4000-8000-000000000000')).rejects.toMatchObject({ statusCode: 403 });
  expect(await read()).toEqual({ content: payload.toString('base64'), sha256: digest(payload) });
  store.finish(lease, { verdict: 'passed', cleanup: 'clean', publication: 'unavailable' });
  await expect(read()).rejects.toThrow();
  expect((await remove()).statusCode).toBe(204);
  expect(() => store.rerun(request.id, 'alice', 'retry')).toThrow('secure file');
});
it('only returns assignments belonging to the authenticated host, ignoring a supplied identity', async () => {
  const { store, client } = await setup();
  store.configure([], [{ id: 'other', slots: [] }]);
  const result = await client.request<{ workerId: string; devices: Array<{ workerId: string }> }>('/api/worker/assignments', { body: { workerId: 'other' } });
  expect(result.workerId).toBe('mac');
  expect(result.devices).toHaveLength(1);
  expect(result.devices.every(device => device.workerId === 'mac')).toBe(true);
});
it('only wakes Workers for committed scheduling changes and fresh device transitions', async () => {
  const { store, client } = await setup();
  await client.request('/api/worker/claim', { body: { slotId: 'ios', deviceId: 'device' } });
  const revision = client.revision;
  expect(() => store.transaction(() => {
    store.submit({ targetId: 'app', commit: 'c'.repeat(40), suite: 'smoke', scenario: 'clean' }, 'alice', 'rollback');
    throw new Error('rollback');
  })).toThrow('rollback');
  // A recurring unchanged inventory refresh must not cause idle task claims.
  store.recordDeviceInventory('mac', { scannedAt: new Date().toISOString(), devices: [{ id: 'device', name: 'Phone', platform: 'ios', kind: 'physical', state: 'online' }], diagnostics: [] });
  await delay(30);
  expect(client.revision).toBe(revision);
  expect(store.queue()).toHaveLength(0);
  const wake = client.waitForWork(revision, AbortSignal.timeout(1000));
  store.pauseWorker('mac', false, 'operator');
  await wake;
});
it('pushes cancellation to the Worker holding a catalog scan', async () => {
  const { store, client } = await setup();
  const scan = store.createCatalogScan('app', 'd'.repeat(40));
  const lease = await client.request<{ scan: { scanId: string } }>('/api/worker/scans/claim');
  expect(lease.scan.scanId).toBe(scan.scanId);
  const cancelled = new Promise<void>(resolve => client.watchScan(scan.scanId, resolve));
  store.cancelCatalogScan('app', scan.scanId);
  await cancelled;
});
it('publishes a scan with more than 100 discovered scenarios over Worker control', async () => {
  const { store, client } = await setup();
  const scan = store.createCatalogScan('app', 'b'.repeat(40));
  const lease = await client.request<{ token: string }>('/api/worker/scans/claim');
  const scenarios = Array.from({ length: 330 }, (_, index) => ({ name: `scenario-${index}`, fingerprint: 'a'.repeat(64) }));
  await client.request('/api/worker/scans/result', { body: {
    scanId: scan.scanId, token: lease.token,
    catalog: { catalogId: scan.scanId, projectId: scan.projectId, commit: scan.commit, configRevision: scan.configRevision,
      createdAt: scan.createdAt, status: 'ready', scenarios, suites: [], scannerVersion: 'fixture', fliwrightVersion: 'fixture' },
  } });
  expect(store.catalogs('app')[0]?.scenarios).toEqual(scenarios);
});
it('uses a project binding for both scan and test leases and allows an active run to finish after unbinding', async () => {
  const { store, server, client } = await setup();
  const headers = { 'x-cloud-user': 'admin', 'x-cloud-proxy-secret': 'proxy', origin: 'https://cloud.test' };
  const url = '/api/projects/app/workers';
  const save = (workerIds: string[], expectedWorkerIds: string[], user = 'admin') => server.inject({ method: 'PUT', url, headers: { ...headers, 'x-cloud-user': user }, payload: { workerIds, expectedWorkerIds } });
  expect((await save([], ['mac'], 'operator')).statusCode).toBe(403);
  expect((await save(['missing'], ['mac'])).statusCode).toBe(400);
  expect((await save([], ['mac'])).statusCode).toBe(200);
  expect((await save(['mac'], ['other'])).statusCode).toBe(409);
  const device = store.listDevices()[0];
  store.updateDevice(device.id, { ...device.settings, targets: [] }, 'ops');
  const scan = store.createCatalogScan('app', 'c'.repeat(40));
  const request = store.submit({ targetId: 'app', commit: 'c'.repeat(40), suite: 'smoke', scenario: 'clean' }, 'alice', 'binding');
  const slot = { body: { slotId: 'ios', deviceId: 'device' } };
  expect(await client.request('/api/worker/scans/claim')).toBeNull();
  expect(await client.request('/api/worker/claim', slot)).toBeNull();
  const wake = client.waitForWork(client.revision, AbortSignal.timeout(2000));
  expect((await save(['mac'], [])).json()).toMatchObject([{ id: 'mac', bound: true }]);
  await wake;
  expect(await client.request('/api/worker/scans/claim')).toMatchObject({ scan: { scanId: scan.scanId } });
  const lease = await client.request<ExecutionLease>('/api/worker/claim', slot);
  expect(lease.request.id).toBe(request.id);
  expect((await save([], ['mac'])).statusCode).toBe(200);
  expect(store.workerAssignments('mac').devices).toHaveLength(1);
  expect(store.heartbeat(lease, 'running').cancelRequested).toBe(false);
  store.finish(lease, { verdict: 'passed', cleanup: 'clean', publication: 'unavailable' });
  expect(store.workerAssignments('mac').devices).toEqual([]);
});
it('reports why a catalog scan waits and identifies the Worker that claimed it', async () => {
  const { store, server, client, peers } = await setup();
  store.configure([], [{ id: 'mac', slots: [] }]);
  store.createProject({ id: 'second', name: 'Second', repository: 'https://git.example.com/second.git', suites: { smoke: '*.test.ts' } });
  const scan = store.createCatalogScan('second', 'a'.repeat(40));
  const headers = { authorization: 'Bearer ci-token' };
  const scans = async () => {
    const result = await server.inject({ url: '/api/projects/second/scans', headers });
    expect(result.statusCode).toBe(200);
    return result.json();
  };
  const expectWaiting = async (reason: string, workerIds: string[]) => {
    expect(await scans()).toContainEqual(expect.objectContaining({ scanId: scan.scanId, status: 'queued', queue: { reason, workerIds } }));
  };
  await client.request('/api/worker/assignments');
  await expectWaiting('project_not_assigned', []);

  store.setProjectWorkers('second', ['mac'], [], 'admin');
  await expectWaiting('scanner_disconnected', ['mac']);
  const other = store.createCatalogScan('app', 'b'.repeat(40));
  store.cancelCatalogScan('second', scan.scanId);
  expect(await client.request('/api/worker/scans/claim')).toMatchObject({ scan: { scanId: other.scanId } });
  const next = store.createCatalogScan('second', 'b'.repeat(40));
  expect(await scans()).toContainEqual(expect.objectContaining({ scanId: next.scanId, queue: { reason: 'workers_busy', workerIds: ['mac'] } }));
  expect((await server.inject({ url: '/api/workers', headers })).json()).toMatchObject([
    { id: 'mac', catalogScannerConnected: true, projectIds: ['app', 'second'], activeCatalogScan: { scanId: other.scanId } },
  ]);

  store.cancelCatalogScan('app', other.scanId);
  expect(await scans()).toContainEqual(expect.objectContaining({ scanId: next.scanId, queue: { reason: 'waiting', workerIds: ['mac'] } }));
  expect(await client.request('/api/worker/scans/claim')).toMatchObject({ scan: { scanId: next.scanId } });
  const later = store.createCatalogScan('second', 'c'.repeat(40));
  expect(await scans()).toEqual(expect.arrayContaining([
    expect.objectContaining({ scanId: next.scanId, status: 'running', workerId: 'mac' }),
    expect.objectContaining({ scanId: later.scanId, queue: { reason: 'project_busy', workerIds: ['mac'] } }),
  ]));

  const lost = new Promise<void>(resolve => client.watchScan(next.scanId, resolve));
  for (const peer of peers) peer.destroy();
  await lost;
  expect((await server.inject({ url: '/api/workers', headers })).json()).toMatchObject([{ id: 'mac', catalogScannerConnected: false }]);
  store.cancelCatalogScan('second', next.scanId);
  expect(await scans()).toContainEqual(expect.objectContaining({ scanId: later.scanId, queue: { reason: 'scanner_disconnected', workerIds: ['mac'] } }));
  expect((await server.inject({ url: '/api/workers', headers })).json()[0]).not.toHaveProperty('activeCatalogScan');
});
it('preserves lease fencing and completion semantics over WSS control operations', async () => {
  const { store, client } = await setup();
  const request = store.submit({ targetId: 'app', commit: 'e'.repeat(40), suite: 'smoke', scenario: 'clean' }, 'alice', 'complete');
  const lease = await client.request<ExecutionLease>('/api/worker/claim', { body: { slotId: 'ios', deviceId: 'device' } });
  const key = { workerId: lease.workerId, slotId: lease.slotId, attemptId: lease.attemptId, generation: lease.generation };
  await expect(client.request('/api/worker/heartbeat', { body: { ...key, workerId: 'other', stage: 'running' } })).rejects.toThrow();
  await expect(client.request('/api/worker/heartbeat', { body: { ...key, generation: key.generation + 1, stage: 'running' } })).rejects.toThrow();
  expect(await client.request('/api/worker/heartbeat', { body: { ...key, stage: 'running' } })).toMatchObject({ cancelRequested: false });
  await client.request('/api/worker/result', { body: { ...key, result: { verdict: 'passed' } } });
  expect(await client.request('/api/worker/finish', { body: { ...key, outcome: { verdict: 'passed', cleanup: 'clean', publication: 'unavailable' } } })).toMatchObject({ id: request.id, state: 'completed' });
  expect(store.slot('mac', 'ios')?.state).toBe('idle');
});

it('publishes Worker timeline evidence over WSS and restricts reads to its team request', async () => {
  const { store, client, server } = await setup();
  const request = store.submit({ targetId: 'app', commit: 'a'.repeat(40), suite: 'smoke', scenario: 'clean' }, 'ci:ci', 'timeline');
  const lease = await client.request<ExecutionLease>('/api/worker/claim', { body: { slotId: 'ios', deviceId: 'device' } });
  const key = { workerId: lease.workerId, slotId: lease.slotId, attemptId: lease.attemptId, generation: lease.generation };
  const originAt = '2026-10-21T00:00:00.000Z';
  expect(await client.request('/api/worker/timeline', { body: { ...key, originAt, events: [{
    schemaVersion: 1, seq: 1, offsetMs: 0, recordedAt: originAt,
    payload: { type: 'span.started', spanId: 'launch', phase: 'app.launch' },
  }] } })).toEqual({ ackSeq: 1 });
  const url = `/api/requests/${request.id}/attempts/${lease.attemptId}/worker-timeline`;
  expect((await server.inject({ url, headers: { authorization: 'Bearer worker-token' } })).statusCode).toBe(403);
  const headers = { authorization: 'Bearer ci-token' };
  const view = await server.inject({ url, headers });
  expect(view.statusCode).toBe(200);
  expect(view.json()).toMatchObject({ executionAttemptId: lease.attemptId, spans: [{ phase: 'app.launch', status: 'running' }] });
  expect((await server.inject({ url: `${url}/events?after=0`, headers })).json()).toMatchObject({ nextSeq: 1, hasMore: false });
  const another = store.submit({ targetId: 'app', commit: 'b'.repeat(40), suite: 'smoke', scenario: 'clean' }, 'ci:ci', 'another');
  expect((await server.inject({ url: `/api/requests/${another.id}/attempts/${lease.attemptId}/worker-timeline`, headers })).statusCode).toBe(404);
  expect((await server.inject({ method: 'POST', url: '/api/worker/timeline', headers: { authorization: 'Bearer worker-token' }, payload: key })).statusCode).toBe(404);
});
it('wakes waiting scanners when an expired scan unblocks the project without claim polling', async () => {
  const { store, client } = await setup();
  const old = store.createCatalogScan('app', 'a'.repeat(40));
  await client.request('/api/worker/scans/claim');
  const next = store.createCatalogScan('app', 'b'.repeat(40));
  expect(await client.request('/api/worker/scans/claim')).toBeNull();
  const wake = client.waitForWork(client.revision, AbortSignal.timeout(1000));
  store.db.prepare('UPDATE catalog_scans SET updated_at=? WHERE scan_id=?').run(store.now() - 31000, old.scanId);
  store.expireCatalogScans();
  await wake;
  expect(await client.request('/api/worker/scans/claim')).toMatchObject({ scan: { scanId: next.scanId } });
});
it('reconnects without replaying mutations or taking ownership of an interrupted lease', async () => {
  const { store, client, peers } = await setup();
  store.submit({ targetId: 'app', commit: 'b'.repeat(40), suite: 'smoke', scenario: 'clean' }, 'alice', 'retry');
  const lease = await client.request<ExecutionLease>('/api/worker/claim', { body: { slotId: 'ios', deviceId: 'device' } });
  const lost = new Promise<void>((resolve) => client.watchLease(lease, reason => { if (reason === 'lost') resolve(); }));
  const revision = client.revision;
  // Closing the server-side transport simulates loss after the claim response.
  for (const peer of peers) peer.destroy();
  await lost;
  await client.waitForWork(revision, AbortSignal.timeout(2000));
  await client.ready(AbortSignal.timeout(2000));
  expect(store.getRequest(lease.request.id).attempts).toBe(1);
  expect(store.slot('mac', 'ios')?.state).toBe('busy');
});
