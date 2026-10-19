import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CloudStore } from '../src/CloudStore.js';

const directories: string[] = [];
const stores: CloudStore[] = [];
afterEach(() => {
  stores.splice(0).forEach((s) => s.close());
  directories
    .splice(0)
    .forEach((d) => rmSync(d, { recursive: true, force: true }));
});
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'cloud-'));
  directories.push(dir);
  let now = 1000;
  const open = () => {
    const store = new CloudStore(join(dir, 'cloud.db'), () => now);
    stores.push(store);
    return store;
  };
  const store = open();
  store.configure(
    [
      {
        id: 'app',
        name: 'App',
        repository: '/trusted/app',
        projectPath: '.',
        entry: 'lib/main.dart',
        suites: { smoke: '.fliwright/tests/*.test.ts' },
        scenarios: ['clean'],
        requiredCapabilities: [],
        install: [{ program: 'pnpm', args: ['install', '--frozen-lockfile'] }],
      },
    ],
    [
      {
        id: 'mac',
        slots: [{ id: 'ios', deviceId: 'device', targets: ['app'] }],
      },
    ],
  );
  const submit = (key: string) =>
    store.submit(
      {
        targetId: 'app',
        commit: 'a'.repeat(40),
        suite: 'smoke',
        scenario: 'clean',
      },
      'alice',
      key,
    );
  return {
    store,
    open,
    submit,
    advance: () => {
      now += 31000;
    },
  };
}
describe('durable exclusive queue', () => {
  it('reports offline workers without making a busy slot available', () => {
    const { store, submit, advance } = setup();
    submit('health');
    const lease = store.claim('mac', 'ios')!;
    expect(store.listWorkers()[0].health).toBe('healthy');
    advance();
    store.expireLeases();
    expect(store.listWorkers()[0].health).toBe('quarantined');
    expect(() => store.heartbeat(lease, 'running')).toThrow();
  });
  it('retains an already observed test verdict when the worker is lost during publication or cleanup', () => {
    const { store, submit, advance } = setup();
    const request = submit('one');
    const lease = store.claim('mac', 'ios')!;
    store.recordResult(lease, { verdict: 'failed' });
    advance();
    store.expireLeases();
    expect(store.getRequest(request.id)).toMatchObject({
      state: 'infrastructure_failed',
      verdict: 'failed',
    });
    expect(store.attempt(lease.attemptId).result).toEqual({
      verdict: 'failed',
    });
  });
  it('persists FIFO and idempotency across restart, refusing conflicting payloads', () => {
    const { store, open, submit } = setup();
    const first = submit('one');
    const second = submit('two');
    expect(submit('one').id).toBe(first.id);
    expect(() =>
      store.submit(
        {
          targetId: 'app',
          commit: 'b'.repeat(40),
          suite: 'smoke',
          scenario: 'clean',
        },
        'alice',
        'one',
      ),
    ).toThrow(/conflict/i);
    const peer = open();
    expect(peer.claim('mac', 'ios')?.request.id).toBe(first.id);
    expect(store.claim('mac', 'ios')).toBeNull();
    expect(
      peer.listRequests({ state: 'queued' }).items.map((r) => r.id),
    ).toEqual([second.id]);
  });
  it('quarantines expired leases and fences old heartbeats until verified reset', () => {
    const { store, submit, advance } = setup();
    submit('one');
    submit('two');
    const lease = store.claim('mac', 'ios')!;
    advance();
    store.expireLeases();
    expect(store.claim('mac', 'ios')).toBeNull();
    expect(() => store.heartbeat(lease, 'running')).toThrow(/lease/i);
    expect(store.getRequest(lease.request.id).state).toBe(
      'infrastructure_failed',
    );
    store.recoverSlot('mac', 'ios', 'reset verified');
    const next = store.claim('mac', 'ios')!;
    expect(next.generation).toBeGreaterThan(lease.generation);
    expect(next.request.id).not.toBe(lease.request.id);
  });
  it('cancels queued work immediately, but releases running work only after cleanup', () => {
    const { store, submit } = setup();
    const a = submit('one');
    const b = submit('two');
    const lease = store.claim('mac', 'ios')!;
    store.cancel(b.id, 'alice');
    expect(store.getRequest(b.id).state).toBe('cancelled');
    store.cancel(a.id, 'alice');
    expect(store.heartbeat(lease, 'running').cancelRequested).toBe(true);
    expect(store.claim('mac', 'ios')).toBeNull();
    store.finish(lease, {
      verdict: 'interrupted',
      cleanup: 'failed',
      publication: 'unavailable',
    });
    expect(store.getRequest(a.id).state).toBe('cancelled');
    expect(store.listWorkers()[0].slots[0].state).toBe('quarantined');
  });
  it('keeps test verdict separate from publishing/cleanup and retries only transient infra once', () => {
    const { store, submit } = setup();
    const a = submit('one');
    const lease = store.claim('mac', 'ios')!;
    store.finish(lease, {
      verdict: 'failed',
      cleanup: 'clean',
      publication: 'publish_failed',
    });
    expect(store.getRequest(a.id)).toMatchObject({
      state: 'completed',
      verdict: 'failed',
    });
    expect(store.claim('mac', 'ios')).toBeNull();
    const b = submit('two');
    store.finish(store.claim('mac', 'ios')!, {
      verdict: 'unknown',
      cleanup: 'clean',
      publication: 'unavailable',
      infrastructure: 'transient',
    });
    const retry = store.claim('mac', 'ios')!;
    expect(retry.request.id).toBe(b.id);
    store.finish(retry, {
      verdict: 'unknown',
      cleanup: 'clean',
      publication: 'unavailable',
      infrastructure: 'transient',
    });
    expect(store.getRequest(b.id).state).toBe('infrastructure_failed');
    expect(store.attempts(b.id)).toHaveLength(2);
  });
  it('validates registered selections and scopes submission keys by identity', () => {
    const { store, submit } = setup();
    const a = submit('one');
    expect(() =>
      store.submit(
        { targetId: 'app', commit: 'main', suite: 'smoke', scenario: 'clean' },
        'alice',
        'bad',
      ),
    ).toThrow();
    expect(() =>
      store.submit(
        {
          targetId: 'app',
          commit: 'a'.repeat(40),
          suite: 'arbitrary',
          scenario: 'clean',
        },
        'alice',
        'bad',
      ),
    ).toThrow();
    expect(store.submit(a.input, 'bob', 'one').id).not.toBe(a.id);
    expect(store.events(a.id, 0)[0].kind).toBe('submitted');
  });
});
