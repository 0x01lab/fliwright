import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { verifyConsumerImports } from './verify-consumer-imports.mjs';
import { getReleasePackages, verifyReleaseVersion, registryConsumerManifest } from './release-packages.mjs';

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, '..');
const packages = getReleasePackages(root);
const version = verifyReleaseVersion(packages, process.env.FLIWRIGHT_REGISTRY_VERSION);
const consumer = await mkdtemp(join(tmpdir(), 'fliwright-registry-consumer-'));

try {
  await writeFile(join(consumer, 'package.json'), `${JSON.stringify(registryConsumerManifest(packages, version), null, 2)}\n`);

  const installArgs = [
    'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--prefer-online',
    '--package-lock=false',
  ];
  let lastError;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      await execFileAsync('npm', installArgs, { cwd: consumer });
      lastError = undefined;
      break;
    } catch (error) {
      lastError = error;
      if (attempt < 5) await new Promise((resolvePromise) => setTimeout(resolvePromise, 10_000));
    }
  }
  if (lastError) throw lastError;

  await verifyConsumerImports(consumer);
  console.log(`verified npm registry consumer for ${version}`);
} finally {
  await rm(consumer, { recursive: true, force: true });
}
