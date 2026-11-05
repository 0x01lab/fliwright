import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { verifyConsumerImports } from './verify-consumer-imports.mjs';
import { getReleasePackages } from './release-packages.mjs';

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, '..');
const packages = getReleasePackages(root).map(({ directory }) => directory);
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
    if (packageJson.name === '@fliwright/cli') {
      async function requireSkillTree(directory, prefix) {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
          const packedPath = `${prefix}/${entry.name}`;
          if (entry.isDirectory()) await requireSkillTree(join(directory, entry.name), packedPath);
          else if (!entries.includes(packedPath)) throw new Error(`${packageJson.name}: tarball is missing ${packedPath}`);
        }
      }
      for (const skill of ['fliwright-cli-workflows', 'fliwright-agent-memory', 'write-fliwright-tests', 'write-fliwright-mock-rules']) {
        await requireSkillTree(join(root, '.agents', 'skills', skill), `package/dist/skills/${skill}`);
      }
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
    await verifyConsumerImports(consumerDir);
    await mkdir(join(consumerDir, 'lib'), { recursive: true });
    await writeFile(join(consumerDir, 'pubspec.yaml'), 'name: clean_consumer\n');
    await writeFile(join(consumerDir, 'lib', 'main.dart'), 'void main() {}\n');
    const { stdout: setupOutput } = await execFileAsync(process.execPath, [
      join(consumerDir, 'node_modules', '@fliwright', 'cli', 'dist', 'index.js'),
      'init', '--agent', 'codex', '--yes', '--install', 'false', '--json',
    ], { cwd: consumerDir });
    const setup = JSON.parse(setupOutput);
    if (!setup.ok || setup.data.runtimeVerified !== false || setup.data.agent.skills.length !== 4 || setup.data.agent.conflicts.length) {
      throw new Error(`${packageManager}: installed CLI could not initialize Codex Skills`);
    }
    await readFile(join(consumerDir, '.agents', 'skills', 'fliwright-cli-workflows', 'references', 'commands', 'command-init.md'));
    await readFile(join(consumerDir, '.agents', 'skills', 'fliwright-agent-memory', 'references', 'memory-format.md'));
    await readFile(join(consumerDir, '.agents', 'skills', 'fliwright-agent-memory', 'assets', 'memory-entry.template.json'));
    console.log(`verified clean ${packageManager} consumer Codex initialization`);
    console.log(`verified clean ${packageManager} consumer install and public imports`);
  }
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
