#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, readlinkSync, realpathSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const [role, destination, ...extra] = process.argv.slice(2);
const name = { server: '@fliwright/cloud', worker: '@fliwright/cloud-worker' }[role];
if (!name || !destination || extra.length) {
  console.error('Usage: pnpm cloud:deploy <new-directory> | pnpm cloud:deploy-worker <new-directory>');
  process.exit(1);
}
const output = resolve(destination);
if (existsSync(output)) {
  console.error('Deployment destination already exists. Choose a new release directory; keep configuration and data outside releases.');
  process.exit(1);
}
// Run pnpm's portable deployment from the workspace, regardless of the caller's cwd.
function pnpm(args) {
  const result = spawnSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', args, {
    cwd: root, stdio: 'inherit', shell: false,
  });
  if (result.error || result.status !== 0) {
    throw new Error('Cloud deployment failed. Check the build/install output; the new directory may contain an incomplete release.');
  }
}
try {
  pnpm(['--filter', `${name}...`, 'build']);
  // pnpm 11 legacy deploy writes its production-install settings into the source
  // workspace's validation cache even though its node_modules are unchanged.
  // Preserve that cache so the next build doesn't attempt a production reinstall.
  const statePath = resolve(root, 'node_modules/.pnpm-workspace-state-v1.json');
  const state = existsSync(statePath) ? readFileSync(statePath) : undefined;
  try {
    pnpm(['--config.hoist-workspace-packages=false', '--filter', name, 'deploy', '--legacy', '--prod', output]);
  } finally {
    if (state) writeFileSync(statePath, state);
  }
  const release = realpathSync(output);
  for (const entry of readdirSync(release, { recursive: true, withFileTypes: true })) {
    if (!entry.isSymbolicLink()) continue;
    const link = join(entry.parentPath, entry.name);
    const target = relative(release, realpathSync(link));
    if (isAbsolute(readlinkSync(link)) || target === '..' || target.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(target))
      throw new Error('Deployment contains a non-portable dependency link; do not publish this release.');
  }
  const binary = role === 'server' ? 'fliwright-cloud' : 'fliwright-worker';
  console.log(`Deployment ready: ${output}`);
  console.log(`Run with Node 26+: node ${JSON.stringify(resolve(output, binary))} --help`);
  console.log('Keep private config and persistent data outside the release directory.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
