import { expect, it } from 'vitest';
import { chmod, lstat, mkdir, mkdtemp, readFile, readlink, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectCheckoutCatalog, scanEnvironment, scanProcess, secureCatalogCheckout, scanFailureSummary, runCatalogScanner } from '../src/catalog-scanner.js';
import { vi } from 'vitest';

it('keeps nested dependency installs in their supervisor process group', async () => {
  const root = await mkdtemp(join(tmpdir(), 'catalog-process-group-'));
  const code = `const {execFileSync}=require('node:child_process'); console.log(JSON.stringify({pid:process.pid,group:Number(execFileSync('ps',['-o','pgid=','-p',String(process.pid)],{encoding:'utf8'}).trim())}));`;
  try {
    for (const group of ['isolated', 'inherit'] as const) {
      const output = await scanProcess(process.execPath, ['-e', code], root, scanEnvironment(root), new AbortController().signal, undefined, group);
      const result = JSON.parse(output);
      expect(result.pid === result.group).toBe(group === 'isolated');
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('returns cases through the actual worker collector subprocess without scenario declarations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'catalog-subprocess-'));
  try {
    await writeFile(join(root, 'package.json'), '{"type":"module"}');
    await symlink(fileURLToPath(new URL('../node_modules', import.meta.resolve('@fliwright/cli/run'))), join(root, 'node_modules'));
    await writeFile(join(root, 'proof.test.mjs'), `import { test } from 'vitest'; test('discovered case', () => {});`);
    const collected = await collectCheckoutCatalog(root, { smoke: '*.test.mjs' }, scanEnvironment(root), new AbortController().signal);
    expect(collected.scenarios).toEqual([]);
    expect(collected.suites[0].cases[0].titlePath).toEqual(['discovered case']);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 15000);

it('builds a credential-free environment and bounds scanner output', async () => {
  process.env.FLIWRIGHT_TEST_SECRET = 'must-not-pass';
  const env = scanEnvironment('/tmp/catalog-home');
  expect(env).not.toHaveProperty('FLIWRIGHT_TEST_SECRET');
  expect(env).not.toHaveProperty('SSH_AUTH_SOCK');
  expect(env).toMatchObject({ HOME: '/tmp/catalog-home', GIT_TERMINAL_PROMPT: '0' });
  delete process.env.FLIWRIGHT_TEST_SECRET;
  const root = await mkdtemp(join(tmpdir(), 'catalog-process-'));
  try {
    await expect(scanProcess(process.execPath, ['-e', "process.stdout.write('x'.repeat(64))"], root, env, new AbortController().signal, 16)).rejects.toThrow('output limit');
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 30);
    await expect(scanProcess(process.execPath, ['-e', 'setTimeout(()=>{},5000)'], root, env, controller.signal)).rejects.toThrow('cancelled or timed out');
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('prunes external, dangling and cyclic checkout links while preserving internal links and outside content', async () => {
  const root = await mkdtemp(join(tmpdir(), 'catalog-checkout-'));
  const checkout = join(root, 'checkout'), external = join(root, 'external');
  try {
    await mkdir(join(checkout, '.agents', 'skills'), { recursive: true });
    await mkdir(external);
    await writeFile(join(external, 'marker'), 'host content', { mode: 0o600 });
    await writeFile(join(checkout, 'inside'), 'test source', { mode: 0o600 });
    await symlink(external, join(checkout, '.agents', 'skills', 'local'));
    await symlink('../external/marker', join(checkout, 'external-file'));
    await symlink('.agents/skills/local/marker', join(checkout, 'chain'));
    await symlink('missing', join(checkout, 'dangling'));
    await symlink('cycle-b', join(checkout, 'cycle-a'));
    await symlink('cycle-a', join(checkout, 'cycle-b'));
    await symlink('inside', join(checkout, 'safe-link'));
    await symlink('.agents', join(checkout, 'safe-directory'));
    await symlink('safe-link', join(checkout, 'safe-chain'));
    // Sanitization must also work on links created by installation, before making sources read-only.
    for (const readonly of [false, true, true]) {
      await symlink(external, join(checkout, '.agents', 'skills', 'installed-local'));
      await expect(secureCatalogCheckout(checkout, readonly)).resolves.toBeUndefined();
      for (const name of ['.agents/skills/local', '.agents/skills/installed-local', 'external-file', 'chain', 'dangling', 'cycle-a', 'cycle-b'])
        await expect(lstat(join(checkout, name))).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await readFile(join(checkout, 'safe-chain'), 'utf8')).toBe('test source');
      expect(await readlink(join(checkout, 'safe-directory'))).toBe('.agents');
      expect(await readFile(join(external, 'marker'), 'utf8')).toBe('host content');
      expect((await stat(join(external, 'marker'))).mode & 0o777).toBe(0o600);
      expect((await stat(join(checkout, 'inside'))).mode & 0o222).toBe(readonly ? 0 : 0o200);
      await chmod(join(checkout, '.agents', 'skills'), 0o700);
    }
  } finally {
    for (const path of [checkout, join(checkout, '.agents'), join(checkout, '.agents', 'skills')]) await chmod(path, 0o700).catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});

it('reports a safe actionable cause to Cloud instead of discarding a known scan failure', async () => {
  const stop = new AbortController();
  const request = vi.fn(async (path: string) => {
    if (path === '/api/worker/scans/claim') return { scan: { scanId: 'scan' }, token: 'private-token', project: { repositoryCredentialRef: 'missing' } };
    if (path === '/api/worker/scans/failure') { stop.abort(); return {}; }
    return {};
  });
  const root = await mkdtemp(join(tmpdir(), 'catalog-error-'));
  try {
    await runCatalogScanner({ revision: 0, request, watchScan: () => () => {} } as never, { root, signal: stop.signal });
    expect(request).toHaveBeenCalledWith('/api/worker/scans/failure', expect.objectContaining({ body: expect.objectContaining({ error: 'Repository credential reference unavailable on worker. Configure repositoryCredentialHomes for this project.' }) }));
    expect(scanFailureSummary(new Error('password=private-secret'))).not.toContain('private-secret');
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('classifies process failures without publishing raw stderr or credentials', async () => {
  const root = await mkdtemp(join(tmpdir(), 'catalog-command-error-'));
  try {
    for (const [diagnostic, expected] of [
      ["fatal: could not read Username for 'https://secret@example.test': terminal prompts disabled", 'Git authentication failed'],
      ["Error: Scenario not configured: secret-scenario", 'Requested scenario is not declared'],
      ["Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'private-package'", 'A dependency could not be resolved'],
    ]) {
      try {
        await scanProcess(process.execPath, ['-e', `process.stderr.write(${JSON.stringify(diagnostic)}); process.exit(1)`], root, scanEnvironment(root), new AbortController().signal);
        expect.unreachable('process must fail');
      } catch (error) {
        const summary = scanFailureSummary(error);
        expect(summary).toContain(expected);
        expect(summary).not.toContain('secret');
        expect(summary).not.toContain('private-package');
      }
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
