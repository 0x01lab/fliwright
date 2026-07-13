#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const sourceRoot = path.join(root, '.agents/skills');
const pluginRoot = path.join(root, 'plugins/fliwright');
const targetRoot = path.join(pluginRoot, 'skills');
const skillNames = [
  'fliwright-tdd',
  'write-fliwright-mock-rules',
  'write-fliwright-tests',
];

if (!fs.existsSync(path.join(pluginRoot, '.codex-plugin/plugin.json'))) {
  console.error(`Missing Fliwright plugin manifest at ${path.relative(root, pluginRoot)}.`);
  process.exit(1);
}

for (const skillName of skillNames) {
  const source = path.join(sourceRoot, skillName);
  const target = path.join(targetRoot, skillName);

  if (!fs.existsSync(source)) {
    console.error(`Missing source skill: ${path.relative(root, source)}`);
    process.exit(1);
  }

  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(source, target, { recursive: true });
  console.log(`Synced ${skillName}`);
}
