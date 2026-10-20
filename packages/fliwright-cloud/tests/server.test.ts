import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CloudStore, digest } from '../src/CloudStore.js';
import { createCloudServer } from '../src/server.js';
const clean: Array<() => Promise<unknown> | void> = [];
afterEach(async () => {
  for (const f of clean.splice(0).reverse()) await f();
});
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'server-'));
  clean.push(() => rmSync(root, { recursive: true, force: true }));
  const store = new CloudStore(join(root, 'db'));
  clean.push(() => store.close());
  store.configure(
    [
      {
        id: 'app',
        name: 'App',
        repository: '/private',
        suites: { smoke: '*.test.ts' },
        scenarios: ['clean'],
      },
    ],
    [
      {
        id: 'mac',
        slots: [{ id: 'ios', deviceId: 'device', targets: ['app'] }],
      },
    ],
  );
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
  const server = createCloudServer({
    store,
    dataRoot: join(root, 'reports'),
    publicUrl: 'https://cloud.test',
    proxySecret: 'proxy-secret',
    publicationSecret: 'publication-secret',
    users: { alice: 'member', ops: 'operator', admin: 'admin' },
    ciTokens: [{ name: 'gitlab', hash: digest('ci-token') }],
    workerTokens: [{ workerId: 'mac', hash: digest('worker-token') }],
    minFreeBytes: 0,
  });
  clean.push(() => server.close());
  const browser = (user = 'alice', origin = 'https://cloud.test') => ({
    'x-cloud-proxy-secret': 'proxy-secret',
    'x-cloud-user': user,
    origin,
  });
  return { server, store, browser };
}
it('accepts device inventories only from the owning worker and keeps discovery separate from slots', async () => {
  const { server, store, browser } = setup();
  const inventory = {
    scannedAt: '2026-10-19T00:00:00.000Z',
    devices: [
      {
        id: 'unregistered-phone',
        name: 'Pixel',
        platform: 'android',
        kind: 'physical',
        state: 'unauthorized',
      },
    ],
    diagnostics: [
      { source: 'ios-device', code: 'missing-tool', message: 'Xcode missing' },
    ],
  };
  const send = (token: string, payload: unknown = inventory) =>
    server.inject({
      method: 'POST',
      url: '/api/worker/devices',
      headers: { authorization: `Bearer ${token}` },
      payload,
    });
  expect((await send('ci-token')).statusCode).toBe(403);
  expect(
    (
      await server.inject({
        method: 'POST',
        url: '/api/worker/devices',
        headers: browser('admin'),
        payload: inventory,
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (await send('worker-token', { ...inventory, workerId: 'another-worker' }))
      .statusCode,
  ).toBe(400);
  expect(
    (
      await send('worker-token', {
        ...inventory,
        devices: [{ ...inventory.devices[0], state: 'idle' }],
      })
    ).statusCode,
  ).toBe(400);
  expect((await send('worker-token')).statusCode).toBe(200);
  const workers = (
    await server.inject({ url: '/api/workers', headers: browser() })
  ).json();
  expect(workers[0].inventory).toMatchObject({
    ...inventory,
    stale: false,
    receivedAt: expect.any(Number),
  });
  expect(workers[0].slots).toHaveLength(1);
  expect(workers[0].slots[0].deviceId).toBe('device');
  // The last-known snapshot survives disconnection and is explicitly marked stale.
  store.db
    .prepare('UPDATE device_inventories SET received_at=? WHERE worker_id=?')
    .run(Date.now() - 100000, 'mac');
  expect(store.listWorkers()[0].inventory).toMatchObject({
    stale: true,
    devices: inventory.devices,
  });
  expect(
    (await send('worker-token', { ...inventory, devices: [] })).statusCode,
  ).toBe(200);
  expect(store.listWorkers()[0].inventory?.devices).toEqual([]);
});
it('separates proxy, CI and worker identities and protects mutations against CSRF', async () => {
  const { server, browser } = setup();
  expect((await server.inject({ url: '/api/requests' })).statusCode).toBe(401);
  expect(
    (
      await server.inject({
        url: '/api/requests',
        headers: { 'x-cloud-user': 'alice' },
      })
    ).statusCode,
  ).toBe(401);
  expect(
    (await server.inject({ url: '/api/targets', headers: browser() })).json()[0]
      .repository,
  ).toBeUndefined();
  const input = {
    targetId: 'app',
    commit: 'a'.repeat(40),
    suite: 'smoke',
    scenario: 'clean',
  };
  expect(
    (
      await server.inject({
        method: 'POST',
        url: '/api/requests',
        headers: {
          ...browser('alice', 'https://evil.test'),
          'idempotency-key': 'key',
        },
        payload: input,
      })
    ).statusCode,
  ).toBe(403);
  const submitted = await server.inject({
    method: 'POST',
    url: '/api/requests',
    headers: { ...browser(), 'idempotency-key': 'key' },
    payload: input,
  });
  expect(submitted.statusCode).toBe(201);
  const id = submitted.json().id;
  expect(
    (
      await server.inject({
        method: 'POST',
        url: '/api/worker/claim',
        headers: { authorization: 'Bearer ci-token' },
        payload: { slotId: 'ios', deviceId: 'device' },
      })
    ).statusCode,
  ).toBe(403);
  const claimed = await server.inject({
    method: 'POST',
    url: '/api/worker/claim',
    headers: { authorization: 'Bearer worker-token' },
    payload: { slotId: 'ios', deviceId: 'device' },
  });
  expect(claimed.json().request.id).toBe(id);
  expect(
    (
      await server.inject({
        url: '/api/requests',
        headers: { authorization: 'Bearer worker-token' },
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await server.inject({
        method: 'POST',
        url: '/api/workers/mac/pause',
        headers: browser(),
        payload: { paused: true },
      })
    ).statusCode,
  ).toBe(403);
});
it('CI submits idempotently and cannot cancel another actor’s task', async () => {
  const { server, browser } = setup();
  const input = {
    targetId: 'app',
    commit: 'b'.repeat(40),
    suite: 'smoke',
    scenario: 'clean',
  };
  const req = () =>
    server.inject({
      method: 'POST',
      url: '/api/requests',
      headers: {
        authorization: 'Bearer ci-token',
        'idempotency-key': 'pipeline',
      },
      payload: input,
    });
  const first = (await req()).json();
  expect((await req()).json().id).toBe(first.id);
  const other = (
    await server.inject({
      method: 'POST',
      url: '/api/requests',
      headers: { ...browser(), 'idempotency-key': 'own' },
      payload: input,
    })
  ).json();
  expect(
    (
      await server.inject({
        method: 'POST',
        url: `/api/requests/${other.id}/cancel`,
        headers: { authorization: 'Bearer ci-token' },
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (await server.inject({ url: '/api/workers', headers: browser('ops') }))
      .statusCode,
  ).toBe(200);
  expect(
    (
      await server.inject({
        url: `/api/requests/${first.id}/events?after=0`,
        headers: { authorization: 'Bearer ci-token' },
      })
    ).json().events[0].kind,
  ).toBe('submitted');
});

it('serves device details to members, restricts changes to operators and enforces origin and schema', async () => {
  const { server, store, browser } = setup();
  store.recordDeviceInventory('mac', {
    scannedAt: new Date().toISOString(),
    devices: [
      {
        id: 'phone2',
        name: 'Pixel',
        platform: 'android',
        kind: 'physical',
        state: 'online',
      },
    ],
    diagnostics: [],
  });
  const list = await server.inject({ url: '/api/devices', headers: browser() });
  expect(list.statusCode).toBe(200);
  const device = list
    .json()
    .find((d: { nativeId: string }) => d.nativeId === 'phone2');
  const url = `/api/devices/${device.id}`;
  expect(
    (await server.inject({ url, headers: browser() })).json().settings.managed,
  ).toBe(false);
  const payload = {
    alias: 'QA Pixel',
    tags: ['qa'],
    managed: true,
    enabled: true,
    targets: ['app'],
    slotId: 'pixel',
  };
  const put = (headers: Record<string, string>, body = payload) =>
    server.inject({ method: 'PUT', url, headers, payload: body });
  expect((await put(browser())).statusCode).toBe(403);
  expect((await put(browser('ops', 'https://evil.test'))).statusCode).toBe(403);
  expect((await put({ authorization: 'Bearer worker-token' })).statusCode).toBe(
    403,
  );
  expect(
    (await put(browser('ops'), { ...payload, slotId: '../bad' })).statusCode,
  ).toBe(400);
  const saved = await put(browser('ops'));
  expect(saved.statusCode).toBe(200);
  expect(saved.json()).toMatchObject({
    settings: payload,
    ready: false,
    blockers: expect.arrayContaining(['runtime-missing']),
  });
  expect(
    (await server.inject({ url: '/api/devices/absent', headers: browser() }))
      .statusCode,
  ).toBe(404);
});
