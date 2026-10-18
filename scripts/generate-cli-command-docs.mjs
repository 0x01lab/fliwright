#!/usr/bin/env node
// Build CLI dependencies first. Never executes documented app mutations.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createRegistry } from '../packages/fliwright-cli/dist/index.js';
import { validateInteractionSpec } from '../packages/fliwright-tdd/dist/index.js';
import { buildCommandReferences, exampleInvocation } from './cli-command-docs.mjs';

const check = process.argv.includes('--check');
if (process.argv.slice(2).some((arg) => arg !== '--check')) throw new Error('Usage: node scripts/generate-cli-command-docs.mjs [--check]');
const registry = createRegistry();
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'fliwright-command-docs-'));
try {
  const { pages, commands, examples } = await buildCommandReferences(registry, async (definition, example) => {
    const { args, structured } = exampleInvocation(definition, example);
    if (structured) await fs.writeFile(path.join(temporary, `fliwright-${definition.path}-input.json`), JSON.stringify(example.input));
    let calls = 0;
    const program = registry.program(async (selected, input) => {
      assert.equal(selected.path, definition.path);
      assert.deepEqual(input, definition.input.strict().parse(example.input));
      calls++;
    });
    program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
    await program.parseAsync([...args, '--cwd', temporary], { from: 'user' });
    assert.equal(calls, 1, `${definition.path}: example did not reach input validation`);
    if (example.input.spec) {
      const validation = validateInteractionSpec(example.input.spec);
      assert.equal(validation.ok, true, `${definition.path}: invalid spec example: ${JSON.stringify(validation)}`);
    }
  });
  const roots = [path.resolve('.agents/skills/fliwright-cli-workflows/references/commands')];
  if (check) roots.push(path.resolve('plugins/fliwright/skills/fliwright-cli-workflows/references/commands'));
  for (const root of roots) {
    if (check) {
      const actual = await fs.readdir(root).catch(() => []);
      assert.deepEqual(actual.sort(), [...pages.keys()].sort(), `Reference inventory drift: ${root}`);
      for (const [name, content] of pages) assert.equal(await fs.readFile(path.join(root, name), 'utf8'), content, `Stale reference: ${path.join(root, name)}`);
    } else {
      await fs.mkdir(root, { recursive: true });
      for (const name of await fs.readdir(root)) if (!pages.has(name)) throw new Error(`Unexpected reference; inspect before removing: ${path.join(root, name)}`);
      for (const [name, content] of pages) await fs.writeFile(path.join(root, name), content);
    }
  }
  console.log(`${check ? 'Checked' : 'Generated'} ${commands} command guides, ${examples} parsed examples, parameter coverage and portable links${check ? ' (source + plugin)' : ''}.`);
} finally { await fs.rm(temporary, { recursive: true, force: true }); }
