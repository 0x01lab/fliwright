import { createHash } from 'node:crypto';
import { lstat, mkdtemp, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { z } from 'zod';
import { scanEnvironment, scanProcess } from './catalog-scanner.js';

const bundleSchema = z.object({ overrides: z.record(z.string().min(1)), packages: z.array(z.object({
  name: z.string().regex(/^@fliwright\/[a-z][a-z0-9-]*$/),
  file: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.tgz$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict()).min(1) }).strict();

/** Install a deployment-owned package bundle into one checkout, preserving its manifests. */
export async function installLocalPackages(
  project: string,
  bundlePath: string,
  install?: (directory: string) => Promise<void>,
): Promise<void> {
  project = resolve(project);
  bundlePath = resolve(bundlePath);
  const bundle = bundleSchema.parse(JSON.parse(await readFile(bundlePath, 'utf8')));
  const manifest = JSON.parse(await readFile(join(project, 'package.json'), 'utf8'));
  if (await lstat(join(project, 'node_modules')).catch(() => null)) throw new Error('Checkout already contains node_modules');
  const stage = await mkdtemp(join(project, '.fliwright-packages-'));
  const local: Record<string, string> = {};
  for (const entry of bundle.packages) {
    if (Object.hasOwn(local, entry.name)) throw new Error('Duplicate local package');
    const source = join(dirname(bundlePath), entry.file);
    const data = await readFile(source);
    const digest = createHash('sha256').update(data).digest('hex');
    if (digest !== entry.sha256) throw new Error('Local package digest mismatch');
    const filename = basename(source);
    await writeFile(join(stage, filename), data);
    local[entry.name] = `file:./${filename}`;
  }
  const dependencies = { ...manifest.dependencies, ...manifest.devDependencies, ...bundle.overrides, ...local };
  for (const version of Object.values(dependencies)) {
    if (typeof version !== 'string' || /^(workspace:|link:|file:)/.test(version) && !Object.values(local).includes(version))
      throw new Error('Project local dependency is not supplied by the package bundle');
  }
  // A standalone npm manifest avoids host-relative workspace globs and Corepack downloads.
  await writeFile(join(stage, 'package.json'), JSON.stringify({ private: true, type: 'module', dependencies, overrides: { ...bundle.overrides, ...local } }));
  if (install) await install(stage);
  else await scanProcess('npm', ['install', '--ignore-scripts', '--no-package-lock', '--no-audit', '--no-fund', '--legacy-peer-deps',
    '--prefer-offline', '--maxsockets=3', '--fetch-timeout=20000', '--fetch-retries=2', '--fetch-retry-mintimeout=1000', '--fetch-retry-maxtimeout=3000',
    '--cache', join(dirname(bundlePath), 'npm-cache')],
    stage, scanEnvironment(stage), AbortSignal.timeout(240000), undefined, 'inherit');
  // Installed files belong to this checkout; the read-only pass never changes a host store.
  await rename(join(stage, 'node_modules'), join(project, 'node_modules'));
  await writeFile(join(stage, 'installed.json'), JSON.stringify({ packages: bundle.packages, project: relative(stage, project) }));
}
