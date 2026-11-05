import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { replaceFile } from '../src/files.js';

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, rename: vi.fn(actual.rename) };
});
const roots: string[] = [];
afterEach(async () => {
  vi.mocked(rename).mockClear();
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

it('rejects a stale replacement after another writer has changed the original', async () => {
  const root = await mkdtemp(join(tmpdir(), 'plan-write-')); roots.push(root);
  const path = join(root, 'plan.json');
  await writeFile(path, 'newer plan');
  await expect(replaceFile(path, 'stale update', { expected: 'older plan' })).rejects.toThrow(/changed/);
  expect(await readFile(path, 'utf8')).toBe('newer plan');
  expect(await readdir(root)).toEqual(['plan.json']);
});

it('preserves the original and removes temporary files when publication fails', async () => {
  const root = await mkdtemp(join(tmpdir(), 'plan-write-')); roots.push(root);
  const path = join(root, 'plan.json');
  await writeFile(path, 'original');
  vi.mocked(rename).mockRejectedValueOnce(new Error('publication failed'));
  await expect(replaceFile(path, 'replacement', { expected: 'original' })).rejects.toThrow('publication failed');
  expect(await readFile(path, 'utf8')).toBe('original');
  expect(await readdir(root)).toEqual(['plan.json']);
});
