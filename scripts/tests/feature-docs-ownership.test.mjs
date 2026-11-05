import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
before(async () => {
  await promisify(execFile)(process.execPath, ['scripts/generate-feature-docs.mjs'], { cwd: root });
});

test('independent test-plan docs do not claim Flutter CLI commands', async () => {
  const directory = new URL('../../docs/features/test-plan/', import.meta.url);
  const files = await readdir(directory);
  assert.equal(files.some(file => file.startsWith('command-')), false);
  const overview = await readFile(new URL('README.md', directory), 'utf8');
  assert(overview.includes('[Plan.md]'));
  assert(overview.includes('[Coverage.md]'));
  assert(!overview.includes('app.snapshot'));
});

test('the Fliwright CLI retains the actual registry command references', async () => {
  const page = await readFile(new URL('../../docs/features/cli/command-app.snapshot.md', import.meta.url), 'utf8');
  assert(page.includes('app.snapshot'));
});
