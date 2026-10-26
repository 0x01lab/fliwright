import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkerControlClient } from '@fliwright/cloud-protocol';
import { CloudStore, digest } from '../src/CloudStore.js';
import { createCloudServer } from '../src/server.js';
const cleanups: Array<() => unknown> = [];
afterEach(async () => { for (const fn of cleanups.splice(0).reverse()) await fn(); });
async function setup() {
  const root = mkdtempSync(join(tmpdir(), 'worker-pairing-'));
  cleanups.push(() => rmSync(root, { force: true, recursive: true }));
  let now = Date.now();
  const store = new CloudStore(join(root, 'db'), () => now);
  cleanups.push(() => store.close());
  const server = createCloudServer({ store, dataRoot: join(root, 'reports'), publicUrl: 'https://cloud.test', proxySecret: 'proxy', publicationSecret: 'publication', users: { admin: 'admin', member: 'member' }, ciTokens: [{ name: 'ci', hash: digest('ci-token') }], workerTokens: [], minFreeBytes: 0 });
  cleanups.push(() => server.close());
  const url = await server.listen({ host: '127.0.0.1', port: 0 });
  const headers = { 'x-cloud-proxy-secret': 'proxy', 'x-cloud-user': 'admin', origin: 'https://cloud.test' };
  const create = (workerId = 'mac') => server.inject({ method: 'POST', url: '/api/worker-pairings', headers, payload: { workerId } });
  const redeem = (code: string) => server.inject({ method: 'POST', url: '/api/worker/pair', payload: { code } });
  return { root, store, server, url, headers, create, redeem, advance: () => { now += 600001; } };
}
it('pairs once, persists only digests and authenticates WSS without server config changes', async () => {
  const { root, store, server, url, headers, create, redeem } = await setup();
  const created = await create();
  expect(created.statusCode).toBe(200);
  const pairing = created.json();
  expect(pairing).toMatchObject({ workerId: 'mac', state: 'pending' });
  expect(store.listWorkers()).toEqual([]);
  const results = await Promise.all([redeem(pairing.code.toLowerCase().replaceAll('-', '')), redeem(pairing.code)]);
  expect(results.map(r => r.statusCode).sort()).toEqual([200, 400]);
  const { token, workerId } = results.find(r => r.statusCode === 200)!.json();
  expect(workerId).toBe('mac');
  expect(token.length).toBeGreaterThanOrEqual(32);
  expect(store.listWorkers()).toMatchObject([{ id: 'mac', slots: [] }]);
  const status = await server.inject({ url: `/api/worker-pairings/${pairing.id}`, headers });
  expect(status.json()).toMatchObject({ state: 'paired', workerId: 'mac' });
  expect(status.body).not.toContain(token);
  expect(status.body).not.toContain(pairing.code);
  const persisted = JSON.stringify(store.db.prepare('SELECT * FROM worker_pairings').all());
  expect(persisted).not.toContain(token);
  expect(persisted).not.toContain(pairing.code);
  store.db.exec('PRAGMA wal_checkpoint(FULL)');
  const reopened = new CloudStore(join(root, 'db'));
  try { expect(reopened.workerForCredential(digest(token))).toBe('mac'); } finally { reopened.close(); }
  expect(readFileSync(join(root, 'db')).includes(Buffer.from(token))).toBe(false);
  const client = new WorkerControlClient(url, token);
  cleanups.push(() => client.close());
  await client.ready(AbortSignal.timeout(2000));
  await client.request('/api/worker/devices', { body: { scannedAt: new Date().toISOString(), devices: [], diagnostics: [] } });
  expect((await server.inject({ url: '/api/workers', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(403);
  const revoked = await server.inject({ method: 'DELETE', url: `/api/worker-pairings/${pairing.id}`, headers });
  expect(revoked.statusCode).toBe(200);
  await expect(client.request('/api/worker/devices', { body: {} })).rejects.toThrow();
  expect(store.workerForCredential(digest(token))).toBeUndefined();
  const renewed = await create();
  expect(renewed.statusCode).toBe(200);
  expect((await redeem(renewed.json().code)).statusCode).toBe(200);
});
it('restricts creation/status/revocation to browser administrators and protects request origin', async () => {
  const { server, headers, create } = await setup();
  const pairing = (await create()).json();
  for (const auth of [{}, { authorization: 'Bearer ci-token' }, { ...headers, 'x-cloud-user': 'member' }]) {
    for (const [method, url, payload] of [['POST', '/api/worker-pairings', { workerId: 'other' }], ['GET', `/api/worker-pairings/${pairing.id}`, undefined], ['DELETE', `/api/worker-pairings/${pairing.id}`, undefined]] as const) {
      expect((await server.inject({ method, url, payload, headers: auth })).statusCode).toBeGreaterThanOrEqual(401);
    }
  }
  expect((await server.inject({ method: 'POST', url: '/api/worker-pairings', headers: { ...headers, origin: 'https://evil.test' }, payload: { workerId: 'other' } })).statusCode).toBe(403);
  expect((await create()).statusCode).toBe(409);
});
it('rejects expired and cancelled codes without registering a host and rate limits guesses', async () => {
  const { store, server, headers, create, redeem, advance } = await setup();
  const expired = (await create()).json();
  advance();
  expect((await redeem(expired.code)).statusCode).toBe(400);
  const pending = (await create()).json();
  await server.inject({ method: 'DELETE', url: `/api/worker-pairings/${pending.id}`, headers });
  expect((await redeem(pending.code)).statusCode).toBe(400);
  expect(store.listWorkers()).toEqual([]);
  let last = 0;
  for (let i = 0; i < 35; i++) last = (await redeem('AAAA-BBBB-CCCC-DDDD-EEEE')).statusCode;
  expect(last).toBe(429);
});

it('rotates a host credential atomically when pairing the same Worker again', async () => {
  const { create, redeem, store } = await setup();
  const first = await redeem((await create()).json().code);
  const second = await redeem((await create()).json().code);
  const firstToken = first.json().token as string;
  const secondToken = second.json().token as string;
  expect(store.workerForCredential(digest(firstToken))).toBeUndefined();
  expect(store.workerForCredential(digest(secondToken))).toBe('mac');
});
