import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CloudStore } from '../src/CloudStore.js';
import { createCloudServer } from '../src/server.js';
import { WorkerControlClient } from '@fliwright/cloud-protocol';
import { digest } from '../src/CloudStore.js';

const cleanup: Array<() => unknown> = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
async function setup() {
  const root = mkdtempSync(join(tmpdir(), 'cloud-diagnostics-')); cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const store = new CloudStore(join(root, 'db')); cleanup.push(() => store.close());
  store.configure([], [{ id: 'mac', slots: [] }, { id: 'other', slots: [] }]);
  const server = createCloudServer({ store, dataRoot: join(root, 'reports'), publicUrl: 'https://cloud.test', proxySecret: 'private-proxy', publicationSecret: 'private-publication', users: { ops: 'operator', member: 'member' }, ciTokens: [], workerTokens: [{ workerId: 'mac', hash: digest('worker-private-token') }], minFreeBytes: 0 });
  cleanup.push(() => server.close());
  const client = new WorkerControlClient(await server.listen({ host: '127.0.0.1', port: 0 }), 'worker-private-token'); cleanup.push(() => client.close());
  return { store, server, client };
}
const sessionId = '11111111-1111-4111-8111-111111111111';
const report = { sessionId, startedAt: new Date().toISOString(), pid: 123, nodeVersion: 'v26.3.0', state: 'healthy', uptimeMs: 1000, rssBytes: 100, eventLoopLagMs: 0, components: {}, logs: [{ sessionId, seq: 1, at: new Date().toISOString(), level: 'error', event: 'executor.failed', message: 'Bearer worker-private-token https://host/secret', slotId: 'ios' }] };
it('persists service diagnostics without an execution lease, deduplicates replay and fences identity', async () => {
  const { store, server, client } = await setup();
  await client.request('/api/worker/diagnostics', { body: report });
  await client.request('/api/worker/diagnostics', { body: report });
  const headers = { 'x-cloud-user': 'ops', 'x-cloud-proxy-secret': 'private-proxy' };
  const response = await server.inject({ url: '/api/workers/mac/diagnostics', headers });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({ sessions: [{ sessionId, status: 'healthy' }], logs: [{ event: 'executor.failed' }] });
  expect(response.json().logs).toHaveLength(1);
  expect(response.body).not.toContain('worker-private-token'); expect(response.body).not.toContain('/secret');
  expect((await server.inject({ url: '/api/workers/other/diagnostics', headers })).json().logs).toEqual([]);
  expect((await server.inject({ url: '/api/workers/mac/diagnostics', headers: { ...headers, 'x-cloud-user': 'member' } })).statusCode).toBe(403);
  await expect(client.request('/api/worker/diagnostics', { body: { ...report, workerId: 'other' } })).rejects.toThrow();
  const now = store.now; store.now = () => now.call(store) + 40000;
  expect((await server.inject({ url: '/api/workers/mac/diagnostics', headers })).json().sessions[0].status).toBe('unreachable');
});
it('retains fatal status across restart and filters logs by level, session and search', async () => {
  const { server, client } = await setup();
  await client.request('/api/worker/diagnostics', { body: { ...report, state: 'failed' } });
  const response = await server.inject({ url: `/api/workers/mac/diagnostics?level=error&search=executor&sessionId=${sessionId}`, headers: { 'x-cloud-user': 'ops', 'x-cloud-proxy-secret': 'private-proxy' } });
  expect(response.json()).toMatchObject({ sessions: [{ status: 'failed' }], logs: [{ event: 'executor.failed' }] });
});
it('bounds persisted history, supports stable cursor paging and expires logs for offline hosts', async () => {
  const { store } = await setup();
  for (let batch = 0; batch < 21; batch++) store.workerDiagnostics.record('mac', { ...report,
    logs: Array.from({ length: 100 }, (_, offset) => ({ ...report.logs[0], seq: batch * 100 + offset + 1 })) });
  expect(Number(store.db.prepare('SELECT count(*) AS count FROM worker_service_logs').get()!.count)).toBe(2000);
  const first = store.workerDiagnostics.view('mac'), second = store.workerDiagnostics.view('mac', { before: first.nextCursor });
  expect(first.logs).toHaveLength(100); expect(second.logs).toHaveLength(100);
  expect(new Set([...first.logs, ...second.logs].map(log => log.id)).size).toBe(200);
  const now = store.now; store.now = () => now.call(store) + 8 * 86400000;
  store.workerDiagnostics.sweep(); expect(store.workerDiagnostics.view('mac').logs).toEqual([]);
});
