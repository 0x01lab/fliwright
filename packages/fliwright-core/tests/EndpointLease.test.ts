import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EndpointLeaseManager, normalizeEndpoint } from '../src/index.js';

describe('EndpointLeaseManager', () => {
  it('normalizes HTTP and WS VM aliases to one endpoint key', () => {
    expect(normalizeEndpoint('HTTP://LOCALHOST:123')).toBe(normalizeEndpoint('ws://localhost:123/ws/'));
    expect(normalizeEndpoint('https://example.test/app')).toBe(normalizeEndpoint('wss://example.test/app/ws'));
    expect(normalizeEndpoint('http://localhost:123/token=/')).toBe(normalizeEndpoint('ws://localhost:123/token=/ws'));
  });

  it('serializes operations for one endpoint while allowing different endpoints in parallel', async () => {
    const leases = new EndpointLeaseManager();
    const events: string[] = [];
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => { started = resolve; });
    let releaseFirst!: () => void;
    const first = leases.run('HTTP://LOCALHOST:123/ws/', async () => {
      events.push('first:start');
      started();
      await new Promise<void>((resolve) => { releaseFirst = resolve; });
      events.push('first:end');
    });
    await startedPromise;
    const second = leases.run('http://localhost:123/ws', async () => events.push('second'));
    const other = leases.run('ws://other/ws', async () => events.push('other'));
    await other;
    expect(events).toEqual(['first:start', 'other']);
    releaseFirst();
    await Promise.all([first, second]);
    expect(events).toEqual(['first:start', 'other', 'first:end', 'second']);
  });

  it('allows nested acquisition by the current operation without deadlocking', async () => {
    const leases = new EndpointLeaseManager();
    await expect(leases.run('ws://app/ws', async () => {
      await leases.run('ws://app/ws', async () => undefined);
      return 'done';
    })).resolves.toBe('done');
  });

  it('holds an explicitly acquired lease across independent lifecycle callbacks', async () => {
    const leases = new EndpointLeaseManager();
    const scope = await leases.acquire('ws://lifecycle-app/ws');
    const events: string[] = [];
    const waiting = leases.run('ws://lifecycle-app/ws', async () => { events.push('next-test'); });
    await scope.run(async () => {
      await leases.run('ws://lifecycle-app/ws', async () => { events.push('setup'); });
    });
    await scope.run(async () => { events.push('cleanup'); });
    expect(events).toEqual(['setup', 'cleanup']);
    await scope.release();
    await scope.release();
    await waiting;
    expect(events).toEqual(['setup', 'cleanup', 'next-test']);
    await expect(scope.run(async () => undefined)).rejects.toThrow('released');
  });

  it('removes cancelled waiters without acquiring later or blocking subsequent work', async () => {
    const leases = new EndpointLeaseManager();
    const held = await leases.acquire('ws://cancel-waiter/ws');
    const controller = new AbortController();
    const pending = leases.acquire('ws://cancel-waiter/ws', { signal: controller.signal });
    controller.abort(new Error('cancel lease wait'));
    await expect(pending).rejects.toThrow('cancel lease wait');
    await held.release();
    await expect(leases.run('ws://cancel-waiter/ws', async () => 'available')).resolves.toBe('available');
  });

  it('cancels a cross-manager filesystem wait without taking the live owner lease', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-lease-abort-external-'));
    const first = new EndpointLeaseManager({ rootDir: root, retryDelayMs: 2 });
    const second = new EndpointLeaseManager({ rootDir: root, retryDelayMs: 2 });
    const endpoint = 'ws://abort-external/ws';
    const held = await first.acquire(endpoint);
    try {
      const controller = new AbortController();
      const pending = second.acquire(endpoint, { signal: controller.signal });
      setTimeout(() => controller.abort(new Error('stop external wait')), 15);
      await expect(pending).rejects.toThrow('stop external wait');
      await expect(held.run(async () => 'still owned')).resolves.toBe('still owned');
      await held.release();
      await expect(second.run(endpoint, async () => 'next')).resolves.toBe('next');
    } finally { await held.release(); await rm(root, { recursive: true, force: true }); }
  });

  it('serializes independent operations inside a held test lease while allowing nested actions', async () => {
    const leases = new EndpointLeaseManager();
    const held = await leases.acquire('ws://parallel-actions/ws');
    const events: string[] = [];
    try {
      await Promise.all(['a', 'b'].map((name) => held.run(async () => {
        events.push(`${name}:start`);
        await leases.run('ws://parallel-actions/ws', async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
        });
        events.push(`${name}:end`);
      })));
      expect(events).toEqual(['a:start', 'a:end', 'b:start', 'b:end']);
    } finally { await held.release(); }
  });

  it('releases a lease after cancellation or thrown errors', async () => {
    const leases = new EndpointLeaseManager();
    await expect(leases.run('ws://app/ws', async () => { throw new Error('cancelled'); }))
      .rejects.toThrow('cancelled');
    await expect(leases.run('ws://app/ws', async () => 'available')).resolves.toBe('available');
  });

  it('coordinates independent manager instances through a shared lease root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-endpoint-lease-'));
    try {
      const firstManager = new EndpointLeaseManager({ rootDir: root, retryDelayMs: 5 });
      const secondManager = new EndpointLeaseManager({ rootDir: root, retryDelayMs: 5 });
      const events: string[] = [];
      let release!: () => void;
      const first = firstManager.run('http://localhost:123/ws/', async () => {
        events.push('first:start');
        await new Promise<void>((resolve) => { release = resolve; });
        events.push('first:end');
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      const second = secondManager.run('ws://LOCALHOST:123/ws', async () => events.push('second'));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(events).toEqual(['first:start']);
      release();
      await Promise.all([first, second]);
      expect(events).toEqual(['first:start', 'first:end', 'second']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('serializes a real child process on the same endpoint', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-endpoint-child-'));
    const moduleUrl = new URL('../dist/index.js', import.meta.url).href;
    const childCode = `import { EndpointLeaseManager } from ${JSON.stringify(moduleUrl)};
      const manager = new EndpointLeaseManager({ rootDir: ${JSON.stringify(root)}, retryDelayMs: 5 });
      await manager.run('ws://child-app/ws', async () => {
        process.stdout.write('locked\\n');
        await new Promise((resolve) => setTimeout(resolve, 120));
      });`;
    const child = spawn(process.execPath, ['--input-type=module', '--eval', childCode], { stdio: ['ignore', 'pipe', 'inherit'] });
    try {
      await new Promise<void>((resolve, reject) => {
        child.stdout.on('data', (chunk: Buffer) => { if (chunk.toString().includes('locked')) resolve(); });
        child.once('error', reject);
      });
      const acquiredAt = Date.now();
      await new EndpointLeaseManager({ rootDir: root, retryDelayMs: 5 }).run('http://child-app/ws', async () => undefined);
      expect(Date.now() - acquiredAt).toBeGreaterThanOrEqual(80);
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
        await new Promise<void>((resolve) => child.once('exit', () => resolve()));
      }
      await rm(root, { recursive: true, force: true });
    }
  });

  it('coordinates the default lease across process working directories', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-endpoint-cross-cwd-'));
    const endpoint = `ws://cross-cwd-${process.pid}/ws`;
    const moduleUrl = new URL('../dist/index.js', import.meta.url).href;
    const code = `import { EndpointLeaseManager } from ${JSON.stringify(moduleUrl)};
      await new EndpointLeaseManager().run(${JSON.stringify(endpoint)}, async () => {
        process.stdout.write('locked\\n');
        await new Promise((resolve) => setTimeout(resolve, 160));
      });`;
    const child = spawn(process.execPath, ['--input-type=module', '--eval', code], {
      cwd: root, stdio: ['ignore', 'pipe', 'inherit'],
    });
    try {
      await new Promise<void>((resolve, reject) => {
        child.stdout.on('data', () => resolve()); child.once('error', reject);
      });
      const started = Date.now();
      await new EndpointLeaseManager().run(endpoint, async () => undefined);
      expect(Date.now() - started).toBeGreaterThanOrEqual(100);
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
        await new Promise<void>((resolve) => child.once('exit', () => resolve()));
      }
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reclaims a stale cross-process lock after the owner is gone', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-endpoint-stale-'));
    const endpoint = 'ws://stale-app/ws';
    const lock = join(root, `${createHash('sha256').update(normalizeEndpoint(endpoint)).digest('hex')}.lock`);
    try {
      await mkdir(lock, { recursive: true });
      await writeFile(join(lock, 'owner.json'), JSON.stringify({
        token: 'dead-owner', pid: 999_999, heartbeatAt: Date.now() - 10_000,
      }));
      const manager = new EndpointLeaseManager({
        rootDir: root, retryDelayMs: 5, staleAfterMs: 20, isProcessAlive: () => false,
      });
      await manager.run(endpoint, async () => {
        const owner = JSON.parse(await readFile(join(lock, 'owner.json'), 'utf8')) as { token: string };
        expect(owner.token).not.toBe('dead-owner');
      });
      await expect(readFile(join(lock, 'owner.json'), 'utf8')).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('does not steal a live process lease when its heartbeat is stale', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-endpoint-live-owner-'));
    const endpoint = 'ws://live-owner-app/ws';
    const lock = join(root, `${createHash('sha256').update(normalizeEndpoint(endpoint)).digest('hex')}.lock`);
    const owner = await new EndpointLeaseManager({ rootDir: root, staleAfterMs: 100_000 }).acquire(endpoint);
    const controller = new AbortController();
    const canceled = new Error('stopped waiting for the live owner');
    let contender: Awaited<ReturnType<EndpointLeaseManager['acquire']>> | undefined;
    try {
      const record = JSON.parse(await readFile(join(lock, 'owner.json'), 'utf8'));
      await writeFile(join(lock, 'owner.json'), JSON.stringify({ ...record, heartbeatAt: Date.now() - 10_000 }));
      const manager = new EndpointLeaseManager({ rootDir: root, staleAfterMs: 20, retryDelayMs: 5,
        isProcessAlive: (pid) => {
          expect(pid).toBe(process.pid);
          // Stop on the first liveness observation instead of relying on a timed wait.
          controller.abort(canceled);
          return true;
        },
      });
      await expect(manager.acquire(endpoint, { signal: controller.signal }).then((lease) => {
        contender = lease;
        return lease;
      })).rejects.toBe(canceled);
      expect(JSON.parse(await readFile(join(lock, 'owner.json'), 'utf8')).token).toBe(record.token);
      await expect(owner.run(async () => 'still exclusive')).resolves.toBe('still exclusive');
      await owner.release();
      const next = await new EndpointLeaseManager({ rootDir: root }).acquire(endpoint, { signal: AbortSignal.timeout(500) });
      await next.release();
    } finally {
      await contender?.release();
      await owner.release();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('keeps a real blocked child exclusive until it releases its lease', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-endpoint-blocked-child-'));
    const endpoint = 'ws://blocked-child-app/ws';
    const releasePath = join(root, 'release');
    const moduleUrl = new URL('../dist/index.js', import.meta.url).href;
    const code = `import { EndpointLeaseManager } from ${JSON.stringify(moduleUrl)};
      import { existsSync } from 'node:fs';
      const gate = new Int32Array(new SharedArrayBuffer(4));
      await new EndpointLeaseManager({ rootDir: ${JSON.stringify(root)}, staleAfterMs: 20 }).run(
        ${JSON.stringify(endpoint)}, async () => {
          process.stdout.write('locked\\n');
          // Deliberately prevent heartbeat timers while this live process owns the App.
          while (!existsSync(${JSON.stringify(releasePath)})) Atomics.wait(gate, 0, 0, 5);
        });`;
    const child = spawn(process.execPath, ['--input-type=module', '--eval', code], { stdio: ['ignore', 'pipe', 'inherit'] });
    const closed = new Promise<number | null>((resolve) => { child.once('exit', (code) => resolve(code)); });
    let contender: Awaited<ReturnType<EndpointLeaseManager['acquire']>> | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        child.stdout.on('data', () => resolve()); child.once('error', reject);
      });
      const canceled = new Error('parent stopped waiting');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(canceled), 60);
      try {
        await expect(new EndpointLeaseManager({ rootDir: root, staleAfterMs: 5, retryDelayMs: 2 })
          .acquire(endpoint, { signal: controller.signal }).then((lease) => {
            contender = lease;
            return lease;
          })).rejects.toBe(canceled);
      } finally { clearTimeout(timer); }
      expect(child.exitCode).toBeNull();
      await writeFile(releasePath, 'release');
      expect(await closed).toBe(0);
      const next = await new EndpointLeaseManager({ rootDir: root }).acquire(endpoint, { signal: AbortSignal.timeout(500) });
      await next.release();
    } finally {
      await contender?.release();
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      await closed;
      await rm(root, { recursive: true, force: true });
    }
  }, 5000);

  it('reclaims an old lock directory when its owner record is malformed or missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-endpoint-corrupt-lock-'));
    const endpoint = 'ws://corrupt-app/ws';
    const lock = join(root, `${createHash('sha256').update(normalizeEndpoint(endpoint)).digest('hex')}.lock`);
    try {
      await mkdir(lock, { recursive: true });
      const ownerPath = join(lock, 'owner.json');
      await writeFile(ownerPath, '{not-json');
      const old = new Date(Date.now() - 10_000);
      await utimes(ownerPath, old, old);
      const manager = new EndpointLeaseManager({ rootDir: root, retryDelayMs: 5, staleAfterMs: 20 });
      await manager.run(endpoint, async () => {
        const owner = JSON.parse(await readFile(join(lock, 'owner.json'), 'utf8')) as { token: string };
        expect(owner.token).not.toBeUndefined();
      });
      await expect(readFile(join(lock, 'owner.json'), 'utf8')).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
