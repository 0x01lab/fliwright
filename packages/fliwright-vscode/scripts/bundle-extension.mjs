import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliRequire = createRequire(import.meta.resolve('@fliwright/cli'));
const jitiManifestPath = cliRequire.resolve('jiti/package.json');
const jitiManifest = JSON.parse(readFileSync(jitiManifestPath, 'utf8'));
// The lazy entry resolves Babel relative to import.meta.url after bundling.
// Its public static entry lets esbuild include that transform in the VSIX.
const jitiStatic = path.resolve(path.dirname(jitiManifestPath), jitiManifest.exports['./static'].import);

export function bundleExtension(options = {}) {
  return build({
    absWorkingDir: root,
    entryPoints: ['src/extension.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    external: ['vscode'],
    alias: { jiti: jitiStatic },
    outfile: 'dist/extension.js',
    sourcemap: true,
    // Bundled CommonJS dependencies inspect
    // their module location during initialization, even in the ESM VSIX.
    banner: { js: 'import{createRequire as __fliwrightCreateRequire}from"module";import{fileURLToPath as __fliwrightFileURLToPath}from"node:url";import{dirname as __fliwrightDirname}from"node:path";const require=__fliwrightCreateRequire(import.meta.url);const __filename=__fliwrightFileURLToPath(import.meta.url);const __dirname=__fliwrightDirname(__filename);' },
    ...options,
  });
}

export function bundleCatalogWorker(options = {}) {
  return bundleExtension({
    entryPoints: ['src/testing/catalog-worker.ts'],
    outfile: 'dist/catalog-worker.mjs',
    ...options,
  });
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await bundleExtension();
  await bundleCatalogWorker();
}
