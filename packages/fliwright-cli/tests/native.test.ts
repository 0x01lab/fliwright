import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { NativeRuntime, NativeError, type NativeConfig } from '@fliwright/core';
import { CommandRegistry } from '../src/CommandRegistry.js';
import { executeCli } from '../src/index.js';
import { registerNative } from '../src/registry/native.js';
import { runCommand } from '../src/commands/run.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const native: NativeConfig = { enabled: true, platform: 'android', deviceId: 'chosen', targetAppId: 'example.app' };
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'native-cli-')); roots.push(root);
  const identity = { platform: 'android' as const, deviceId: 'chosen', appId: 'example.app', backend: 'probe', generation: 'g1' };
  const adapter = { identity, capabilities: vi.fn(async () => ({ 'native.query': { support: 'supported' as const, ready: true, backend: 'probe' } })),
    snapshot: vi.fn(async () => ({ id: 's', identity, capturedAt: 'now', screen: { width: 100, height: 200, scale: 1, orientation: 'portrait' as const }, nodes: [] })),
    execute: vi.fn(), screenshot: vi.fn(), dispose: vi.fn(async () => {}) };
  const runtime = new NativeRuntime(adapter);
  const doctor = vi.fn(async () => ({ ready: false, checks: [{ name: 'device', passed: false, message: 'unauthorized' }], capabilities: {}, diagnostics: [], runnerStarted: false as const }));
  const createSession = vi.fn(async () => runtime);
  const prepare = vi.fn(async () => ({ xctestrunPath: '/cache/runner.xctestrun', cached: true, cacheKey: 'key', xcode: 'Xcode', sdkBuild: 'sdk' }));
  const inspectLease = vi.fn(async () => ({ schemaVersion: 1 as const, deviceKey: 'a'.repeat(64), fingerprint: 'b'.repeat(64),
    state: 'quarantined' as const, owner: 'exited' as const, delegate: 'absent' as const, operation: 'exited' as const, hostTool: 'live' as const, recovery: 'absent' as const,
    quarantine: 'present' as const, appRecord: 'present' as const, permissionRecord: 'absent' as const, deviceRecord: 'absent' as const,
    iosRunnerRecord: 'absent' as const, issues: [] }));
  const inspectRunnerRecovery = vi.fn(async () => ({ status: 'runner-matches-record' as const, recordedBootGenerationMatches: true }));
  const restoreRunnerRecovery = vi.fn(async () => ({ status: 'retired' as const, transactionId: 'transaction-id' }));
  const restoreAndroidApp = vi.fn(async () => ({ status: 'restored' as const, transactionId: 'android-transaction', resourceScope: 'android-app-permission-forward' as const }));
  const registry = new CommandRegistry(); registerNative(registry, { doctor, createSession, prepare, inspectLease, inspectRunnerRecovery, restoreRunnerRecovery, restoreAndroidApp });
  const invoke = (command: string, ...args: string[]) => executeCli(['native', ...command.split('.'), '--cwd', root, '--json', ...args], registry);
  return { root, registry, invoke, adapter, doctor, createSession, prepare, inspectLease, inspectRunnerRecovery, restoreRunnerRecovery, restoreAndroidApp };
}

it('restores only an explicitly inspected iOS Runner fingerprint through the owned recovery transaction', async () => {
  const f = await setup(), ios = { enabled: false, platform: 'ios' as const, deviceId: 'dedicated-simulator', targetAppId: 'fixture.app',
    tools: { xcrun: '/tools/xcrun' } };
  await writeFile(join(f.root, 'fliwright.config.ts'), `export default {native:${JSON.stringify(ios)}}`);
  const input = join(f.root, 'restore.json'); await writeFile(input, JSON.stringify({ fingerprint: 'b'.repeat(64), timeout: 45000 }));
  const response = await f.invoke('recovery.restore', '--input', input);
  expect(response.exitCode, response.stdout).toBe(0);
  expect(JSON.parse(response.stdout)).toMatchObject({ data: { status: 'retired', transactionId: 'transaction-id' } });
  expect(f.restoreRunnerRecovery).toHaveBeenCalledExactlyOnceWith({ deviceId: 'dedicated-simulator', fingerprint: 'b'.repeat(64) },
    expect.objectContaining({ xcrunPath: '/tools/xcrun', timeoutMs: 45000, signal: expect.any(AbortSignal) }));
  expect(f.createSession).not.toHaveBeenCalled(); expect(f.inspectRunnerRecovery).not.toHaveBeenCalled();
});

it('rejects malformed restore fingerprints before invoking either platform restorer', async () => {
  const f = await setup(); await writeFile(join(f.root, 'fliwright.config.ts'), `export default {native:${JSON.stringify(native)}}`);
  const input = join(f.root, 'input.json'); await writeFile(input, JSON.stringify({ fingerprint: 'b'.repeat(64) }));
  await writeFile(input, JSON.stringify({ fingerprint: 'not-a-fingerprint' }));
  expect((await f.invoke('recovery.restore', '--input', input)).exitCode).toBe(2);
  expect(f.restoreRunnerRecovery).not.toHaveBeenCalled();
  expect(f.restoreAndroidApp).not.toHaveBeenCalled();
  expect(f.createSession).not.toHaveBeenCalled();
});

it('routes Android recovery through the scoped app-permission-forward API', async () => {
  const f = await setup(), android = { enabled: false, platform: 'android' as const, deviceId: 'avd:dedicated-test', targetAppId: 'fixture.app',
    tools: { adb: '/tools/adb' } };
  await writeFile(join(f.root, 'fliwright.config.ts'), `export default {native:${JSON.stringify(android)}}`);
  const input = join(f.root, 'android-restore.json'); await writeFile(input, JSON.stringify({ fingerprint: 'b'.repeat(64), timeout: 45000 }));
  const response = await f.invoke('recovery.restore', '--input', input);
  expect(response.exitCode, response.stdout).toBe(0);
  expect(JSON.parse(response.stdout)).toMatchObject({ data: { status: 'restored', transactionId: 'android-transaction',
    resourceScope: 'android-app-permission-forward' } });
  expect(f.restoreAndroidApp).toHaveBeenCalledExactlyOnceWith({ deviceId: 'avd:dedicated-test', fingerprint: 'b'.repeat(64) },
    expect.objectContaining({ adbPath: '/tools/adb', timeoutMs: 45000, signal: expect.any(AbortSignal) }));
  expect(f.restoreRunnerRecovery).not.toHaveBeenCalled(); expect(f.createSession).not.toHaveBeenCalled();
});

it('inspects quarantined local recovery evidence without acquiring ownership or invoking platform tools', async () => {
  const f = await setup();
  await writeFile(join(f.root, 'fliwright.config.ts'), `export default {native:${JSON.stringify(native)}}`);
  const response = await f.invoke('recovery.inspect');
  expect(response.exitCode, response.stdout).toBe(0);
  expect(JSON.parse(response.stdout)).toMatchObject({ data: { state: 'quarantined', owner: 'exited', operation: 'exited', hostTool: 'live', appRecord: 'present', fingerprint: 'b'.repeat(64) } });
  expect(f.inspectLease).toHaveBeenCalledExactlyOnceWith({ platform: 'android', deviceId: 'chosen' });
  expect(f.doctor).not.toHaveBeenCalled(); expect(f.createSession).not.toHaveBeenCalled(); expect(f.prepare).not.toHaveBeenCalled();
  expect(f.adapter.dispose).not.toHaveBeenCalled();
});

it('preserves an explicit stable AVD identity for offline inspection without online discovery', async () => {
  const f = await setup(), input = join(f.root, 'recovery-input.json');
  await writeFile(input, JSON.stringify({ native: { ...native, deviceId: 'avd:dedicated-test' } }));
  const response = await f.invoke('recovery.inspect', '--input', input);
  expect(response.exitCode, response.stdout).toBe(0);
  expect(f.inspectLease).toHaveBeenCalledExactlyOnceWith({ platform: 'android', deviceId: 'avd:dedicated-test' });
  expect(f.doctor).not.toHaveBeenCalled(); expect(f.createSession).not.toHaveBeenCalled();
});

it('verifies iOS Runner recovery against the explicitly configured Simulator without mutating it', async () => {
  const f = await setup(), ios = { enabled: false, platform: 'ios' as const, deviceId: 'dedicated-simulator', targetAppId: 'fixture.app',
    tools: { xcrun: '/tools/xcrun' } };
  await writeFile(join(f.root, 'fliwright.config.ts'), `export default {native:${JSON.stringify(ios)}}`);
  const response = await f.invoke('recovery.verify', '--timeout', '9000');
  expect(response.exitCode, response.stdout).toBe(0);
  expect(JSON.parse(response.stdout)).toMatchObject({ data: { status: 'runner-matches-record', recordedBootGenerationMatches: true } });
  expect(f.inspectRunnerRecovery).toHaveBeenCalledExactlyOnceWith({ platform: 'ios', deviceId: 'dedicated-simulator' },
    expect.objectContaining({ xcrunPath: '/tools/xcrun', timeoutMs: 9000, signal: expect.any(AbortSignal) }));
  expect(f.createSession).not.toHaveBeenCalled(); expect(f.prepare).not.toHaveBeenCalled();
});

it('rejects Android Runner verification before platform work and retains structured iOS readback failures', async () => {
  const f = await setup();
  await writeFile(join(f.root, 'fliwright.config.ts'), `export default {native:${JSON.stringify(native)}}`);
  const androidResponse = await f.invoke('recovery.verify');
  expect(androidResponse.exitCode).toBe(2);
  expect(f.inspectRunnerRecovery).not.toHaveBeenCalled();
  const input = join(f.root, 'verify-ios.json');
  await writeFile(input, JSON.stringify({ native: { ...native, platform: 'ios' } }));
  f.inspectRunnerRecovery.mockRejectedValue(new NativeError('protocol_mismatch', 'Simulator returned incomplete launchd process inventory.'));
  const response = await f.invoke('recovery.verify', '--input', input);
  expect(response.exitCode).toBe(3);
  expect(JSON.parse(response.stdout)).toMatchObject({ ok: false, error: { code: 'NATIVE_PROTOCOL_MISMATCH' },
    data: { platform: 'ios', nativeCode: 'protocol_mismatch' } });
  expect(f.createSession).not.toHaveBeenCalled();
});

it('runs read-only doctor from project native configuration and preserves strict failure details', async () => {
  const f = await setup();
  await writeFile(join(f.root, 'fliwright.config.ts'), `export default {native:${JSON.stringify(native)}}`);
  const response = await f.invoke('doctor', '--strict');
  expect(response.exitCode).toBe(3);
  expect(JSON.parse(response.stdout)).toMatchObject({ ok: false, data: { ready: false, runnerStarted: false } });
  expect(f.doctor).toHaveBeenCalledWith(expect.objectContaining(native), expect.objectContaining({ signal: expect.any(AbortSignal) }));
  expect(f.createSession).not.toHaveBeenCalled();
  expect(f.prepare).not.toHaveBeenCalled();
});

it('takes a scoped native snapshot and always closes its owned platform session', async () => {
  const f = await setup();
  const query = { field: 'text', value: 'Allow', exact: true, scope: 'system' };
  const input = join(f.root, 'input.json'); await writeFile(input, JSON.stringify({ native, query }));
  const response = await f.invoke('snapshot', '--input', input);
  expect(response.exitCode, response.stdout).toBe(0);
  expect(JSON.parse(response.stdout)).toMatchObject({ data: { surface: 'native', schemaVersion: 1, snapshot: { identity: { deviceId: 'chosen' } } } });
  expect(f.adapter.snapshot).toHaveBeenCalledWith(expect.anything(), query);
  expect(f.adapter.dispose).toHaveBeenCalledOnce();
});

it('closes the owned session when snapshot fails and reports its structured platform error', async () => {
  const f = await setup();
  f.adapter.snapshot.mockRejectedValue(new NativeError('transport_lost', 'native transport offline'));
  await writeFile(join(f.root, 'fliwright.config.ts'), `export default {native:${JSON.stringify(native)}}`);
  const response = await f.invoke('snapshot');
  expect(response.exitCode).toBe(3);
  expect(response.stdout).toContain('native transport offline');
  expect(JSON.parse(response.stdout)).toMatchObject({ error: { code: 'NATIVE_TRANSPORT_LOST' }, data: { platform: 'android', nativeCode: 'transport_lost' } });
  expect(f.adapter.dispose).toHaveBeenCalledOnce();
});

it('retains the original platform error when owned session cleanup also fails', async () => {
  const f = await setup();
  f.adapter.snapshot.mockRejectedValue(new NativeError('transport_lost', 'original native failure'));
  f.adapter.dispose.mockRejectedValue(new Error('runner could not stop'));
  await writeFile(join(f.root, 'fliwright.config.ts'), `export default {native:${JSON.stringify(native)}}`);
  const response = await f.invoke('snapshot');
  expect(JSON.parse(response.stdout)).toMatchObject({ error: { code: 'NATIVE_TRANSPORT_LOST', message: 'original native failure' },
    data: { cleanupError: 'runner could not stop' } });
});

it('requires configuration, validates backend mismatch before platform work and builds only explicitly', async () => {
  const f = await setup();
  expect((await f.invoke('snapshot')).exitCode).toBe(2);
  const input = join(f.root, 'input.json'); await writeFile(input, JSON.stringify({ native: { ...native, backend: 'xctest' } }));
  expect((await f.invoke('doctor', '--input', input)).exitCode).toBe(2);
  expect(f.doctor).not.toHaveBeenCalled();
  expect(f.createSession).not.toHaveBeenCalled();
  expect((await f.invoke('prepare', '--timeout', '45000')).exitCode).toBe(0);
  expect(f.prepare).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 45000 }));
});

it('publishes native commands and complete input schemas in the standard registry', async () => {
  const { createRegistry } = await import('../src/index.js');
  const registry = createRegistry();
  for (const path of ['native.doctor', 'native.snapshot', 'native.prepare', 'native.recovery.inspect', 'native.recovery.verify', 'native.recovery.restore']) expect(registry.definitions.has(path)).toBe(true);
  for (const path of ['native.doctor', 'native.snapshot', 'native.prepare', 'native.recovery.inspect', 'native.recovery.verify', 'native.recovery.restore']) expect(registry.definitions.get(path)?.needsApp).not.toBe(true);
  expect(registry.schema('native.snapshot')).toMatchObject({ input: { properties: { native: expect.anything(), query: expect.anything() } } });
});

it('forwards the native project configuration across the real run/script Vitest process boundary', async () => {
  const f = await setup();
  await writeFile(join(f.root, 'fliwright.config.ts'), `export default {native:${JSON.stringify(native)},recording:{mode:'off'}}`);
  await writeFile(join(f.root, 'transport.test.mjs'), `import { readFileSync } from 'node:fs';

    import {test,expect} from 'vitest';
    test('native config transport',()=>expect(JSON.parse(readFileSync(process.env.FLIWRIGHT_CONFIG_PATH, 'utf8')).native).toEqual(${JSON.stringify(native)}));
  `);
  const result = await runCommand({ cwd: f.root, testPattern: 'transport.test.mjs', runsRoot: join(f.root, 'runs'), print: false },
    { resolveVmUrl: async () => 'ws://unused-config-transport/ws' });
  expect(result).toMatchObject({ passed: true, passedTests: 1 });
  expect(f.createSession).not.toHaveBeenCalled();
}, 20000);
