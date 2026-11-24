import { expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { chmod, lstat, mkdir, mkdtemp, readFile, readlink, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectCheckoutCatalog, executeCatalogScan, scanEnvironment, scanProcess, secureCatalogCheckout, scanFailureSummary, runCatalogScanner } from '../src/catalog-scanner.js';
import { openCatalogWorkspace } from '../src/catalog-workspace.js';
import { projectSchema, unresolvedCatalogCommit, type CatalogScanLease, type TestRequest } from '@fliwright/cloud-protocol';
import { WorkerDiagnostics } from '../src/diagnostics.js';
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
    await mkdir(join(root, '.fliwright/mocks/api'), { recursive: true });
    await writeFile(join(root, '.fliwright/mocks/api/assets.json'), JSON.stringify({ endpoint: '/assets', method: 'GET', rules: [{ name: 'empty', status: 200, body: [] }] }));
    const collected = await collectCheckoutCatalog(root, { smoke: '*.test.mjs' }, scanEnvironment(root), new AbortController().signal);
    expect(collected.scenarios).toEqual([]);
    expect(collected.suites[0].cases[0].titlePath).toEqual(['discovered case']);
    expect(collected.mocks?.[0]).toEqual({ directory: '.fliwright/mocks', profiles: ['empty'], endpoints: [{ endpoint: '/assets', method: 'GET', rules: ['empty'], activeRule: 'empty' }] });
  } finally { await rm(root, { recursive: true, force: true }); }
}, 15000);

it('retains the scanned Git checkout and installed files at their original paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'catalog-reuse-'));
  const repository = join(root, 'repository'), tools = join(root, 'bin'), catalogs = join(root, 'catalogs');
  const commands = join(root, 'git.log');
  try {
    await mkdir(repository);
    const git = (args: string[]) => execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim();
    git(['init', '--quiet']);
    await writeFile(join(repository, 'package.json'), '{"type":"module"}');
    await writeFile(join(repository, 'proof.test.mjs'), `import { test } from ${JSON.stringify(import.meta.resolve('vitest'))}; test('retained case', () => {});`);
    git(['add', '.']);
    git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'fixture']);
    const commit = git(['rev-parse', 'HEAD']);
    const branch = 'releases/v1.5.0';
    git(['branch', branch, commit]);
    await writeFile(join(repository, 'proof.test.mjs'), `import { test } from ${JSON.stringify(import.meta.resolve('vitest'))}; test('updated case', () => {});`);
    git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-am', 'update']);
    const nextCommit = git(['rev-parse', 'HEAD']);
    const gitPath = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
    await mkdir(tools);
    await writeFile(join(tools, 'git'), `#!${process.execPath}
const { appendFileSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(commands)}, JSON.stringify(args) + '\\n');
// Allow the local fixture transport for this test only.
const result = spawnSync(${JSON.stringify(gitPath)}, args.map(arg => arg === 'protocol.file.allow=never' ? 'protocol.file.allow=always' : arg), { stdio: 'inherit' });
process.exit(result.status ?? 1);
`, { mode: 0o700 });
    vi.stubEnv('PATH', `${tools}:${process.env.PATH}`);
    const project = projectSchema.parse({ id: 'app', name: 'App', repository,
      suites: { smoke: '*.test.mjs' }, install: [{ program: process.execPath, args: ['-e',
        "const fs = require('node:fs'); const cache = require('node:path').join(process.env.HOME, 'cache'); fs.writeFileSync(cache, 'dependency'); fs.writeFileSync('resolved-dependency', cache);"] }] });
    const lease: CatalogScanLease = { project, token: 'test', expiresAt: 0, scan: { scanId: 'scan', projectId: project.id, commit, configRevision: project.configRevision, status: 'running', createdAt: 0, updatedAt: 0 } };
    const { catalog } = await executeCatalogScan(lease, catalogs, new AbortController().signal);
    expect(catalog.suites[0]?.cases[0]?.titlePath).toEqual(['retained case']);
    const request = { catalogId: catalog.catalogId, configRevision: catalog.configRevision, input: { targetId: project.id, commit }, target: project } as TestRequest;
    const workspace = openCatalogWorkspace(catalogs, request);
    expect(openCatalogWorkspace(catalogs, request)).toEqual(workspace);
    const dependency = await readFile(join(workspace.project, 'resolved-dependency'), 'utf8');
    expect(await readFile(dependency, 'utf8')).toBe('dependency');
    expect((await stat(join(workspace.project, 'proof.test.mjs'))).mode & 0o200).toBe(0o200);
    expect((await readFile(commands, 'utf8')).split('\n').filter(line => line.includes('"clone"'))).toHaveLength(1);
    expect((await lstat(join(catalogs, 'projects', catalog.catalogId, 'ready.json'))).isFile()).toBe(true);
    await expect(executeCatalogScan({ ...lease, scan: { ...lease.scan, scanId: 'failed' }, project: { ...project, install: [{ program: process.execPath, args: ['-e', 'process.exit(1)'] }] } }, catalogs, new AbortController().signal)).rejects.toThrow('[install]');
    await expect(lstat(join(catalogs, 'projects', 'failed'))).rejects.toMatchObject({ code: 'ENOENT' });

    const pinned = vi.fn(async (sha: string) => {
      expect(sha).toBe(commit);
      git(['branch', '--force', branch, nextCommit]);
    });
    const linked = { ...lease, scan: { ...lease.scan, scanId: 'linked-old', branch, commit: unresolvedCatalogCommit } };
    const oldVersion = await executeCatalogScan(linked, catalogs, new AbortController().signal, {}, { checkout: 'worktree', pinCommit: pinned });
    expect(pinned).toHaveBeenCalledTimes(1);
    expect(oldVersion.catalog.commit).toBe(commit);
    expect(oldVersion.catalog.suites[0]?.cases[0]?.titlePath).toEqual(['retained case']);
    const updated = { ...linked, scan: { ...linked.scan, scanId: 'linked-new', commit: nextCommit } };
    const newVersion = await executeCatalogScan(updated, catalogs, new AbortController().signal, {}, { checkout: 'worktree' });
    expect(newVersion.catalog.suites[0]?.cases[0]?.titlePath).toEqual(['updated case']);
    const oldCheckout = join(catalogs, 'projects', 'linked-old', 'checkout');
    const newCheckout = join(catalogs, 'projects', 'linked-new', 'checkout');
    const common = (directory: string) => git(['-C', directory, 'rev-parse', '--path-format=absolute', '--git-common-dir']);
    expect(common(oldCheckout)).toBe(common(newCheckout));
    await writeFile(join(oldCheckout, 'build-output'), 'old');
    await expect(lstat(join(newCheckout, 'build-output'))).rejects.toMatchObject({ code: 'ENOENT' });

    await expect(executeCatalogScan({ ...updated, scan: { ...updated.scan, scanId: 'linked-failed' }, project: { ...project, install: [{ program: process.execPath, args: ['-e', 'process.exit(1)'] }] } }, catalogs, new AbortController().signal, {}, { checkout: 'worktree' })).rejects.toThrow('[install]');
    await expect(lstat(join(catalogs, 'projects', 'linked-failed'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(git(['--git-dir', common(newCheckout), 'worktree', 'list', '--porcelain'])).not.toContain('linked-failed');
    expect(git(['-C', oldCheckout, 'rev-parse', 'HEAD'])).toBe(commit);
    expect(git(['-C', newCheckout, 'rev-parse', 'HEAD'])).toBe(nextCommit);
  } finally {
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  }
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

it('counts existing scan directories before claiming work and refreshes after a scan', async () => {
  const root = await mkdtemp(join(tmpdir(), 'catalog-workspace-'));
  const catalogs = join(root, 'catalogs');
  const leftover = join(catalogs, 'scan-leftover');
  const stop = new AbortController();
  try {
    await mkdir(leftover, { recursive: true });
    await mkdir(join(catalogs, 'unrelated'));
    await symlink(leftover, join(catalogs, 'scan-link'));
    await writeFile(join(catalogs, 'scan-file'), 'ignore');
    const diagnostics = new WorkerDiagnostics(root);
    const counts: Array<number | null | undefined> = [];
    const request = vi.fn(async (path: string) => {
      if (path !== '/api/worker/scans/claim') return {};
      counts.push(diagnostics.snapshot().catalogWorkspace?.directoryCount);
      if (counts.length === 1) {
        await rm(leftover, { recursive: true });
        return { scan: { scanId: 'scan' }, token: 'private-token', project: { repositoryCredentialRef: 'missing' } };
      }
      stop.abort();
      return null;
    });
    await runCatalogScanner({ revision: 0, request, watchScan: () => () => {} } as never, { root: catalogs, signal: stop.signal, diagnostics });
    expect(counts).toEqual([1, 0]);
    expect(request).toHaveBeenCalledWith('/api/worker/scans/failure', expect.anything());
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
