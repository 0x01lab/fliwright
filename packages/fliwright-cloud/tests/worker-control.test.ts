import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { WorkerControlClient, type ExecutionLease } from '@fliwright/cloud-protocol';
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
  const server = createCloudServer({ store, dataRoot: join(root, 'reports'), publicUrl: 'https://cloud.test', proxySecret: 'proxy', publicationSecret: 'publication', users: {}, ciTokens: [{ name: 'ci', hash: digest('ci-token') }], workerTokens: [{ workerId: 'mac', hash: digest('worker-token') }], minFreeBytes: 0 });
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
