import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CloudStore, digest } from '../src/CloudStore.js';
import { createCloudServer } from '../src/server.js';
import { WorkerControlClient } from '@fliwright/cloud-protocol';

const cleanup: Array<() => unknown> = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
async function setup() {
  const root = mkdtempSync(join(tmpdir(), 'device-events-'));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  let now = Date.now();
  const store = new CloudStore(join(root, 'db'), () => now);
  cleanup.push(() => store.close());
  store.configure([], [{ id: 'mac', slots: [] }]);
  const server = createCloudServer({ store, dataRoot: join(root, 'reports'), publicUrl: 'https://cloud.test',
    proxySecret: 'proxy', publicationSecret: 'publication', users: { alice: 'member' },
    workerTokens: [{ workerId: 'mac', hash: digest('worker-token') }], ciTokens: [{ name: 'ci', hash: digest('ci-token') }], minFreeBytes: 0 });
  cleanup.push(() => server.close());
  const url = await server.listen({ host: '127.0.0.1', port: 0 });
  const client = new WorkerControlClient(url, 'worker-token');
  cleanup.push(() => client.close());
  const controller = new AbortController();
  cleanup.push(() => controller.abort());
  return { store, server, client, url, controller, advance: (ms: number) => { now += ms; } };
}
const headers = { 'x-cloud-proxy-secret': 'proxy', 'x-cloud-user': 'alice', accept: 'text/event-stream' };

it('pushes device invalidation from Worker WS reports and freshness expiry, and closes active streams on shutdown', async () => {
  const { server, client, url, controller, advance } = await setup();
  const response = await fetch(`${url}/api/device-events`, { headers, signal: controller.signal });
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('text/event-stream');
  const reader = response.body!.getReader();
  const nextEvent = async () => {
    const result = await reader.read();
    expect(result.done).toBe(false);
    expect(new TextDecoder().decode(result.value)).toContain('data:');
  };
  await nextEvent();
  const next = nextEvent();
  await client.request('/api/worker/devices', { body: { scannedAt: new Date().toISOString(), devices: [
    { id: 'phone', name: 'Phone', platform: 'ios', kind: 'physical', state: 'online' },
  ], diagnostics: [] } });
  await next;
  const before = await server.inject({ url: '/api/devices', headers });
  expect(before.json()[0]).toMatchObject({ stale: false, observation: { state: 'online' } });
  const stale = nextEvent();
  advance(90001);
  await stale;
  expect((await server.inject({ url: '/api/devices', headers })).json()[0].stale).toBe(true);
  client.close();
  await server.close();
  expect((await reader.read()).done).toBe(true);
});

it('restricts device subscriptions to authenticated team browsers', async () => {
  const { server } = await setup();
  expect((await server.inject({ url: '/api/device-events' })).statusCode).toBe(401);
  for (const token of ['worker-token', 'ci-token']) {
    expect((await server.inject({ url: '/api/device-events', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(403);
  }
});
