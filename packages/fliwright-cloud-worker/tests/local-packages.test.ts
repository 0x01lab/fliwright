import { expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { installLocalPackages } from '../src/local-packages.js';
import { secureCatalogCheckout } from '../src/catalog-scanner.js';
const exec = promisify(execFile);

it('resolves a packed local build after a real isolated npm install and checkout sanitization', async () => {
  const root = await mkdtemp(join(tmpdir(), 'local-packages-install-'));
  try {
    const project = join(root, 'checkout'), bundle = join(root, 'bundle'), source = join(root, 'package');
    await mkdir(project); await mkdir(bundle); await mkdir(source);
    await writeFile(join(project, 'package.json'), JSON.stringify({ type: 'module', dependencies: { '@fliwright/core': 'workspace:*' } }));
    await writeFile(join(source, 'package.json'), JSON.stringify({ name: '@fliwright/core', version: '0.1.0', type: 'module', exports: './index.js' }));
    await writeFile(join(source, 'index.js'), `export const build = 'packed-local-build';`);
    await exec('tar', ['-czf', join(bundle, 'core.tgz'), '-C', root, 'package']);
    const sha256 = createHash('sha256').update(await readFile(join(bundle, 'core.tgz'))).digest('hex');
    await writeFile(join(bundle, 'packages.json'), JSON.stringify({ overrides: {}, packages: [{ name: '@fliwright/core', file: 'core.tgz', sha256 }] }));
    await installLocalPackages(project, join(bundle, 'packages.json'));
    await secureCatalogCheckout(project);
    const { stdout } = await exec(process.execPath, ['--input-type=module', '-e', `import {build} from '@fliwright/core'; console.log(build);`], { cwd: project });
    expect(stdout.trim()).toBe('packed-local-build');
  } finally { await rm(root, { recursive: true, force: true }); }
}, 15000);

it('installs packed dependencies inside each checkout without altering project workspace configuration', async () => {
  const root = await mkdtemp(join(tmpdir(), 'local-packages-'));
  try {
    const bundle = join(root, 'bundle'), project = join(root, 'checkout');
    await mkdir(bundle); await mkdir(project);
    const manifest = JSON.stringify({ dependencies: { '@fliwright/core': 'workspace:*', zod: '^3.25.76' }, devDependencies: { vitest: '5.0.0-beta.5' } });
    const workspace = "packages:\n  - .\n  - ../../fliwright/packages/*\n";
    await writeFile(join(project, 'package.json'), manifest);
    await writeFile(join(project, 'pnpm-workspace.yaml'), workspace);
    await writeFile(join(bundle, 'core.tgz'), 'packed-core');
    await writeFile(join(bundle, 'packages.json'), JSON.stringify({ overrides: { vitest: '5.0.5' }, packages: [{ name: '@fliwright/core', file: 'core.tgz', sha256: createHash('sha256').update('packed-core').digest('hex') }] }));
    let installs = 0;
    await installLocalPackages(project, join(bundle, 'packages.json'), async (cwd) => {
      installs++;
      const staged = JSON.parse(await readFile(join(cwd, 'package.json'), 'utf8'));
      const local = staged.dependencies['@fliwright/core'];
      expect(local).toMatch(/^file:/);
      expect(await readFile(join(cwd, local.slice(5)), 'utf8')).toBe('packed-core');
      expect(staged.dependencies).toMatchObject({ zod: '^3.25.76', vitest: '5.0.5' });
      expect(staged.overrides['@fliwright/core']).toBe(local);
      await mkdir(join(cwd, 'node_modules', 'core'), { recursive: true });
      await writeFile(join(cwd, 'node_modules', 'core', 'index.js'), 'export const packed = true;');
      await symlink('core', join(cwd, 'node_modules', 'linked'));
    });
    expect(installs).toBe(1);
    expect(await readFile(join(project, 'package.json'), 'utf8')).toBe(manifest);
    expect(await readFile(join(project, 'pnpm-workspace.yaml'), 'utf8')).toBe(workspace);
    await secureCatalogCheckout(project);
    expect(await readFile(join(project, 'node_modules', 'linked', 'index.js'), 'utf8')).toContain('packed');
    expect(await realpath(join(project, 'node_modules'))).toContain(project);
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('rejects corrupt bundles before running installation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'local-packages-corrupt-'));
  try {
    await writeFile(join(root, 'package.json'), '{}');
    await writeFile(join(root, 'core.tgz'), 'tampered');
    await writeFile(join(root, 'packages.json'), JSON.stringify({ overrides: {}, packages: [{ name: '@fliwright/core', file: 'core.tgz', sha256: '0'.repeat(64) }] }));
    await expect(installLocalPackages(root, join(root, 'packages.json'), async () => { throw new Error('must not install'); })).rejects.toThrow(/digest/i);
  } finally { await rm(root, { recursive: true, force: true }); }
});
