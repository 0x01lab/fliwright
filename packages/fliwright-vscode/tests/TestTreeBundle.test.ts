import { expect, it } from 'vitest';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

it('collects through the portable extension bundle and its adjacent catalog worker', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fliwright-bundled-test-tree-'));
  try {
    const { bundleExtension, bundleCatalogWorker } = await import(pathToFileURL(resolve('scripts/bundle-extension.mjs')).href);
    const bundle = join(root, 'extension.mjs');
    await bundleExtension({ entryPoints: ['src/testing/TestCatalogCollector.ts'], outfile: bundle, sourcemap: false });
    await bundleCatalogWorker({ outfile: join(root, 'catalog-worker.mjs'), sourcemap: false });
    await symlink(resolve('../../node_modules'), join(root, 'node_modules'), 'dir');
    await writeFile(join(root, 'portable.test.ts'), `import { test } from 'vitest'; test.for(['首页', 'assets'])('refresh %s', () => {});`);
    const source = `import { TestCatalogCollector } from ${JSON.stringify(pathToFileURL(bundle).href)};
      console.log(JSON.stringify(await new TestCatalogCollector().collect(${JSON.stringify(root)}, 'portable.test.ts')));`;
    const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '--eval', source]);
    expect(JSON.parse(stdout)).toEqual({ nodes: [
      { kind: 'test', title: 'refresh 首页' }, { kind: 'test', title: 'refresh assets' },
    ] });
  } finally { await rm(root, { recursive: true, force: true }); }
}, 20_000);
