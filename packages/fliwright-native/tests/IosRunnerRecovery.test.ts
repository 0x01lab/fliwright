import { afterEach, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { randomUUID, createHmac } from 'node:crypto';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeviceLeaseManager } from '../src/DeviceLease.js';
import { inspectDeviceLease } from '../src/DeviceRecovery.js';
import { IosRunnerJournal } from '../src/ios/IosRunnerJournal.js';
import { restoreIosRunnerRecovery } from '../src/ios/IosRunnerRecovery.js';
import type { ToolExecutor } from '../src/ToolExecutor.js';
import { setTimeout as delay } from 'node:timers/promises';

const roots: string[] = [];
const servers: { server: Server; sockets: Set<Socket> }[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(async ({ server, sockets }) => {
    sockets.forEach(socket => socket.destroy()); await new Promise<void>(resolve => server.close(() => resolve()));
  }));
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const rootDir = await mkdtemp(join(tmpdir(), 'ios-restore-')); roots.push(rootDir);
  const input = { platform: 'ios' as const, deviceId: randomUUID().toUpperCase(), rootDir };
  const manager = new DeviceLeaseManager({ rootDir, retryDelayMs: 1 }), lease = await manager.acquire('ios', input.deviceId);
  const context = { requestId: randomUUID(), deadline: Date.now() + 5000, signal: AbortSignal.timeout(5000) };
  const journal = new IosRunnerJournal({ path: lease.iosRunnerRecoveryPath!, deviceId: input.deviceId,
    binding: lease.recoveryBinding!, assertOwned: () => lease.assertOwned!() });
  await journal.begin(randomUUID(), '2026-11-04T02:00:00.000Z', { sessionId: randomUUID(), recoveryKey: 'd'.repeat(64) }, context);
  await journal.bind(456, 3456, context); await lease.quarantine('test');
  const ownerPath = join(rootDir, `${lease.key}.lock`, 'owner.json'), owner = JSON.parse(await readFile(ownerPath, 'utf8'));
  await writeFile(ownerPath, JSON.stringify({ ...owner, pid: 2147483000 }));
  const originalRunner = await readFile(lease.iosRunnerRecoveryPath!), originalDirty = await readFile(join(rootDir, `${lease.key}.dirty`));
  const executor: ToolExecutor = async (_tool, args) => {
    expect(args).not.toContain('terminate');
    await expect(manager.acquire('ios', input.deviceId)).rejects.toMatchObject({ code: 'device_busy' });
    return args.includes('booted') ? Buffer.from(JSON.stringify({ devices: { runtime: [{ udid: input.deviceId, state: 'Booted', lastBootedAt: '2026-11-04T02:00:00Z' }] } }))
      : Buffer.from('PID Status Label\n');
  };
  return { input, manager, lease, originalRunner, originalDirty, executor };
}

async function settled(input: Parameters<typeof inspectDeviceLease>[0]) {
  for (let count = 0; count < 100; count++) {
    const report = await inspectDeviceLease(input);
    if (report.recovery !== 'live') return report;
    await delay(10);
  }
  throw new Error('Actual recovery work did not settle.');
}

it('restores an absent Runner, archives exact original bytes and allows a fresh lease only after retirement', async () => {
  const f = await fixture(), report = await inspectDeviceLease(f.input);
  const restored = await restoreIosRunnerRecovery(f.input, { fingerprint: report.fingerprint, executor: f.executor });
  expect(restored.status).toBe('retired');
  expect(await readFile(join(restored.archiveDirectory, 'original.lock', 'ios-runner-recovery.json'))).toEqual(f.originalRunner);
  expect(await readFile(join(restored.archiveDirectory, 'original.dirty'))).toEqual(f.originalDirty);
  expect(await inspectDeviceLease(f.input)).toMatchObject({ state: 'available', recovery: 'absent' });
  const lease = await f.manager.acquire('ios', f.input.deviceId); await lease.release();
});

it('refuses extra app or permission resources without reserving or running platform tools', async () => {
  const f = await fixture(); let dispatches = 0;
  await writeFile(f.lease.recoveryPath!, JSON.stringify({ operation: 'unknown' }));
  const report = await inspectDeviceLease(f.input);
  await expect(restoreIosRunnerRecovery(f.input, { fingerprint: report.fingerprint, executor: async () => { dispatches++; return Buffer.alloc(0); } }))
    .rejects.toMatchObject({ code: 'cleanup_failed' });
  expect(dispatches).toBe(0);
  expect(await readdir(f.input.rootDir)).not.toContain(`${f.lease.key}.recovery`);
});

it('preserves exclusion and originals on reboot and can retry after actual work settles', async () => {
  const f = await fixture(), report = await inspectDeviceLease(f.input);
  await expect(restoreIosRunnerRecovery(f.input, { fingerprint: report.fingerprint, executor: async () => Buffer.from(JSON.stringify({ devices: { runtime: [{
    udid: f.input.deviceId, state: 'Booted', lastBootedAt: '2026-11-04T03:00:00Z' }] } })) })).rejects.toMatchObject({ code: 'device_mismatch' });
  expect(await readFile(f.lease.iosRunnerRecoveryPath!)).toEqual(f.originalRunner);
  await expect(f.manager.acquire('ios', f.input.deviceId)).rejects.toMatchObject({ code: 'device_busy' });
  const next = await settled(f.input);
  const result = await restoreIosRunnerRecovery(f.input, { fingerprint: next.fingerprint, executor: f.executor });
  expect(result.status).toBe('retired');
});

it('refuses a stale fingerprint before taking over a suspended transaction', async () => {
  const f = await fixture(), report = await inspectDeviceLease(f.input), controller = new AbortController();
  await expect(restoreIosRunnerRecovery(f.input, { fingerprint: report.fingerprint, executor: async () => {
    controller.abort(); return Buffer.alloc(0);
  }, signal: controller.signal })).rejects.toMatchObject({ code: 'cancelled' });
  let dispatches = 0;
  await expect(restoreIosRunnerRecovery(f.input, { fingerprint: report.fingerprint, executor: async () => { dispatches++; return Buffer.alloc(0); } }))
    .rejects.toMatchObject({ code: 'cleanup_failed' });
  expect(dispatches).toBe(0);
});

async function controlFixture(mode: 'normal' | 'lost-ack' | 'wrong-key' | 'stuck') {
  const f = await fixture(), events: string[] = [], sockets = new Set<Socket>(); let running = true;
  const server = createServer(socket => {
    sockets.add(socket); socket.on('error', () => {}); socket.on('close', () => sockets.delete(socket));
    let input = '';
    socket.on('data', data => {
      input += data.toString('utf8'); if (!input.endsWith('\n')) return;
      const request = JSON.parse(input); events.push(request.operation);
      const response = { ...request, direction: 'response', status: request.operation === 'identify' ? 'identified' : 'stopping' };
      response.signature = createHmac('sha256', Buffer.from(mode === 'wrong-key' ? 'e'.repeat(64) : 'd'.repeat(64), 'hex'))
        .update(['fliwright-runner-recovery', '1', response.direction, response.operation, response.nonce, response.sessionId,
          response.generation, response.deviceId, response.simulatorBootedAt, String(response.runnerPid), response.status].join('\n')).digest('hex');
      if (request.operation === 'shutdown' && mode !== 'stuck') running = false;
      if (request.operation === 'shutdown' && mode === 'lost-ack') socket.destroy();
      else socket.end(JSON.stringify(response) + '\n');
    });
  });
  servers.push({ server, sockets });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const record = JSON.parse(f.originalRunner.toString()); record.recoveryPort = (server.address() as { port: number }).port;
  await writeFile(f.lease.iosRunnerRecoveryPath!, JSON.stringify(record));
  f.originalRunner = await readFile(f.lease.iosRunnerRecoveryPath!);
  const executor: ToolExecutor = async (tool, args, context) => args.includes('booted') ? f.executor(tool, args, context)
    : Buffer.from('PID Status Label\n' + (running ? '456 0 UIKitApplication:dev.fliwright.NativeRunner.xctrunner[AB12][rb-legacy]\n' : ''));
  return { ...f, executor, events, stop() { running = false; } };
}

it.each(['normal', 'lost-ack'] as const)('authenticates a live Runner and reads actual absence after %s shutdown', async mode => {
  const f = await controlFixture(mode), report = await inspectDeviceLease(f.input);
  expect((await restoreIosRunnerRecovery(f.input, { fingerprint: report.fingerprint, executor: f.executor })).status).toBe('retired');
  expect(f.events).toEqual(['identify', 'shutdown']);
});

it('does not send shutdown to a same-PID endpoint with the wrong authentication key', async () => {
  const f = await controlFixture('wrong-key'), report = await inspectDeviceLease(f.input);
  await expect(restoreIosRunnerRecovery(f.input, { fingerprint: report.fingerprint, executor: f.executor })).rejects.toMatchObject({ code: 'device_mismatch' });
  expect(f.events).toEqual(['identify']);
  expect(await readFile(f.lease.iosRunnerRecoveryPath!)).toEqual(f.originalRunner);
});

it('never replays an acknowledged pending shutdown when an explicit recovery retries', async () => {
  const f = await controlFixture('stuck'), report = await inspectDeviceLease(f.input), controller = new AbortController();
  await expect(restoreIosRunnerRecovery(f.input, { fingerprint: report.fingerprint, executor: f.executor,
    signal: controller.signal, onBoundary: async name => { if (name === 'shutdown-dispatched') controller.abort(); } }))
    .rejects.toMatchObject({ code: 'cancelled' });
  expect(f.events).toEqual(['identify', 'shutdown']);
  f.stop(); const next = await settled(f.input);
  await restoreIosRunnerRecovery(f.input, { fingerprint: next.fingerprint, executor: f.executor });
  expect(f.events).toEqual(['identify', 'shutdown']);
});

it('returns cancellation promptly but retains exclusion while an executor ignores the signal', async () => {
  const f = await fixture(), report = await inspectDeviceLease(f.input), controller = new AbortController();
  let release!: () => void, entered!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  const attempt = restoreIosRunnerRecovery(f.input, { fingerprint: report.fingerprint, signal: controller.signal,
    executor: async () => { entered(); await blocked; return Buffer.alloc(0); } });
  await started; controller.abort();
  await expect(attempt).rejects.toMatchObject({ code: 'cancelled' });
  const active = await inspectDeviceLease(f.input);
  expect(active.recovery).toBe('live');
  await expect(f.manager.acquire('ios', f.input.deviceId)).rejects.toMatchObject({ code: 'device_busy' });
  await expect(restoreIosRunnerRecovery(f.input, { fingerprint: active.fingerprint, executor: f.executor })).rejects.toMatchObject({ code: 'device_busy' });
  release(); const next = await settled(f.input);
  expect((await restoreIosRunnerRecovery(f.input, { fingerprint: next.fingerprint, executor: f.executor })).status).toBe('retired');
});

it.each(['lock-renamed', 'dirty-renamed'] as const)('refuses a replaced archived original at %s and changes inspection identity', async boundary => {
  const f = await fixture(), report = await inspectDeviceLease(f.input);
  let before = '';
  await expect(restoreIosRunnerRecovery(f.input, { fingerprint: report.fingerprint, executor: f.executor, onBoundary: async name => {
    if (name !== boundary) return;
    before = (await inspectDeviceLease(f.input)).fingerprint;
    const path = boundary === 'lock-renamed' ? join(f.input.rootDir, `${f.lease.key}.recovery`, 'original.lock', 'ios-runner-recovery.json')
      : join(f.input.rootDir, `${f.lease.key}.recovery`, 'original.dirty');
    const content = await readFile(path); await writeFile(path, content);
    expect((await inspectDeviceLease(f.input)).fingerprint).not.toBe(before);
  } })).rejects.toMatchObject({ code: 'cleanup_failed' });
  await expect(f.manager.acquire('ios', f.input.deviceId)).rejects.toMatchObject({ code: 'device_busy' });
});
