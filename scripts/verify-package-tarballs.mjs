import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, '..');
const packages = [
  'packages/fliwright-core',
  'packages/fliwright-vitest',
  'packages/fliwright-cli',
  'packages/fliwright-tdd',
  'packages/fliwright-plugin-riverpod',
];
const requiredEntries = ['package/package.json', 'package/README.md', 'package/LICENSE'];
const forbiddenPrefixes = ['package/src/', 'package/tests/', 'package/.fliwright/'];

const tempRoot = await mkdtemp(join(tmpdir(), 'fliwright-pack-'));
const tarballs = [];
try {
  for (const packageDir of packages) {
    const absolutePackageDir = join(root, packageDir);
    const packageJson = JSON.parse(await readFile(join(absolutePackageDir, 'package.json'), 'utf8'));
    await execFileAsync('pnpm', ['run', 'build'], { cwd: absolutePackageDir });
    const { stdout } = await execFileAsync(
      'pnpm',
      ['pack', '--pack-destination', tempRoot],
      { cwd: absolutePackageDir },
    );
    const tarball = stdout.trim().split(/\r?\n/).at(-1);
    if (!tarball) throw new Error(`${packageJson.name}: pnpm pack did not return a tarball path`);
    tarballs.push({ name: packageJson.name, path: tarball });

    const { stdout: listing } = await execFileAsync('tar', ['-tzf', tarball]);
    const entries = listing.trim().split(/\r?\n/);
    for (const required of requiredEntries) {
      if (!entries.includes(required)) {
        throw new Error(`${packageJson.name}: tarball is missing ${required}`);
      }
    }
    for (const forbidden of forbiddenPrefixes) {
      if (entries.some((entry) => entry.startsWith(forbidden))) {
        throw new Error(`${packageJson.name}: tarball contains forbidden ${forbidden}`);
      }
    }
    if (!entries.some((entry) => entry.startsWith('package/dist/'))) {
      throw new Error(`${packageJson.name}: tarball has no dist output`);
    }

    const { stdout: packedManifest } = await execFileAsync(
      'tar',
      ['-xOf', tarball, 'package/package.json'],
    );
    if (packedManifest.includes('workspace:')) {
      throw new Error(`${packageJson.name}: packed dependencies still contain workspace protocol`);
    }
    for (const field of ['description', 'license', 'repository', 'bugs', 'homepage', 'engines', 'publishConfig']) {
      if (packageJson[field] == null) {
        throw new Error(`${packageJson.name}: package.json is missing ${field}`);
      }
    }
    console.log(`verified ${packageJson.name}`);
  }

  for (const packageManager of ['npm', 'pnpm']) {
    const consumerDir = join(tempRoot, `${packageManager}-consumer`);
    await mkdir(consumerDir, { recursive: true });
    const localDependencies = Object.fromEntries(tarballs.map((item) => [item.name, `file:${item.path}`]));
    await writeFile(join(consumerDir, 'package.json'), JSON.stringify({
      name: `fliwright-${packageManager}-consumer`,
      private: true,
      type: 'module',
      dependencies: localDependencies,
      devDependencies: { vitest: '5.0.5' },
    }, null, 2));
    if (packageManager === 'pnpm') {
      await writeFile(join(consumerDir, 'pnpm-workspace.yaml'), [
        'packages:',
        "  - '.'",
        'overrides:',
        ...Object.entries(localDependencies).map(([name, value]) => `  '${name}': '${value}'`),
        '',
      ].join('\n'));
    }
    if (packageManager === 'npm') {
      await execFileAsync('npm', [
        'install', '--ignore-scripts', '--no-audit', '--no-fund',
      ], { cwd: consumerDir });
    } else {
      await execFileAsync('pnpm', ['install', '--ignore-scripts'], { cwd: consumerDir });
    }
    await execFileAsync(process.execPath, [
      '--input-type=module',
      '--eval',
      [
        "import { FliwrightDriver } from '@fliwright/core';",
        "import { defineConfig as defineCliConfig } from '@fliwright/cli';",
        "import { runCommand } from '@fliwright/cli/run';",
        "import { TddRuntime } from '@fliwright/tdd';",
        "import { riverpodPlugin } from '@fliwright/plugin-riverpod';",
        'if (![FliwrightDriver, defineCliConfig, runCommand, TddRuntime, riverpodPlugin].every(Boolean)) throw new Error("missing public export");',
      ].join('\n'),
    ], { cwd: consumerDir });
    await writeFile(join(consumerDir, 'vitest.config.mjs'), [
      "import { fliwrightPreset } from '@fliwright/vitest/preset';",
      "export default fliwrightPreset({ recording: { mode: 'off' }, test: { include: ['package-entry.test.mjs'] } });",
    ].join('\n'));
    await writeFile(join(consumerDir, 'package-entry.test.mjs'), [
      "import { test } from '@fliwright/vitest';",
      "import { expect } from 'vitest';",
      "test('loads the published Vitest fixture', () => { expect(typeof test).toBe('function'); });",
    ].join('\n'));
    await writeFile(join(consumerDir, 'vitest.config.mjs'), [
      "import { fliwrightPreset } from '@fliwright/vitest/preset';",
      "export default fliwrightPreset({ test: { include: ['package-entry.test.mjs'] } });",
    ].join('\n'));
    if (packageManager === 'npm') {
      await execFileAsync(process.execPath, [
        join(consumerDir, 'node_modules', 'vitest', 'vitest.mjs'),
        'run',
        'package-entry.test.mjs',
      ], { cwd: consumerDir });
    } else {
      await execFileAsync('pnpm', ['exec', 'vitest', 'run', 'package-entry.test.mjs'], { cwd: consumerDir });
    }
    console.log(`verified clean ${packageManager} consumer install and public imports`);
  }
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
