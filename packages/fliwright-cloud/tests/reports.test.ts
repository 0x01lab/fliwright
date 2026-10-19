import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CloudStore, digest } from '../src/CloudStore.js';
import { ReportStore } from '../src/ReportStore.js';
const clean: Array<() => void> = [];
afterEach(() =>
  clean
    .splice(0)
    .reverse()
    .forEach((f) => f()),
);
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'reports-'));
  clean.push(() => rmSync(dir, { recursive: true, force: true }));
  let now = 1000;
  const db = new CloudStore(join(dir, 'db'), () => now);
  clean.push(() => db.close());
  db.configure(
    [
      {
        id: 'app',
        name: 'App',
        repository: '/app',
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
  const r = db.submit(
    {
      targetId: 'app',
      commit: 'a'.repeat(40),
      suite: 'smoke',
      scenario: 'clean',
    },
    'alice',
    'key',
  );
  const lease = db.claim('mac', 'ios')!;
  const files = {
    'run.json': JSON.stringify({
      schemaVersion: 1,
      runId: 'run',
      status: 'failed',
      evidenceStatus: 'partial',
      tests: [
        {
          testId: 'test',
          attempts: [
            { attemptId: 'one', resultPath: 'tests/test/one/result.json' },
          ],
        },
      ],
    }),
    'tests/test/one/result.json': JSON.stringify({
      runId: 'run',
      testId: 'test',
      attemptId: 'one',
      testName: 'fails',
      status: 'failed',
    }),
    'tests/test/one/timeline.json': JSON.stringify({
      version: 2,
      startedAt: '2026-10-19T01:00:00.000Z',
      endedAt: '2026-10-19T01:00:02.000Z',
      nodes: [
        {
          id: 'n',
          title: 'Click',
          status: 'failed',
          kind: 'step',
          startedAt: '2026-10-19T01:00:00.000Z',
          endedAt: '2026-10-19T01:00:02.000Z',
          metadata: { secret: 'hidden' },
          error: { message: 'expected success' },
          artifacts: [],
        },
      ],
    }),
    'tests/test/one/logs/events.jsonl': 'SECRET',
  };
  const input = {
    runId: 'run',
    files: Object.entries(files).map(([path, body]) => ({
      path,
      size: Buffer.byteLength(body),
      sha256: digest(body),
    })),
  };
  const reports = new ReportStore(db, join(dir, 'data'), { minFreeBytes: 0 });
  return {
    db,
    reports,
    lease,
    files,
    input,
    dir,
    request: r,
    advance: () => (now += 31 * 86400000),
  };
}
it('stages resumable files, rejects tampering, commits once and preserves historical evidence', () => {
  const { db, reports, lease, files, input, request } = setup();
  const p = reports.create(lease, input);
  expect(() => reports.view(p.id, true)).toThrow(/not published/i);
  expect(() =>
    reports.put(p.id, p.token, 'run.json', Buffer.from('tampered')),
  ).toThrow(/digest|size/i);
  for (const [path, body] of Object.entries(files))
    reports.put(p.id, p.token, path, Buffer.from(body));
  reports.commit(p.id, p.token);
  reports.commit(p.id, p.token);
  expect(db.attempt(lease.attemptId).bundleId).toBe(p.id);
  db.finish(lease, {
    verdict: 'failed',
    cleanup: 'clean',
    publication: 'published',
  });
  expect(reports.view(p.id, true).manifest.status).toBe('failed');
  expect(
    reports.view(p.id, false).tests[0].timeline.nodes[0].metadata,
  ).toBeUndefined();
  expect(reports.view(p.id, false).tests[0].timeline).toMatchObject({
    startedAt: '2026-10-19T01:00:00.000Z',
    endedAt: '2026-10-19T01:00:02.000Z',
    nodes: [
      {
        startedAt: '2026-10-19T01:00:00.000Z',
        endedAt: '2026-10-19T01:00:02.000Z',
      },
    ],
  });
  expect(() =>
    reports.file(p.id, 'tests/test/one/logs/events.jsonl', false),
  ).toThrow(/scope/i);
  expect(() => reports.create(lease, { ...input, runId: 'other' })).toThrow();
  expect(db.getRequest(request.id).verdict).toBe('failed');
});
it('uploads and retries files within an already reserved storage quota', () => {
  const { db, dir, lease, files, input } = setup();
  const total = input.files.reduce((sum, file) => sum + file.size, 0);
  const reports = new ReportStore(db, join(dir, 'quota-data'), {
    minFreeBytes: 0,
    maxStorageBytes: total,
  });
  const p = reports.create(lease, input);
  for (const [path, body] of Object.entries(files)) {
    reports.put(p.id, p.token, path, Buffer.from(body));
    reports.put(p.id, p.token, path, Buffer.from(body));
  }
  reports.commit(p.id, p.token);
  expect(reports.view(p.id, true).manifest.status).toBe('failed');
  expect(reports.capacity().reservedBytes).toBe(total);
});
it('rejects traversal, unsafe files, duplicate paths and cross-attempt identities', () => {
  const { reports, lease, input, files } = setup();
  for (const path of [
    '../x.json',
    '/x.json',
    'tests/../x.json',
    'a\\x.json',
    'x.html',
    'x.svg',
    'cloud-publication.json',
  ])
    expect(() =>
      reports.create(lease, { ...input, files: [{ ...input.files[0], path }] }),
    ).toThrow();
  expect(() =>
    reports.create(lease, {
      ...input,
      files: [input.files[0], input.files[0]],
    }),
  ).toThrow();
  const bad = JSON.stringify({
    runId: 'other',
    testId: 'test',
    attemptId: 'one',
  });
  files['tests/test/one/result.json'] = bad;
  const i = {
    ...input,
    files: Object.entries(files).map(([path, body]) => ({
      path,
      size: Buffer.byteLength(body),
      sha256: digest(body),
    })),
  };
  const p = reports.create(lease, i);
  for (const [path, body] of Object.entries(files))
    reports.put(p.id, p.token, path, Buffer.from(body));
  expect(() => reports.commit(p.id, p.token)).toThrow(/identity/i);
});
it('recovers committed files without a DB index and refuses symlink reads', () => {
  const { db, reports, lease, input, files, dir } = setup();
  const p = reports.create(lease, input);
  for (const [path, body] of Object.entries(files))
    reports.put(p.id, p.token, path, Buffer.from(body));
  reports.commit(p.id, p.token);
  db.db.prepare("UPDATE publications SET state='staging' WHERE id=?").run(p.id);
  reports.reconcile();
  expect(reports.view(p.id, true).manifest.runId).toBe('run');
  const file = join(dir, 'data', 'bundles', p.id, 'run.json');
  rmSync(file);
  writeFileSync(join(dir, 'outside.json'), 'secret');
  symlinkSync(join(dir, 'outside.json'), file);
  expect(() => reports.file(p.id, 'run.json', true)).toThrow();
});
it('scopes, expires and revokes share sessions, retains tombstones after retention', () => {
  const { db, reports, lease, input, files, advance } = setup();
  const p = reports.create(lease, input);
  for (const [path, body] of Object.entries(files))
    reports.put(p.id, p.token, path, Buffer.from(body));
  reports.commit(p.id, p.token);
  const share = reports.share(p.id, 'alice', 3600000, false);
  const session = reports.exchange(share.token);
  expect(reports.authorizeShare(session.token, p.id).sensitive).toBe(false);
  expect(() => reports.authorizeShare(session.token, 'different')).toThrow();
  reports.revoke(share.id, 'alice');
  expect(() => reports.authorizeShare(session.token, p.id)).toThrow(
    /expired|revoked/i,
  );
  db.finish(lease, {
    verdict: 'failed',
    cleanup: 'clean',
    publication: 'published',
  });
  advance();
  reports.sweep();
  expect(() => reports.view(p.id, true)).toThrow(/expired/i);
});
it('rejects references escaping an attempt and stale upload capabilities after lost ownership', () => {
  const { db, reports, lease, files, input } = setup();
  files['tests/test/one/timeline.json'] = JSON.stringify({
    nodes: [{ artifacts: [{ path: '../../other/screenshot.png' }] }],
  });
  const value = {
    ...input,
    files: Object.entries(files).map(([path, body]) => ({
      path,
      size: Buffer.byteLength(body),
      sha256: digest(body),
    })),
  };
  const p = reports.create(lease, value);
  for (const [path, body] of Object.entries(files))
    reports.put(p.id, p.token, path, Buffer.from(body));
  expect(() => reports.commit(p.id, p.token)).toThrow(/boundary/);
  db.db
    .prepare(
      "UPDATE slots SET generation=generation+1,state='quarantined' WHERE worker_id='mac'",
    )
    .run();
  expect(() =>
    reports.put(p.id, p.token, 'run.json', Buffer.from(files['run.json'])),
  ).toThrow(/lease/);
});
