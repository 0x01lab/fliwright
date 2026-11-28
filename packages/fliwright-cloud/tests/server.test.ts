import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CloudStore, digest } from '../src/CloudStore.js';
import { createCloudServer } from '../src/server.js';
import { WorkerControlClient, CloudError } from '@fliwright/cloud-protocol';
async function workerRpc(server: ReturnType<typeof createCloudServer>, token: string, path: string, body: unknown) {
  if (!server.server.listening) await server.listen({ host: '127.0.0.1', port: 0 });
  const address = server.server.address() as import('node:net').AddressInfo;
  const client = new WorkerControlClient(`http://127.0.0.1:${address.port}`, token);
  try {
    const data = await client.request(path, { body });
    return { statusCode: 200, json: () => data as any };
  } catch (error) {
    return { statusCode: error instanceof CloudError ? error.statusCode : 401, json: () => ({}) as any };
  } finally { client.close(); }
}
const clean: Array<() => Promise<unknown> | void> = [];
afterEach(async () => {
  for (const f of clean.splice(0).reverse()) await f();
});
function setup(project: Record<string, unknown> = {}) {
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
        ...project,
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
    repositoryHosts: ['git.example.com'],
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
it('serves independently sized board columns with full filtered counts and global queue ranks', async () => {
  const { server, store, browser } = setup();
  const ids = Array.from({length:8}, (_,i) => store.submit({targetId:'app', suite:'smoke',commit:String(i).repeat(40)},'alice',`board-${i}`).id);
  for (const [i,id] of ids.entries()) {
    const r = store.getRequest(id);
    if (i === 5) r.selection = { mode: 'case', suite: 'smoke', caseId: 'case', titlePath: ['Checkout', '确认支付'] };
    r.verdict = i===3?'failed':'passed';
    r.state = i<3?'queued':i===3?'finalizing':'completed';
    store.db.prepare('UPDATE requests SET state=?,queued_at=?,data=? WHERE id=?').run(r.state,8-i,JSON.stringify(r),id);
  }
  const read = async (query:string) => (await server.inject({url:`/api/board?${query}`,headers:browser()})).json();
  const page = await read('pending=2&passed=1');
  expect(page.totals).toEqual({pending:3,running:1,passed:4,failed:0,other:0});
  expect(page.queue).toEqual(ids.slice(0,3).reverse());
  expect(page.items.filter((r:{state:string})=>r.state==='queued').map((r:{id:string})=>r.id)).toEqual([ids[2],ids[1]]);
  expect(page.items).toHaveLength(4);
  expect(page.items[0]).not.toHaveProperty('target');
  expect(page.items[0]).not.toHaveProperty('repository');
  expect((await read('pending=2&passed=4')).items).toHaveLength(7);
  expect((await read(`search=${ids[0]}`)).totals.pending).toBe(1);
  expect((await read('search=SMOKE')).totals).toEqual(page.totals);
  expect((await read(`search=${encodeURIComponent('checkout › 确认')}`)).items.map((r: { id: string }) => r.id)).toEqual([ids[5]]);
  expect((await read('search=checkout&targetId=other')).items).toEqual([]);
  expect((await server.inject({url:'/api/board',headers:{authorization:'Bearer ci-token'}})).statusCode).toBe(403);
  const { json: totals } = await server.inject({ url: '/api/board/totals?targetId=app', headers: browser() });
  expect(totals()).toEqual(page.totals);
  expect((await server.inject({ url: '/api/board/totals?targetId=other', headers: browser() })).json())
    .toEqual({ pending: 0, running: 0, passed: 0, failed: 0, other: 0 });
  expect((await server.inject({ url: '/api/board/totals', headers: { authorization: 'Bearer ci-token' } })).statusCode).toBe(403);
});

it('lists published, unexpired reports and applies the project filter before pagination', async () => {
  const { server, store, browser } = setup();
  const sha = 'a'.repeat(40);
  const request = store.submit({ targetId: 'app', suite: 'smoke', commit: sha }, 'alice', 'report-list');
  const now = store.now();
  const insert = store.db.prepare('INSERT INTO publications(id,attempt_id,request_id,state,created_at,expires_at,data) VALUES(?,?,?,?,?,?,?)');
  for (const [i, state] of ['published', 'published', 'staging', 'published'].entries()) {
    insert.run(`report-${i}`, `attempt-${i}`, request.id, state, now + i, now + (i === 3 ? -1 : 60000), '{}');
  }
  const result = await server.inject({ url: '/api/reports', headers: browser() });
  expect(result.statusCode).toBe(200);
  expect(result.json()).toEqual({ hasMore: false, items: [1, 0].map(i => ({
    id: `report-${i}`, title: 'smoke', sha, projectName: 'App', createdAt: now + i,
  })) });
  const other = { ...request, id: 'other-request', input: { ...request.input, targetId: 'other' } };
  store.db.prepare(`INSERT INTO requests (id, actor, idem, fingerprint, created_at, queued_at, state, data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(other.id, 'alice', 'other-report', '', now, now, other.state, JSON.stringify(other));
  for (let index = 0; index < 26; index++) {
    insert.run(`other-${index}`, `other-attempt-${index}`, other.id, 'published', now + 10 + index, now + 60000, '{}');
  }
  const project = await server.inject({ url: '/api/reports?targetId=app&offset=1', headers: browser() });
  expect(project.json()).toEqual({ hasMore: false, items: [result.json().items[1]] });
  const otherPage = await server.inject({ url: '/api/reports?targetId=other&offset=25', headers: browser() });
  expect(otherPage.json()).toMatchObject({ hasMore: false, items: [{ id: 'other-0' }] });
  expect((await server.inject({ url: '/api/reports', headers: { authorization: 'Bearer ci-token' } })).statusCode).toBe(403);
  expect((await server.inject({ url: '/api/reports' })).statusCode).toBe(401);
});

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
    workerRpc(server, token, '/api/worker/devices', payload);
  expect((await send('ci-token')).statusCode).toBe(401);
  expect((await server.inject({ method: 'POST', url: '/api/worker/devices', headers: browser('admin'), payload: inventory })).statusCode).toBe(404);
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
it('manages projects with admin writes, monotonic revisions, case catalog checks and signed push deduplication', async () => {
  const { server, store, browser } = setup();
  const create = (headers: Record<string, string>, payload: unknown) => server.inject({ method: 'POST', url: '/api/projects', headers, payload });
  const project = {
    id: 'web', name: 'Web', repository: 'https://git.example.com/team/web.git', defaultBranch: 'main', projectPath: '.', entry: 'lib/main.dart',
    suites: { smoke: '.fliwright/tests/smoke.test.ts' }, scenarios: ['clean'], requiredCapabilities: [], install: [], flutterArgs: [], timeoutMs: 60000,
    configRevision: 1, repositoryCredentialRef: null, webhookSecretDigest: null, webhookStatus: 'disabled',
    autoRun: { enabled: false, branch: 'main', selections: [{ suite: 'smoke', scenario: 'clean' }], revision: 1 },
  };
  const { id: _id, configRevision: _revision, webhookSecretDigest: _secret, webhookStatus: _status, autoRun: _policy, ...creation } = project;
  expect((await create(browser(), creation)).statusCode).toBe(403);
  expect((await create(browser('admin'), { ...creation, repository: 'https://localhost/team/web.git' })).statusCode).toBe(400);
  expect((await create(browser('admin'), { ...creation, repository: 'https://[fc00::1]/team/web.git' })).statusCode).toBe(400);
  const response = await create(browser('admin'), creation);
  expect(response.statusCode).toBe(201);
  const id = response.json().id;
  expect(id).toMatch(/^project-[a-f0-9]{24}$/);
  const created = (await server.inject({ url: `/api/projects/${id}`, headers: browser() })).json();
  expect(created).not.toHaveProperty('webhookSecretDigest');
  const update = await server.inject({ method: 'PUT', url: `/api/projects/${id}`, headers: browser('admin'), payload: { ...project, id, name: 'Web App' } });
  expect(update.json()).toMatchObject({ name: 'Web App', configRevision: 2, autoRun: { revision: 1 } });
  const scan = await server.inject({ method: 'POST', url: `/api/projects/${id}/scans`, headers: browser('ops'), payload: { commit: 'c'.repeat(40) } });
  expect(scan.json()).toMatchObject({ status: 'queued', configRevision: 2 });
  const scanBranch = (payload: Record<string, string>) => server.inject({ method: 'POST', url: `/api/projects/${id}/scans`, headers: browser('ops'), payload });
  expect((await scanBranch({ branch: 'releases/v1.6.0' })).json()).toMatchObject({ status: 'queued', branch: 'releases/v1.6.0' });
  expect((await scanBranch({ branch: 'releases/*' })).statusCode).toBe(400);
  expect((await scanBranch({ branch: 'main', commit: 'a'.repeat(40) })).statusCode).toBe(400);
  await server.inject({ method: 'PUT', url: `/api/projects/${id}/auto-run`, headers: browser('admin'), payload: { enabled: true, branch: 'main', selections: [{ suite: 'smoke', scenario: 'clean' }] } });
  const token = (await server.inject({ method: 'POST', url: `/api/projects/${id}/webhook-secret`, headers: browser('admin') })).json().token;
  const push = { object_kind: 'push', ref: 'refs/heads/main', checkout_sha: 'd'.repeat(40), before: 'e'.repeat(40), after: 'd'.repeat(40), project: { id: 1, web_url: 'https://git.example.com/team/web' } };
  const webhook = (delivery: string) => server.inject({ method: 'POST', url: `/api/webhooks/gitlab/${id}`, headers: { 'x-gitlab-token': token, 'x-gitlab-event': 'Push Hook', 'x-gitlab-event-uuid': delivery }, payload: push });
  expect((await webhook('delivery-1')).statusCode).toBe(202);
  expect((await webhook('delivery-1')).json()).toMatchObject({ accepted: true, duplicate: true });
  expect(store.branchHead(id, 'main')).toBeUndefined(); // Remote HEAD is verified by the scan worker.
  expect(store.queue().length).toBe(0);
});
it('approves scenario-free catalogs and accepts direct case and suite runs', async () => {
  const { server, store, browser } = setup();
  const publish = (commit: string, scenarios: Array<{ name: string; fingerprint: string }>) => {
    store.createCatalogScan('app', commit);
    const lease = store.claimCatalogScan('mac')!;
    const file = 'proof.test.ts', titlePath = ['proof'];
    store.finishCatalogScan('mac', lease.scan.scanId, lease.token, {
      catalogId: lease.scan.scanId, projectId: 'app', commit, configRevision: 1,
      status: 'ready', createdAt: Date.now(), scannerVersion: 'test', fliwrightVersion: 'test', scenarios,
      mocks: [{ directory: '.fliwright/mocks', endpoints: [{ endpoint: '/assets', method: 'GET', rules: ['success', 'empty'], activeRule: 'success' }] }],
      suites: [{ id: 'smoke', pattern: '*.test.ts', files: [file], cases: [{ file, titlePath, duplicateIndex: 0, caseId: digest(JSON.stringify([file, titlePath, 0])) }] }],
    });
  };
  publish('a'.repeat(40), []);
  const status = (await server.inject({ url: '/api/projects/app/status', headers: browser() })).json();
  expect(status.blockers).toEqual(['等待管理员确认项目就绪']);
  expect((await server.inject({ url: '/api/projects/app/catalogs', headers: browser() })).json()[0].suites[0].cases).toHaveLength(1);
  expect((await server.inject({ url: '/api/projects/app/catalogs', headers: browser() })).json()[0].mocks[0].endpoints[0]).toEqual({ endpoint: '/assets', method: 'GET', rules: ['success', 'empty'], activeRule: 'success' });
  expect((await server.inject({ method: 'POST', url: '/api/projects/app/ready', headers: browser('admin'), payload: {} })).statusCode).toBe(200);
  expect((await server.inject({ url: '/api/projects/app/status', headers: browser() })).json().ready).toBe(true);
  const catalog = store.catalogs('app')[0]!;
  let caseRequestId = '';
  for (const mode of ['suite', 'case']) {
    const response = await server.inject({ method: 'POST', url: '/api/projects/app/requests', headers: { ...browser(), 'idempotency-key': `direct-${mode}` }, payload: { projectId: 'app', commit: catalog.commit, catalogId: catalog.catalogId, mode, suite: 'smoke', ...(mode === 'case' ? { caseId: catalog.suites[0]!.cases[0]!.caseId } : {}) } });
    expect(response.statusCode).toBe(201);
    expect(store.getRequest(response.json().id).input).not.toHaveProperty('scenario');
    if (mode === 'case') caseRequestId = response.json().id;
  }
  for (let i = 0; i < 101; i++) {
    store.submitProject({ projectId: 'app', catalogId: catalog.catalogId, commit: catalog.commit, mode: 'suite', suite: 'smoke', source: { kind: 'manual' } }, 'alice', `suite-${i}`);
  }
  const caseRuns = (await server.inject({ url: `/api/projects/app/catalogs/${catalog.catalogId}/case-runs`, headers: browser() })).json();
  expect(caseRuns.items).toEqual([{ id: caseRequestId, suite: 'smoke', caseId: catalog.suites[0]!.cases[0]!.caseId, status: 'queued', createdAt: store.getRequest(caseRequestId).createdAt }]);
  publish('b'.repeat(40), [{ name: 'guest', fingerprint: digest('guest') }]);
  const newer = store.catalogs('app')[0]!;
  expect((await server.inject({ url: `/api/projects/app/catalogs/${newer.catalogId}/case-runs`, headers: browser() })).json().items).toEqual([]);
  expect((await server.inject({ method: 'POST', url: '/api/projects/app/ready', headers: browser('admin'), payload: {} })).statusCode).toBe(200);
  expect((await server.inject({ url: '/api/projects/app/status', headers: browser() })).json().ready).toBe(true);
  const caseId = newer.suites[0]!.cases[0]!.caseId;
  const run = store.submitProject({ projectId: 'app', catalogId: newer.catalogId, commit: newer.commit, mode: 'case', suite: 'smoke', caseId, scenario: 'guest', source: { kind: 'manual' } }, 'alice', 'with-scenario');
  const newerCaseRuns = (await server.inject({ url: `/api/projects/app/catalogs/${newer.catalogId}/case-runs`, headers: browser() })).json();
  expect(newerCaseRuns.items).toEqual([{ id: run.id, suite: 'smoke', caseId, status: 'queued', createdAt: run.createdAt, scenario: 'guest' }]);
});
it('accepts directory-derived suites without a configured suite map', async () => {
  const { server, store, browser } = setup({ suites: {}, suiteMode: 'directories', scenarios: [] });
  const commit = 'f'.repeat(40);
  const pattern = '.fliwright/tests/app/**/*.test.ts';
  const file = '.fliwright/tests/app/nav.test.ts', titlePath = ['nav'];
  store.createCatalogScan('app', commit);
  const lease = store.claimCatalogScan('mac')!;
  store.finishCatalogScan('mac', lease.scan.scanId, lease.token, {
    catalogId: lease.scan.scanId, projectId: 'app', commit, configRevision: 1,
    status: 'ready', createdAt: Date.now(), scannerVersion: 'test', fliwrightVersion: 'test', scenarios: [], mocks: [],
    suites: [{ id: 'app', pattern, files: [file], cases: [{ file, titlePath, duplicateIndex: 0, caseId: digest(JSON.stringify([file, titlePath, 0])) }] }],
  });
  expect((await server.inject({ url: '/api/projects/app/status', headers: browser() })).json().blockers).toEqual(['等待管理员确认项目就绪']);
  expect((await server.inject({ url: '/api/targets', headers: browser() })).json()[0].suites).toEqual(['app']);
  expect((await server.inject({ method: 'POST', url: '/api/projects/app/ready', headers: browser('admin'), payload: {} })).statusCode).toBe(200);
  const catalog = store.catalogs('app')[0]!;
  const request = await server.inject({ method: 'POST', url: '/api/projects/app/requests', headers: { ...browser(), 'idempotency-key': 'directory-suite' }, payload: { projectId: 'app', commit, catalogId: catalog.catalogId, mode: 'suite', suite: 'app' } });
  expect(request.statusCode, JSON.stringify(request.json())).toBe(201);
  expect(store.getRequest(request.json().id).selection).toEqual({ mode: 'suite', suite: 'app', pattern });
  const unknown = await server.inject({ method: 'POST', url: '/api/projects/app/requests', headers: { ...browser(), 'idempotency-key': 'directory-unknown' }, payload: { projectId: 'app', commit, catalogId: catalog.catalogId, mode: 'suite', suite: 'unknown' } });
  expect(unknown.statusCode).toBe(400);
});
it('creates a project from only its repository URL and keeps identifiers server generated', async () => {
  const { server, browser } = setup();
  const create = (payload: unknown) => server.inject({ method: 'POST', url: '/api/projects', headers: browser('admin'), payload });
  const first = await create({ repository: ' https://git.example.com/group/subgroup/my-app.git/ ' });
  expect(first.statusCode).toBe(201);
  expect(first.json()).toMatchObject({ name: 'my-app', repository: 'https://git.example.com/group/subgroup/my-app.git', defaultBranch: 'main', projectPath: '.', entry: 'lib/main.dart', suites: {}, suiteMode: 'directories', scenarios: [], autoRun: { enabled: false, branch: 'main' } });
  const second = await create({ repository: 'git@git.example.com:other/my-app.git', name: 'Custom name', defaultBranch: 'develop' });
  expect(second.statusCode).toBe(201);
  expect(second.json()).toMatchObject({ name: 'Custom name', repository: 'ssh://git@git.example.com/other/my-app.git', defaultBranch: 'develop', autoRun: { branch: 'develop' } });
  expect(second.json().id).not.toBe(first.json().id);
  expect((await create({ repository: 'https://git.example.com/group/app', id: 'chosen-by-client' })).statusCode).toBe(400);
  expect((await create({ repository: 'https://git.example.com/group/app/-/issues' })).statusCode).toBe(400);
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
  const unboundRequests = await server.inject({ url: '/api/requests?projectId=app', headers: browser() });
  expect(unboundRequests.json().items.map((item: { id: string }) => item.id)).not.toContain(id);
  const legacyFilter = await server.inject({ url: '/api/requests?targetId=app', headers: browser() });
  expect(legacyFilter.json().items.map((item: { id: string }) => item.id)).toContain(id);
  const bound = await server.inject({ method: 'POST', url: '/api/requests', headers: { ...browser(), 'idempotency-key': 'bound-key' }, payload: { ...input, projectId: 'app' } });
  expect(bound.statusCode).toBe(201);
  const projectRequests = await server.inject({ url: '/api/requests?projectId=app', headers: browser() });
  expect(projectRequests.json().items).toEqual(expect.arrayContaining([expect.objectContaining({ id: bound.json().id, projectId: 'app' })]));
  expect((await workerRpc(server, 'ci-token', '/api/worker/claim', { slotId: 'ios', deviceId: 'device' })).statusCode).toBe(401);
  const claimed = await workerRpc(server, 'worker-token', '/api/worker/claim', { slotId: 'ios', deviceId: 'device' });
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
