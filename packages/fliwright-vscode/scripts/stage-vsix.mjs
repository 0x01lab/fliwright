import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stage = path.join(root, '.vsix-stage');

await fs.rm(stage, { recursive: true, force: true });
await fs.mkdir(stage, { recursive: true });

for (const entry of ['dist', 'media', 'README.md', 'CHANGELOG.md', 'LICENSE.md']) {
  await fs.cp(path.join(root, entry), path.join(stage, entry), { recursive: true });
}

const manifest = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
if (manifest.name !== 'fliwright-vscode') {
  throw new Error(`VS Code extension name must be fliwright-vscode, got ${manifest.name}`);
}
manifest.scripts = {};
manifest.files = [
  'dist/**',
  'media/fliwright.svg',
  'media/fliwright-marketplace.png',
  'README.md',
  'CHANGELOG.md',
  'LICENSE.md',
];
delete manifest.private;
delete manifest.dependencies;
delete manifest.devDependencies;

await fs.writeFile(path.join(stage, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
