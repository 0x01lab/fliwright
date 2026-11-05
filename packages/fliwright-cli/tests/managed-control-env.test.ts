import { expect, it, vi } from 'vitest';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCommand } from '../src/commands/run.js';

it.each([false, true])('passes only explicit supervisor credentials privately to the runner (%s)', async explicit => {
  const root = await mkdtemp(join(tmpdir(), 'managed-control-env-'));
  const control = { url: 'http://127.0.0.1:9123', token: 'a'.repeat(64), sessionId: 'private-supervisor-session', timeoutMs: 1000 };
  vi.stubEnv('FLIWRIGHT_MANAGED_APP_CONTROL', JSON.stringify({ ...control, sessionId: 'stale-inherited-control' }));
  try {
    await writeFile(join(root, 'private.test.mjs'), `
      import { test, expect } from 'vitest';
      import { readFileSync } from 'node:fs';
      test('control is private process context', () => {
        const encoded = process.env.FLIWRIGHT_MANAGED_APP_CONTROL;
        ${explicit ? `expect(JSON.parse(encoded).sessionId).toBe('private-supervisor-session');` : `expect(encoded).toBe('');`}
        const config = readFileSync(process.env.FLIWRIGHT_CONFIG_PATH, 'utf8');
        expect(process.env.FLIWRIGHT_CONFIG).toBeUndefined();
        expect(process.env.FLIWRIGHT_SCENARIOS).toBeUndefined();
        expect(config.includes('private-supervisor-session')).toBe(false);
        expect(config.includes('stale-inherited-control')).toBe(false);
        expect(config.includes('${control.token}')).toBe(false);
      });
    `);
    const runs = join(root, 'runs');
    const result = await runCommand({ cwd: root, runsRoot: runs, testPattern: 'private.test.mjs', print: false,
      ...(explicit ? { managedAppControl: control } : {}),
    }, { resolveVmUrl: async () => 'ws://unused' });
    expect(result).toMatchObject({ passed: true, passedTests: 1 });
    const serialized = [JSON.stringify(result)];
    for (const entry of await readdir(runs, { recursive: true, withFileTypes: true })) {
      if (entry.isFile()) serialized.push(await readFile(join(entry.parentPath, entry.name), 'utf8'));
    }
    for (const secret of [control.token, control.sessionId, 'stale-inherited-control', 'FLIWRIGHT_MANAGED_APP_CONTROL']) {
      expect(serialized.join('\n')).not.toContain(secret);
    }
  } finally { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); }
}, 15000);

it('runs a managed native suite without resolving a bootstrap VM or inheriting stale URLs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'managed-native-no-endpoint-'));
  const control = { url: 'http://127.0.0.1:9123', token: 'a'.repeat(64), sessionId: 'managed-native', timeoutMs: 1000 };
  const delegation = { rootDir: join(root, 'lease'), key: 'a'.repeat(64), token: 'b'.repeat(64) };
  vi.stubEnv('FLIWRIGHT_VM_URL', 'ws://127.0.0.1:9998/stale/ws');
  vi.stubEnv('FLIWRIGHT_VM_SERVICE_URL', 'ws://127.0.0.1:9999/stale/ws');
  const resolveVmUrl = vi.fn().mockResolvedValue(null), onVmResolved = vi.fn();
  try {
    await writeFile(join(root, 'fliwright.config.ts'), `export default {vmServiceUrl:'ws://127.0.0.1:9997/stale/ws',
      native:{enabled:true,platform:'android',deviceId:'owned',targetAppId:'example.app'}};`);
    await writeFile(join(root, 'private.test.mjs'), `
      import {test,expect} from 'vitest';
      test('no bootstrap endpoint',()=>{
        expect(process.env.FLIWRIGHT_VM_URL).toBe('');
        expect(process.env.FLIWRIGHT_VM_SERVICE_URL).toBe('');
        expect(JSON.parse(process.env.FLIWRIGHT_MANAGED_APP_CONTROL).sessionId).toBe('managed-native');
      });
      test.skip('no platform work for static skip',()=>{throw Error('must not run');});
    `);
    const result = await runCommand({ cwd: root, runsRoot: join(root, 'runs'), testPattern: 'private.test.mjs', print: false,
      nativeDelegation: delegation, managedAppControl: control, scenarioMode: 'managed-start',
    }, { resolveVmUrl, onVmResolved });
    expect(result).toMatchObject({ passed: true, totalTests: 2, passedTests: 1, failedTests: 0 });
    expect(result.results.filter(test => test.status === 'skipped')).toHaveLength(1);
    expect(resolveVmUrl).not.toHaveBeenCalled();
    expect(onVmResolved).not.toHaveBeenCalled();
  } finally { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); }
}, 15000);

it.each(['attach', 'no-native', 'no-owner', 'inherited-control'] as const)(
  'still requires an initial endpoint without the explicit managed native contract (%s)', async missing => {
    const root = await mkdtemp(join(tmpdir(), 'managed-native-endpoint-required-'));
    const control = { url: 'http://127.0.0.1:9123', token: 'a'.repeat(64), sessionId: 'managed-native', timeoutMs: 1000 };
    const delegation = { rootDir: join(root, 'lease'), key: 'a'.repeat(64), token: 'b'.repeat(64) };
    const resolveVmUrl = vi.fn().mockResolvedValue(null);
    vi.stubEnv('FLIWRIGHT_MANAGED_APP_CONTROL', JSON.stringify(control));
    try {
      await writeFile(join(root, 'fliwright.config.ts'), `export default ${missing === 'no-native' ? '{}' :
        "{native:{enabled:true,platform:'android',deviceId:'owned',targetAppId:'example.app'}}"};`);
      await expect(runCommand({ cwd: root, print: false, scenarioMode: missing === 'attach' ? 'attach' : 'managed-start',
        ...(missing === 'no-owner' ? {} : { nativeDelegation: delegation }),
        ...(missing === 'inherited-control' ? {} : { managedAppControl: control }),
      }, { resolveVmUrl })).rejects.toThrow('Could not find a running Flutter VM Service');
      expect(resolveVmUrl).toHaveBeenCalledOnce();
    } finally { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); }
  });

it.each(['control', 'delegation'] as const)('rejects malformed explicit %s before endpoint discovery or runner startup', async invalid => {
  const root = await mkdtemp(join(tmpdir(), 'managed-native-invalid-control-'));
  const resolveVmUrl = vi.fn().mockResolvedValue(null);
  try {
    await writeFile(join(root, 'fliwright.config.ts'),
      "export default {native:{enabled:true,platform:'android',deviceId:'owned',targetAppId:'example.app'}};");
    await expect(runCommand({ cwd: root, print: false, scenarioMode: 'managed-start',
      managedAppControl: { url: invalid === 'control' ? 'https://external.example' : 'http://127.0.0.1:9123',
        token: 'a'.repeat(64), sessionId: 'managed-native', timeoutMs: 1000 },
      nativeDelegation: { rootDir: join(root, 'lease'), key: 'a'.repeat(64), token: invalid === 'delegation' ? 'invalid' : 'b'.repeat(64) },
    }, { resolveVmUrl })).rejects.toThrow(invalid === 'control' ? 'loopback URL' : 'delegation is invalid');
    expect(resolveVmUrl).not.toHaveBeenCalled();
  } finally { await rm(root, { recursive: true, force: true }); }
});
