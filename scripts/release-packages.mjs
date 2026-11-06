import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** One source of truth for public npm releases and clean consumer verification. */
export function getReleasePackages(root = resolve(import.meta.dirname, '..')) {
  const packages = new Map();
  for (const entry of readdirSync(join(root, 'packages'), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const directory = `packages/${entry.name}`;
    const path = join(root, directory, 'package.json');
    if (!entry.isDirectory() || !existsSync(path)) continue;
    const manifest = JSON.parse(readFileSync(path, 'utf8'));
    if (!manifest.private && manifest.name?.startsWith('@fliwright/')) {
      packages.set(manifest.name, { name: manifest.name, version: manifest.version, directory, manifest });
    }
  }
  const ordered = [], visiting = new Set(), visited = new Set();
  function visit(name) {
    if (visiting.has(name)) throw new Error(`Public package dependency cycle at ${name}`);
    if (visited.has(name)) return;
    const entry = packages.get(name);
    if (!entry) throw new Error(`${name} must be included in the public release graph`);
    visiting.add(name);
    for (const [dependency, range] of Object.entries({ ...entry.manifest.dependencies, ...entry.manifest.optionalDependencies, ...entry.manifest.peerDependencies })) {
      if (range.startsWith('workspace:')) visit(dependency);
    }
    visiting.delete(name);
    visited.add(name);
    ordered.push(entry);
  }
  for (const name of packages.keys()) visit(name);
  if (!ordered.length) throw new Error('No public npm packages found');
  return ordered;
}

export function verifyReleaseVersion(packages, tag) {
  if (!/^npm-v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(tag ?? '')) throw new Error('Expected npm-v<version> release tag');
  const version = tag.slice('npm-v'.length);
  for (const item of packages) if (item.version !== version) throw new Error(`${item.name}@${item.version} does not match ${tag}`);
  return version;
}

export function registryConsumerManifest(packages, version) {
  return {
    name: 'fliwright-registry-consumer', private: true, type: 'module',
    dependencies: Object.fromEntries(packages.map(({ name }) => [name, version])),
    devDependencies: { vitest: '5.0.5' },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const packages = getReleasePackages();
  if (process.argv[2] === 'verify') verifyReleaseVersion(packages, process.env.GITHUB_REF_NAME);
  else if (process.argv[2] === 'list') console.log(packages.map(({ name }) => name).join('\n'));
  else throw new Error('Usage: node scripts/release-packages.mjs <list|verify>');
}
