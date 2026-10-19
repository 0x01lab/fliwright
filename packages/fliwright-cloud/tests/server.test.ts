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
        payload: { slotId: 'ios' },
      })
    ).statusCode,
  ).toBe(403);
  const claimed = await server.inject({
    method: 'POST',
    url: '/api/worker/claim',
    headers: { authorization: 'Bearer worker-token' },
    payload: { slotId: 'ios' },
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
