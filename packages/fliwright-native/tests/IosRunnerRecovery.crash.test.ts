import { afterAll, afterEach, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeviceLeaseManager } from '../src/DeviceLease.js';
import { inspectDeviceLease } from '../src/DeviceRecovery.js';
import { IosRunnerJournal } from '../src/ios/IosRunnerJournal.js';
import { restoreIosRunnerRecovery } from '../src/ios/IosRunnerRecovery.js';
import { nativeModuleCompiler } from './helpers/compileNativeModule.js';

const roots: string[] = [], children: ChildProcess[] = [];
const compiledRoot = await mkdtemp(join(tmpdir(), 'ios-recovery-crash-modules-'));
const url = await nativeModuleCompiler(compiledRoot)('ios/IosRunnerRecovery');
afterAll(async () => { await rm(compiledRoot, { recursive: true, force: true }); });
afterEach(async () => {
  await Promise.all(children.splice(0).map(async child => {
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await new Promise(resolve => child.once('close', resolve)); }
  }));
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});
const cases = [
  ...['reservation-directory-created', 'reservation-created'].map(name => ({ name, occurrence: 0 })),
  ...['pending-created', 'record-written', 'record-synced', 'pending-synced', 'step-renamed', 'step-synced']
    .flatMap(name => [0, 1, 2, 3, 4].map(occurrence => ({ name, occurrence }))),
  ...['claimed', 'readback-completed', 'archiving', 'lock-renamed', 'lock-destination-synced', 'lock-synced', 'dirty-renamed', 'dirty-destination-synced', 'dirty-synced', 'archived', 'retirement-renamed', 'retirement-synced']
    .map(name => ({ name, occurrence: 0 })),
];

it.each(cases)('reconciles SIGKILL at $name occurrence $occurrence without discarding evidence', async ({ name, occurrence }) => {
  const rootDir = await mkdtemp(join(tmpdir(), 'ios-recovery-crash-')); roots.push(rootDir);
  const input = { platform: 'ios' as const, deviceId: randomUUID().toUpperCase(), rootDir };
  const manager = new DeviceLeaseManager({ rootDir, retryDelayMs: 1 }), lease = await manager.acquire('ios', input.deviceId);
  const journal = new IosRunnerJournal({ path: lease.iosRunnerRecoveryPath!, deviceId: input.deviceId,
    binding: lease.recoveryBinding!, assertOwned: () => lease.assertOwned!() });
  const context = { requestId: 'fixture', deadline: Date.now() + 5000, signal: AbortSignal.timeout(5000) };
  await journal.begin(randomUUID(), '2026-11-04T02:00:00.000Z', { sessionId: randomUUID(), recoveryKey: 'd'.repeat(64) }, context);
  await journal.bind(456, 3456, context); await lease.quarantine('test');
  const ownerPath = join(rootDir, `${lease.key}.lock`, 'owner.json'), owner = JSON.parse(await readFile(ownerPath, 'utf8'));
  await writeFile(ownerPath, JSON.stringify({ ...owner, pid: 2147483000 }));
  const originalRunner = await readFile(lease.iosRunnerRecoveryPath!), originalDirty = await readFile(join(rootDir, `${lease.key}.dirty`));
  const fingerprint = (await inspectDeviceLease(input)).fingerprint;
  const child = spawn(process.execPath, ['--input-type=module', '--eval', `
    import {restoreIosRunnerRecovery} from ${JSON.stringify(url)};
    const input=${JSON.stringify(input)}; let hit=0;
    await restoreIosRunnerRecovery(input,{fingerprint:${JSON.stringify(fingerprint)},timeoutMs:30000,
      executor:async(_tool,args)=>args.includes('booted')?Buffer.from(JSON.stringify({devices:{runtime:[{udid:input.deviceId,state:'Booted',lastBootedAt:'2026-11-04T02:00:00Z'}]}})):Buffer.from('PID Status Label\\n'),
      onBoundary:async name=>{if(name===${JSON.stringify(name)}&&hit++===${occurrence}){process.send('boundary');await new Promise(()=>{});}}
    });
  `], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  children.push(child); let errors = ''; child.stderr!.on('data', data => { errors += data; });
  const closed = new Promise(resolve => child.once('close', resolve));
  await new Promise<void>((resolve, reject) => {
    child.once('message', () => resolve()); child.once('error', reject);
    void closed.then(() => reject(new Error(`Recovery exited before fault boundary: ${errors}`)));
  });
  child.kill('SIGKILL'); await closed;
  const after = await inspectDeviceLease(input);
  let archiveDirectory: string;
  if (name.startsWith('retirement-')) {
    expect(after.state).toBe('available');
    archiveDirectory = join(rootDir, (await readdir(rootDir)).find(entry => entry.includes('.archive-'))!);
  } else {
    await expect(manager.acquire('ios', input.deviceId)).rejects.toMatchObject({ code: 'device_busy' });
    const result = await restoreIosRunnerRecovery(input, { fingerprint: after.fingerprint, timeoutMs:30000,
      executor: async (_tool, args) => args.includes('booted') ? Buffer.from(JSON.stringify({ devices: { runtime: [{ udid: input.deviceId,
        state: 'Booted', lastBootedAt: '2026-11-04T02:00:00Z' }] } })) : Buffer.from('PID Status Label\n') });
    archiveDirectory = result.archiveDirectory;
  }
  expect(await readFile(join(archiveDirectory, 'original.lock', 'ios-runner-recovery.json'))).toEqual(originalRunner);
  expect(await readFile(join(archiveDirectory, 'original.dirty'))).toEqual(originalDirty);
  const next = await manager.acquire('ios', input.deviceId); await next.release();
}, 15000);
