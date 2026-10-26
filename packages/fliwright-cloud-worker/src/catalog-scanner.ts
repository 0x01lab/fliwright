import { spawn } from 'node:child_process';
import { chmod, lstat, mkdir, mkdtemp, readdir, readlink, realpath, rm, unlink } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { type WorkerControlClient, type CatalogScanLease, type TestCatalog } from '@fliwright/cloud-protocol';

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
export async function secureCatalogCheckout(root: string, readonly = false) {
  root = await realpath(root);
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
      else if (freeze) await chmod(path, info.mode & ~0o222);
    }
    if (freeze) await chmod(directory, 0o555);
  };
  // Remove links before freezing any directory, including chains into another subtree.
  await walk(root, false);
  if (readonly) { count = 0; await walk(root, true); }
}
/** Collect through the same isolated subprocess used by leased scans. */
export async function collectCheckoutCatalog(project: string, suites: Record<string, string>, env: NodeJS.ProcessEnv, signal: AbortSignal) {
  const marker = 'FLIWRIGHT_CATALOG_RESULT=';
  const bootstrap = `const {collectCatalog}=await import(${JSON.stringify(import.meta.resolve('@fliwright/cli/run'))});const result=await collectCatalog(${JSON.stringify({ cwd: project, suites })});process.stdout.write(${JSON.stringify('\n' + marker)}+JSON.stringify(result)+${JSON.stringify('\n')});`;
  const output = await scanProcess(process.execPath, ['--input-type=module', '--eval', bootstrap], project, env, signal);
  const lines = output.split(/\r?\n/).filter(line => line.startsWith(marker));
  if (lines.length !== 1) throw new CatalogScanFailure('The collector did not return exactly one catalog result. Check the repository test configuration.');
  return JSON.parse(lines[0]!.slice(marker.length)) as Pick<TestCatalog, 'suites' | 'scenarios' | 'scannerVersion' | 'fliwrightVersion'>;
}
export async function executeCatalogScan(lease: CatalogScanLease, root: string, signal: AbortSignal, credentialHomes: Record<string, string> = {}): Promise<{ catalog: TestCatalog; head?: string }> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(join(root, 'scan-'));
  const home = join(directory, 'home'), checkout = join(directory, 'checkout');
  await mkdir(home, { mode: 0o700 });
  const env = scanEnvironment(home);
  const gitEnv = { ...env };
  try {
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
      const operation = program === 'git' ? args.find(arg => ['ls-remote', 'clone', 'fetch', 'checkout'].includes(arg)) :
        'install';
      throw new CatalogScanFailure(`[${operation ?? 'command'}] ${scanFailureSummary(error)}`);
    }
  };
    const git = (args: string[], cwd = directory) => command('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'protocol.file.allow=never', ...args], cwd, gitEnv);
    let head: string | undefined;
    if (lease.scan.branch) {
      const line = await git(['ls-remote', '--exit-code', '--', lease.project.repository, `refs/heads/${lease.scan.branch}`]);
      head = line.split(/\s/)[0];
      if (!/^[a-f0-9]{40}$/.test(head)) throw new CatalogScanFailure('Branch HEAD unavailable. Check the configured default branch.');
    }
    const commit = lease.scan.commit === '0'.repeat(40) ? head : lease.scan.commit;
    if (!commit || !/^[a-f0-9]{40}$/.test(commit)) throw new CatalogScanFailure('Invalid scan commit');
    await git(['clone', '--no-checkout', '--no-hardlinks', '--', lease.project.repository, checkout]);
    await git(['fetch', '--no-tags', 'origin', commit], checkout);
    await git(['checkout', '--detach', commit], checkout);
    await secureCatalogCheckout(checkout);
    const project = await realpath(resolve(checkout, lease.project.projectPath));
    if (outside(checkout, project)) throw new CatalogScanFailure('Project directory escapes checkout');
    for (const install of lease.project.install) await command(install.program, install.args, project);
    await secureCatalogCheckout(checkout, true);
    const collected = await collectCheckoutCatalog(project, lease.project.suites, env, signal).catch(error => {
      throw new CatalogScanFailure(`[collectCatalog] ${scanFailureSummary(error)}`);
    });
    return { catalog: { ...collected, catalogId: lease.scan.scanId, projectId: lease.scan.projectId, commit, configRevision: lease.scan.configRevision, createdAt: Date.now(), status: 'ready' }, ...(head ? { head } : {}) };
  } finally {
    // Read-only checkouts need directory write permission before removal.
    const writable = async (path: string): Promise<void> => {
      if (!(await lstat(path).catch(() => null))?.isDirectory()) return;
      await chmod(path, 0o700);
      for (const name of await readdir(path)) if (!(await lstat(join(path, name))).isSymbolicLink()) await writable(join(path, name));
    };
    await writable(directory);
    await rm(directory, { recursive: true, force: true });
  }
}
/** Independent controller; never claims a device slot. One scanner per worker identity. */
export async function runCatalogScanner(client: WorkerControlClient, options: { root: string; signal: AbortSignal; credentialHomes?: Record<string, string> }) {
  while (!options.signal.aborted) {
    const revision = client.revision;
    let claimed = false;
    try {
      const lease = await client.request<CatalogScanLease | null>('/api/worker/scans/claim', { method: 'POST', body: {}, signal: options.signal });
      if (lease) {
        claimed = true;
        const stop = new AbortController();
        const unwatch = client.watchScan(lease.scan.scanId, () => stop.abort());
        const signal = AbortSignal.any([stop.signal, options.signal, AbortSignal.timeout(300000)]);
        const key = { scanId: lease.scan.scanId, token: lease.token };
        const heartbeat = setInterval(() => { void client.request('/api/worker/scans/heartbeat', { method: 'POST', body: key }).catch(() => stop.abort()); }, 5000);
        try {
          const result = await executeCatalogScan(lease, options.root, signal, options.credentialHomes);
          await client.request('/api/worker/scans/result', { method: 'POST', body: { ...key, ...result }, signal });
        } catch (error) {
          if (!stop.signal.aborted && !options.signal.aborted)
            await client.request('/api/worker/scans/failure', { method: 'POST', body: { ...key, error: scanFailureSummary(error) }, signal: options.signal }).catch(() => {});
        } finally { clearInterval(heartbeat); unwatch(); }
      }
    } catch { /* A disconnected control plane cannot authorize further work. */ }
    if (!claimed) {
      try { await client.waitForWork(revision, options.signal); }
      catch { return; }
    }
  }
}
