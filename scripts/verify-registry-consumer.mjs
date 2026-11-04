import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, '..');
const version = process.env.FLIWRIGHT_REGISTRY_VERSION?.replace(/^npm-v/, '');
if (!version) {
  throw new Error('FLIWRIGHT_REGISTRY_VERSION must contain the published npm version.');
}

const packages = [
  '@fliwright/devices',
  '@fliwright/core',
  '@fliwright/vitest',
  '@fliwright/cli',
  '@fliwright/tdd',
  '@fliwright/plugin-riverpod',
];
const consumer = await mkdtemp(join(tmpdir(), 'fliwright-registry-consumer-'));

try {
  await writeFile(join(consumer, 'package.json'), `${JSON.stringify({
    name: 'fliwright-registry-consumer',
    private: true,
    type: 'module',
    dependencies: Object.fromEntries(packages.map((name) => [name, version])),
    devDependencies: { vitest: '5.0.5' },
  }, null, 2)}\n`);

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

  await execFileAsync(process.execPath, [
    '--input-type=module',
    '--eval',
    [
      "import { FliwrightDriver } from '@fliwright/core';",
      "import { DeviceDiscovery } from '@fliwright/devices';",
      "import { defineConfig } from '@fliwright/cli';",
      "import { runCommand } from '@fliwright/cli/run';",
      "import { TddRuntime } from '@fliwright/tdd';",
      "import { riverpodPlugin } from '@fliwright/plugin-riverpod';",
      'if (![DeviceDiscovery, FliwrightDriver, defineConfig, runCommand, TddRuntime, riverpodPlugin].every(Boolean)) throw new Error("missing registry export");',
    ].join('\n'),
  ], { cwd: consumer });
  await writeFile(join(consumer, 'vitest.config.mjs'), [
    "import { fliwrightPreset } from '@fliwright/vitest/preset';",
    "export default fliwrightPreset({ test: { include: ['registry-entry.test.mjs'] } });",
  ].join('\n'));
  await writeFile(join(consumer, 'registry-entry.test.mjs'), [
    "import { test } from '@fliwright/vitest';",
    "import { expect } from 'vitest';",
    "test('loads the registry Vitest fixture', () => { expect(typeof test).toBe('function'); });",
  ].join('\n'));
  await execFileAsync(process.execPath, [
    join(consumer, 'node_modules', 'vitest', 'vitest.mjs'),
    'run', 'registry-entry.test.mjs',
  ], { cwd: consumer });
  console.log(`verified npm registry consumer for ${version}`);
} finally {
  await rm(consumer, { recursive: true, force: true });
}
