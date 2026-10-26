#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const [destination, ...extra] = process.argv.slice(2);
if (!destination || extra.length) throw new Error('Usage: node scripts/pack-local-packages.mjs <new-bundle-directory>');
const output = resolve(destination);
mkdirSync(output, { mode: 0o700 });
const roots = ['@fliwright/cli', '@fliwright/vitest', '@fliwright/plugin-riverpod'];
const packages = new Map(readdirSync(join(root, 'packages'), { withFileTypes: true }).filter(entry => entry.isDirectory()).flatMap(entry => {
  try {
    const directory = join(root, 'packages', entry.name);
    const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
    return [[manifest.name, { directory, manifest }]];
  } catch { return []; }
}));
const selected = new Set();
function visit(name) {
  if (selected.has(name)) return;
  const entry = packages.get(name);
  if (!entry) throw new Error(`Missing workspace package ${name}`);
  selected.add(name);
  for (const [dependency, version] of Object.entries({ ...entry.manifest.dependencies, ...entry.manifest.peerDependencies })) {
    if (version.startsWith('workspace:')) visit(dependency);
  }
}
roots.forEach(visit);
function pnpm(args, cwd = root) {
  const result = spawnSync('pnpm', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  if (result.error || result.status !== 0) throw new Error('Local package build or pack failed');
  return result.stdout;
}
process.stdout.write(pnpm([...roots.flatMap(name => ['--filter', `${name}...`]), 'build']));
const packed = [];
for (const name of selected) {
  const { directory } = packages.get(name);
  const tarball = pnpm(['pack', '--pack-destination', output], directory).trim().split(/\r?\n/).at(-1);
  const file = basename(tarball);
  packed.push({ name, file, sha256: createHash('sha256').update(readFileSync(join(output, file))).digest('hex') });
  console.log(`Packed ${name}`);
}
const overrides = {
  vitest: packages.get('@fliwright/vitest').manifest.dependencies.vitest,
  vite: JSON.parse(readFileSync(join(root, 'node_modules/vite/package.json'), 'utf8')).version,
};
writeFileSync(join(output, 'packages.json'), JSON.stringify({ overrides, packages: packed }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
console.log(`Package bundle: ${join(output, 'packages.json')}`);
