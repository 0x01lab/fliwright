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
    banner: { js: 'import{createRequire as __fliwrightCreateRequire}from"module";const require=__fliwrightCreateRequire(import.meta.url);' },
    ...options,
  });
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await bundleExtension();
}
