import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, mkdtemp, readdir, readlink, realpath, unlink, writeFile } from 'node:fs/promises';
import type { WorkerDiagnostics } from './diagnostics.js';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { catalogCommitSchema, unresolvedCatalogCommit, type WorkerControlClient, type CatalogScanLease, type TestCatalog } from '@fliwright/cloud-protocol';
import { catalogWorkspace, projectInCheckout } from './catalog-workspace.js';
import { removeSpoolPath } from './spool.js';

/** Only errors constructed by the scanner may be published to Cloud. */
class CatalogScanFailure extends Error {}
export function scanFailureSummary(error: unknown): string {
  return error instanceof CatalogScanFailure ? error.message.slice(0, 4000) :
    'Collection failed unexpectedly. Check the Worker configuration and local diagnostics.';
}
const outside = (root: string, path: string) => {
  const location = relative(root, path);
  return location === '..' || location.startsWith('../') || isAbsolute(location);
};

/** The collector never inherits host HOME, device endpoints, cloud tokens or SSH agent. */
export function scanEnvironment(home: string): NodeJS.ProcessEnv {
  return { PATH: process.env.PATH, HOME: home, TMPDIR: home, LANG: 'en_US.UTF-8', CI: 'true', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0', NODE_OPTIONS: '--max-old-space-size=512' };
}
export async function scanProcess(program: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, signal: AbortSignal, maxBytes = 4 * 1024 * 1024, processGroup: 'isolated' | 'inherit' = 'isolated'): Promise<string> {
  signal.throwIfAborted();
  return new Promise((resolveResult, reject) => {
    const child = spawn(program, args, { cwd, env, detached: processGroup === 'isolated', stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', stderr = '', size = 0, failure: Error | undefined;
    const kill = () => { if (child.pid) { try { if (processGroup === 'isolated') process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch {} } };
    const abort = () => { failure = new CatalogScanFailure('Scan cancelled or timed out'); kill(); };
    signal.addEventListener('abort', abort, { once: true });
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) { failure = new CatalogScanFailure('Scan output limit exceeded'); kill(); }
      else if (stream === child.stdout) output += String(chunk);
      else stderr = (stderr + String(chunk)).slice(-8192);
    });
    child.once('error', () => { failure = new CatalogScanFailure('Scan executable could not start. Check the Worker PATH and configured tools.'); });
    child.once('close', code => {
      signal.removeEventListener('abort', abort);
      kill(); // Reap descendants even after the leader exits normally.
      if (failure) reject(failure);
      else if (code !== 0) {
        // Classify diagnostics; never forward arbitrary repository output, URLs or credentials.
        const detail = /could not read Username|Authentication failed|Permission denied \(publickey\)/i.test(stderr)
          ? 'Git authentication failed. Check the project credential reference and Worker credential mapping.'
          : /Scenario not configured:/i.test(stderr)
            ? 'Requested scenario is not declared in fliwright.config. Match the Cloud scenario names to the repository configuration.'
            : /Cannot find (?:package|module)|ERR_MODULE_NOT_FOUND|ERR_PNPM_WORKSPACE_PKG_NOT_FOUND/i.test(stderr)
              ? 'A dependency could not be resolved. Configure project installation commands and ensure workspace packages exist in the checkout.'
              : /EACCES|EROFS|read-only file system/i.test(stderr)
                ? 'The collector attempted to write to the read-only checkout. Configure cache/output paths outside the source tree.'
                : `Scan command exited with code ${code ?? 'unknown'}.`;
        reject(new CatalogScanFailure(detail));
      }
      else resolveResult(output);
    });
  });
}
/** Prune host-only/broken links in an owned checkout; never traverse or modify their targets. */
export async function secureCatalogCheckout(root: string, readonly = false, modes?: Array<{ path: string; mode: number }>) {
  root = await realpath(root);
  const freezePath = async (path: string, mode: number) => {
    if (!(mode & 0o222)) return;
    modes?.push({ path, mode });
    await chmod(path, mode & ~0o222);
  };
  let count = 0;
  const walk = async (directory: string, freeze: boolean) => {
    for (const name of await readdir(directory)) {
      if (name === '.git') continue;
      if (++count > 100000) throw new CatalogScanFailure('Checkout file limit exceeded');
      const path = join(directory, name), info = await lstat(path);
      if (info.isSymbolicLink()) {
        if (freeze) continue;
        const target = resolve(directory, await readlink(path));
        let remove = outside(root, target);
        if (!remove) {
          try { remove = outside(root, await realpath(path)); }
          catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (!['ENOENT', 'ENOTDIR', 'ELOOP'].includes(code ?? '')) throw error;
            remove = true;
          }
        }
        if (remove) await unlink(path);
      } else if (info.isDirectory()) await walk(path, freeze);
      else if (freeze) await freezePath(path, info.mode);
    }
    if (freeze) await freezePath(directory, (await lstat(directory)).mode);
  };
  // Remove links before freezing any directory, including chains into another subtree.
  await walk(root, false);
  if (readonly) { count = 0; await walk(root, true); }
}
/** Collect through the same isolated subprocess used by leased scans. */
export async function collectCheckoutCatalog(project: string, suites: Record<string, string>, suiteMode: 'patterns' | 'directories', env: NodeJS.ProcessEnv, signal: AbortSignal) {
  const marker = 'FLIWRIGHT_CATALOG_RESULT=';
  const bootstrap = `const {collectCatalog}=await import(${JSON.stringify(import.meta.resolve('@fliwright/cli/run'))});const result=await collectCatalog(${JSON.stringify({ cwd: project, suites, suiteMode })});process.stdout.write(${JSON.stringify('\n' + marker)}+JSON.stringify(result)+${JSON.stringify('\n')});`;
  const output = await scanProcess(process.execPath, ['--input-type=module', '--eval', bootstrap], project, env, signal);
  const lines = output.split(/\r?\n/).filter(line => line.startsWith(marker));
  if (lines.length !== 1) throw new CatalogScanFailure('The collector did not return exactly one catalog result. Check the repository test configuration.');
  return JSON.parse(lines[0]!.slice(marker.length)) as Pick<TestCatalog, 'suites' | 'scenarios' | 'mocks' | 'scannerVersion' | 'fliwrightVersion'>;
}
type CatalogCheckout = 'clone' | 'worktree';

export async function executeCatalogScan(lease: CatalogScanLease, root: string, signal: AbortSignal, credentialHomes: Record<string, string> = {}, options: {
  pinCommit?: (commit: string) => Promise<void>;
  checkout?: CatalogCheckout;
} = {}): Promise<{ catalog: TestCatalog; head?: string }> {
  root = resolve(root);
  await mkdir(root, { recursive: true, mode: 0o700 });
  root = await realpath(root);
  const directory = await mkdtemp(join(root, 'scan-'));
  const home = join(directory, 'home');
  let incompleteWorkspace: string | undefined;
  let removeLinkedCheckout: (() => Promise<void>) | undefined;
  try {
    await mkdir(home, { mode: 0o700 });
    const env = scanEnvironment(home);
    const gitEnv = { ...env };
    if (lease.project.repositoryCredentialRef) {
      const credentialHome = credentialHomes[lease.project.repositoryCredentialRef];
      if (!credentialHome) throw new CatalogScanFailure('Repository credential reference unavailable on worker. Configure repositoryCredentialHomes for this project.');
      // Deployment-owned read-only Git/SSH configuration. Never passed to install or collection.
      gitEnv.HOME = credentialHome;
      delete gitEnv.GIT_CONFIG_GLOBAL;
      if (process.env.SSH_AUTH_SOCK) gitEnv.SSH_AUTH_SOCK = process.env.SSH_AUTH_SOCK;
    }
    const command = async (program: string, args: string[], cwd = directory, environment = env) => {
      try { return await scanProcess(program, args, cwd, environment, signal); }
      catch (error) {
        const operation = program === 'git' ? args.find(arg => ['ls-remote', 'clone', 'fetch', 'checkout', 'rev-parse', 'init', 'worktree'].includes(arg)) : 'install';
        throw new CatalogScanFailure(`[${operation ?? 'command'}] ${scanFailureSummary(error)}`);
      }
    };
    const gitOptions = ['-c', 'core.hooksPath=/dev/null', '-c', 'protocol.file.allow=never'];
    const git = (args: string[], cwd = directory) => command('git', [...gitOptions, ...args], cwd, gitEnv);
    let commit = lease.scan.commit;
    let head: string | undefined;
    if (lease.scan.branch && (commit === unresolvedCatalogCommit || lease.push)) {
      const ref = `refs/heads/${lease.scan.branch}`;
      const output = await git(['ls-remote', '--refs', '--', lease.project.repository, ref]);
      const sha = output.split('\n').map(line => line.split('\t')).find(([, name]) => name === ref)?.[0];
      if (!sha || !catalogCommitSchema.safeParse(sha).success) throw new CatalogScanFailure('Branch HEAD unavailable. Check the selected branch.');
      head = sha;
    }
    if (commit === unresolvedCatalogCommit) {
      if (!head) throw new CatalogScanFailure('Branch HEAD unavailable. Check the selected branch.');
      if (!options.pinCommit) throw new CatalogScanFailure('Unable to pin branch commit. Check the Worker configuration.');
      await options.pinCommit(head);
      commit = head;
    }
    if (!catalogCommitSchema.safeParse(commit).success) throw new CatalogScanFailure('Invalid scan commit');
    const workspace = catalogWorkspace(root, lease.scan.scanId);
    await mkdir(join(root, 'projects'), { mode: 0o700, recursive: true });
    await mkdir(workspace, { mode: 0o700 });
    incompleteWorkspace = workspace;
    const checkout = join(workspace, 'checkout');
    if (options.checkout === 'worktree') {
      const key = createHash('sha256').update(JSON.stringify([lease.project.id, lease.project.repository, lease.project.repositoryCredentialRef])).digest('hex');
      const cache = join(root, 'repositories', `${key}.git`);
      await mkdir(cache, { mode: 0o700, recursive: true });
      await git(['init', '--bare', '--template=', cache]);
      // Keep one negotiation tip for future fetches. Live worktrees retain their own HEADs.
      await git(['--git-dir', cache, 'fetch', '--no-tags', '--no-write-fetch-head', '--no-auto-maintenance', '--update-shallow', '--force', '--', lease.project.repository, `${commit}:refs/fliwright/last-fetch`]);
      removeLinkedCheckout = async () => {
        const cleanupSignal = AbortSignal.timeout(15000);
        const registered = await scanProcess('git', [...gitOptions, '--git-dir', cache, 'worktree', 'list', '--porcelain', '-z'], directory, env, cleanupSignal);
        if (registered.split('\0').includes(`worktree ${checkout}`)) {
          await scanProcess('git', [...gitOptions, '--git-dir', cache, 'worktree', 'remove', '--force', checkout], directory, env, cleanupSignal);
        }
      };
      await git(['--git-dir', cache, 'worktree', 'add', '--detach', checkout, commit]);
    } else {
      await git(['clone', '--no-checkout', '--no-hardlinks', '--', lease.project.repository, checkout]);
      await git(['fetch', '--no-tags', 'origin', commit], checkout);
      await git(['checkout', '--detach', commit], checkout);
    }
    if ((await git(['rev-parse', 'HEAD'], checkout)).trim() !== commit) throw new CatalogScanFailure('Checkout identity mismatch');
    await secureCatalogCheckout(checkout);
    const project = projectInCheckout(checkout, lease.project.projectPath);
    if (lease.project.install.length) {
      const installHome = join(workspace, 'home');
      await mkdir(installHome, { mode: 0o700 });
      // Package metadata can reference downloaded dependencies by absolute path.
      const installEnv = { ...scanEnvironment(installHome), TMPDIR: home };
      for (const install of lease.project.install) await command(install.program, install.args, project, installEnv);
    }
    const modes: Array<{ path: string; mode: number }> = [];
    let collected;
    try {
      await secureCatalogCheckout(checkout, true, modes);
      collected = await collectCheckoutCatalog(project, lease.project.suites, lease.project.suiteMode, env, signal).catch(error => {
        throw new CatalogScanFailure(`[collectCatalog] ${scanFailureSummary(error)}`);
      });
    } finally {
      for (const { path, mode } of modes.reverse()) await chmod(path, mode);
    }
    signal.throwIfAborted();
    await writeFile(join(workspace, 'ready.json'), JSON.stringify({ projectId: lease.scan.projectId, commit, configRevision: lease.scan.configRevision }), { flag: 'wx', mode: 0o600 });
    incompleteWorkspace = undefined;
    return { catalog: { ...collected, catalogId: lease.scan.scanId, projectId: lease.scan.projectId, commit, configRevision: lease.scan.configRevision, createdAt: Date.now(), status: 'ready' }, ...(lease.push && head ? { head } : {}) };
  } finally {
    try {
      if (incompleteWorkspace) {
        await removeLinkedCheckout?.();
        await removeSpoolPath(incompleteWorkspace);
      }
    } finally { await removeSpoolPath(directory); }
  }
}
/** Independent controller; never claims a device slot. One scanner per worker identity. */
export async function runCatalogScanner(client: WorkerControlClient, options: {
  root: string;
  signal: AbortSignal;
  credentialHomes?: Record<string, string>;
  checkout?: CatalogCheckout;
  diagnostics?: WorkerDiagnostics;
}) {
  const { root, signal: workerSignal, diagnostics } = options;
  let scanning = false;
  let scanVersion = 0;
  const checkWorkspace = async () => {
    if (!diagnostics || scanning || workerSignal.aborted) return;
    const version = scanVersion;
    let count: number | null;
    try {
      const entries = await readdir(root, { withFileTypes: true });
      count = entries.filter(entry => entry.isDirectory() && entry.name.startsWith('scan-')).length;
    } catch (error) {
      count = (error as NodeJS.ErrnoException).code === 'ENOENT' ? 0 : null;
    }
    // A directory created by a scan that started during readdir is still in use.
    if (version === scanVersion && !workerSignal.aborted) diagnostics.recordCatalogWorkspace(count);
  };
  await checkWorkspace();
  const workspaceTimer = diagnostics && setInterval(() => void checkWorkspace(), 30000).unref();
  try {
    while (!workerSignal.aborted) {
      const revision = client.revision;
      let claimed = false;
      try {
        const lease = await client.request<CatalogScanLease | null>('/api/worker/scans/claim', { method: 'POST', body: {}, signal: workerSignal });
        if (lease) {
          claimed = true;
          const stop = new AbortController();
          const unwatch = client.watchScan(lease.scan.scanId, () => stop.abort());
          const signal = AbortSignal.any([stop.signal, workerSignal, AbortSignal.timeout(300000)]);
          const key = { scanId: lease.scan.scanId, token: lease.token };
          const heartbeat = setInterval(() => { void client.request('/api/worker/scans/heartbeat', { method: 'POST', body: key }).catch(() => stop.abort()); }, 5000);
          scanning = true;
          scanVersion++;
          try {
            const result = await executeCatalogScan(lease, root, signal, options.credentialHomes, {
              checkout: options.checkout,
              pinCommit: async commit => { await client.request('/api/worker/scans/pin', { method: 'POST', body: { ...key, commit }, signal }); },
            });
            try {
              await client.request('/api/worker/scans/result', { method: 'POST', body: { ...key, ...result }, signal });
            } catch (error) {
              // Control-plane rejections are deployment-owned messages, so the scanner may publish them.
              throw new CatalogScanFailure(`[result] ${error instanceof Error ? error.message : 'Scan result upload failed'}`);
            }
          } catch (error) {
            if (!stop.signal.aborted && !workerSignal.aborted) {
              const summary = scanFailureSummary(error);
              diagnostics?.record('error', 'catalog.scan_failed', `scan ${lease.scan.scanId}: ${summary}`);
              await client.request('/api/worker/scans/failure', { method: 'POST', body: { ...key, error: summary }, signal: workerSignal }).catch(() => {});
            }
          } finally {
            clearInterval(heartbeat);
            unwatch();
            scanning = false;
            await checkWorkspace();
          }
        }
      } catch { /* A disconnected control plane cannot authorize further work. */ }
      if (!claimed) {
        try { await client.waitForWork(revision, workerSignal); }
        catch { return; }
      }
    }
  } finally {
    clearInterval(workspaceTimer);
  }
}
