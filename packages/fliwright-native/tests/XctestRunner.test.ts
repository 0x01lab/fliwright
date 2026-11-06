import { afterEach, expect, it as platformIt, vi } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeviceLeaseManager } from '../src/DeviceLease.js';
import { startXctestSession } from '../src/ios/XctestRunner.js';
import { claimDeviceRecovery, inspectDeviceLease } from '../src/DeviceRecovery.js';
import { nativeModuleCompiler } from './helpers/compileNativeModule.js';
import { writeFakeXctestTools } from './helpers/fakeXctestTools.js';

// These integration tests launch the macOS-only XCTest session entry point.
const it = platformIt.skipIf(process.platform !== 'darwin');
vi.setConfig({ testTimeout: 20000 });

const roots: string[] = [];
const children: ChildProcess[] = [], groups: number[] = [];
afterEach(async () => {
  await Promise.all(children.splice(0).map(async child => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const closed = new Promise<void>(resolve => child.once('close', () => resolve())); child.kill('SIGKILL'); await closed;
  }));
  for (const group of groups.splice(0)) { try { process.kill(-group, 'SIGKILL'); } catch { /* Confirmed exited. */ } }
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const rootDir = await mkdtemp(join(tmpdir(), 'fliwright-xctest-owner-')); roots.push(rootDir);
  const input = { platform: 'ios' as const, deviceId: 'xctest-simulator', rootDir: join(rootDir, 'leases') };
  const lease = await new DeviceLeaseManager({ rootDir: input.rootDir, retryDelayMs: 1 }).acquire('ios', input.deviceId);
  const files = await writeFakeXctestTools(rootDir, { deviceId: input.deviceId, runnerJournalPath: lease.iosRunnerRecoveryPath });
  const config = { platform: 'ios' as const, enabled: true, deviceId: input.deviceId, targetAppId: 'fixture.app',
    backend: 'xctest' as const, cleanupTimeoutMs: 3000, ios: { xctestrunPath: files.xctestrunPath },
    tools: { xcodebuild: files.xcodebuild, xcrun: files.xcrun } };
  const start = () => startXctestSession(config, undefined, action => lease.runOwnedTool!(action), {
    path: lease.iosRunnerRecoveryPath!, binding: lease.recoveryBinding!, assertOwned: () => lease.assertOwned!(),
  });
  return { rootDir, input, lease, files, config, start };
}

it.each(['normal', 'lost-ack', 'simulator-reboot', 'same-pid-wrong-key', 'replacement-pid', 'ignored-shutdown'] as const)(
  'authenticates self-shutdown and retains unconfirmed Simulator evidence (%s)', async scenario => {
    const f = await fixture();
    const session = await f.start();
    const report = await inspectDeviceLease(f.input);
    expect(report).toMatchObject({ owner: 'live', hostTool: 'live', iosRunnerRecord: 'present', issues: ['unresolved-ios-runner'] });
    const record = JSON.parse(await readFile(f.lease.iosRunnerRecoveryPath!, 'utf8'));
    expect(record).toMatchObject({ schemaVersion: 2, phase: 'running', runnerPid: 456,
      simulatorBootedAt: '2026-11-04T02:00:00.000Z', recoveryPort: expect.any(Number), recoveryKey: expect.any(String) });
    expect(JSON.stringify(report)).not.toContain(record.recoveryKey);
    expect(JSON.stringify(report)).not.toContain(record.sessionId);
    const marker = scenario === 'simulator-reboot' ? f.files.rebooted : scenario === 'same-pid-wrong-key' ? f.files.wrongKey
      : scenario === 'replacement-pid' ? f.files.replaced : scenario === 'ignored-shutdown' ? f.files.ignoreShutdown
      : scenario === 'lost-ack' ? f.files.lostAck : undefined;
    if (marker) await writeFile(marker, 'yes');
    if (scenario !== 'normal' && scenario !== 'lost-ack') {
      await expect(session.dispose()).rejects.toMatchObject({ code: 'cleanup_failed' });
      expect((await inspectDeviceLease(f.input)).iosRunnerRecord).toBe('present');
      await expect(f.lease.release()).rejects.toMatchObject({ code: 'cleanup_failed' });
      if (scenario !== 'ignored-shutdown') await expect(readFile(f.files.shutdowns)).rejects.toMatchObject({ code: 'ENOENT' });
    } else {
      await session.dispose();
      expect((await inspectDeviceLease(f.input))).toMatchObject({ hostTool: 'absent', iosRunnerRecord: 'absent' });
      expect(await readFile(f.files.shutdowns, 'utf8')).toBe('1');
      expect(await readFile(f.files.stopped, 'utf8')).toBe('yes');
      await f.lease.release();
    }
    await expect(readFile(f.files.terminated)).rejects.toMatchObject({ code: 'ENOENT' });
  },
);

it('never publishes running or sends shutdown before the control endpoint authenticates', async () => {
  const f = await fixture();
  await writeFile(f.files.wrongKey, 'yes');
  await expect(f.start()).rejects.toMatchObject({ code: 'cleanup_failed' });
  const record = JSON.parse(await readFile(f.lease.iosRunnerRecoveryPath!, 'utf8'));
  expect(record).toMatchObject({ phase: 'launching', runnerPid: null, recoveryPort: null });
  await expect(readFile(f.files.shutdowns)).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(readFile(f.files.terminated)).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(f.lease.release()).rejects.toMatchObject({ code: 'cleanup_failed' });
});

it('refuses to terminate or adopt a pre-existing Simulator Runner', async () => {
  const f = await fixture();
  await writeFile(f.files.started, 'yes');
  await expect(f.start()).rejects.toMatchObject({ code: 'device_busy' });
  await expect(readFile(f.lease.iosRunnerRecoveryPath!)).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(readFile(f.files.terminated)).rejects.toMatchObject({ code: 'ENOENT' });
  await f.lease.release();
});

it('does not launch xcodebuild or adopt an existing durable Runner journal', async () => {
  const f = await fixture(), original = '{"original":"retain"}';
  await writeFile(f.lease.iosRunnerRecoveryPath!, original);
  await expect(f.start()).rejects.toBeDefined();
  expect(await readFile(f.lease.iosRunnerRecoveryPath!, 'utf8')).toBe(original);
  await expect(readFile(f.files.started)).rejects.toMatchObject({ code: 'ENOENT' });
  await rm(f.lease.iosRunnerRecoveryPath!);
  await f.lease.release();
});

it('keeps the XCTest process group fenced after owner SIGKILL until the group exits', async () => {
  if (process.platform !== 'darwin') return;
  const rootDir = await mkdtemp(join(tmpdir(), 'fliwright-xctest-crash-')); roots.push(rootDir);
  const compile = nativeModuleCompiler(join(rootDir, 'compiled'));
  const leaseUrl = await compile('DeviceLease'), runnerUrl = await compile('ios/XctestRunner');
  const marker = join(rootDir, 'crashed-runner');
  const { xctestrunPath, xcodebuild, xcrun } = await writeFakeXctestTools(rootDir, {
    deviceId: 'crashed-xctest-simulator', startMarker: marker, crash: true,
  });
  const child = spawn(process.execPath, ['--input-type=module', '--eval', `
    import {DeviceLeaseManager} from ${JSON.stringify(leaseUrl)};
    import {startXctestSession} from ${JSON.stringify(runnerUrl)};
    import {writeFile} from 'node:fs/promises';
    const rootDir=${JSON.stringify(rootDir)};
    const lease=await new DeviceLeaseManager({rootDir,retryDelayMs:1}).acquire('ios','crashed-xctest-simulator');
    process.env.FLIWRIGHT_TEST_JOURNAL_PATH=rootDir+'/'+lease.key+'.lock/native-tool-recovery.json';
    process.env.FLIWRIGHT_TEST_RUNNER_JOURNAL_PATH=lease.iosRunnerRecoveryPath;
    process.env.FLIWRIGHT_TEST_CRASH_MARKER=${JSON.stringify(marker)};
    process.send({key:lease.key});
    await lease.runExclusive(()=>startXctestSession({platform:'ios',enabled:true,deviceId:'crashed-xctest-simulator',targetAppId:'fixture.app',backend:'xctest',
      ios:{xctestrunPath:${JSON.stringify(xctestrunPath)}},tools:{xcodebuild:${JSON.stringify(xcodebuild)},xcrun:${JSON.stringify(xcrun)}}},undefined,
      action=>lease.runOwnedTool(action),{path:lease.iosRunnerRecoveryPath,binding:lease.recoveryBinding,assertOwned:()=>lease.assertOwned()}));
    await writeFile(${JSON.stringify(marker)}+'.owner-ready','yes');
  `], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  children.push(child);
  const closed = new Promise<void>(resolve => child.once('close', () => resolve()));
  const messages: unknown[] = []; child.on('message', message => { messages.push(message); });
  let childStderr = ''; child.stderr?.on('data', chunk => { childStderr += chunk.toString(); });
  await vi.waitFor(() => expect(messages.length).toBeGreaterThan(0));
  const key = (messages[0] as { key: string }).key;
  await vi.waitFor(async () => {
    const present = await readFile(marker, 'utf8').then(value => value.includes('group'), () => false);
    expect(present, `child exit=${child.exitCode} signal=${child.signalCode}; stderr=${childStderr}`).toBe(true);
  }, { timeout: 5000 });
  const identity = JSON.parse(await readFile(marker, 'utf8')); groups.push(identity.group);
  await closed;
  const input = { platform: 'ios' as const, deviceId: 'crashed-xctest-simulator', rootDir };
  const live = await inspectDeviceLease(input);
  expect(live).toMatchObject({ owner: 'exited', hostTool: 'live', iosRunnerRecord: 'present', issues: ['unresolved-ios-runner'] });
  expect(['absent', 'exited']).toContain(live.operation);
  expect(JSON.parse(await readFile(join(rootDir, `${key}.lock`, 'ios-runner-recovery.json'), 'utf8')))
    .toMatchObject({ phase: 'running', runnerPid: 456, bundleId: 'dev.fliwright.NativeRunner.xctrunner' });
  await expect(claimDeviceRecovery(input, { fingerprint: live.fingerprint })).rejects.toMatchObject({ code: 'device_busy' });
  process.kill(-identity.group, 'SIGKILL');
  await vi.waitFor(() => expect(() => process.kill(-identity.group, 0)).toThrow(), { timeout: 4000 });
  groups.splice(groups.indexOf(identity.group), 1);
  const exited = await inspectDeviceLease(input);
  expect(exited).toMatchObject({ owner: 'exited', hostTool: 'exited', iosRunnerRecord: 'present', issues: ['unresolved-ios-runner'] });
  await expect(claimDeviceRecovery(input, { fingerprint: exited.fingerprint })).rejects.toMatchObject({ code: 'cleanup_failed' });
  await expect(readFile(join(rootDir, `${key}.lock`, 'ios-runner-recovery.json'))).resolves.toBeTruthy();
}, 12000);
