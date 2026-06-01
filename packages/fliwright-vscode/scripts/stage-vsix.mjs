import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stage = path.join(root, '.vsix-stage');

await fs.rm(stage, { recursive: true, force: true });
await fs.mkdir(stage, { recursive: true });

for (const entry of ['dist', 'media', 'README.md', 'CHANGELOG.md']) {
  await fs.cp(path.join(root, entry), path.join(stage, entry), { recursive: true });
}

const manifest = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
manifest.name = 'fliwright-vscode';
manifest.scripts = {};
manifest.files = [
  'dist/extension.js',
  'dist/extension.js.map',
  'media/fliwright.svg',
  'README.md',
  'CHANGELOG.md',
];
delete manifest.private;
delete manifest.dependencies;
delete manifest.devDependencies;

await fs.writeFile(path.join(stage, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
