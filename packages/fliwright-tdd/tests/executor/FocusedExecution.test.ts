import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PersistentTestExecutor } from '../../src/executor/PersistentTestExecutor.js';

describe('focused execution contract', () => {
  let root: string;
  const executor = new PersistentTestExecutor();

  beforeAll(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'fliwright-focus-')));
    const vitest = JSON.stringify(import.meta.resolve('vitest'));
    await writeFile(join(root, 'vitest.config.mjs'), `export default { root: ${JSON.stringify(root)}, test: { include: ['*.test.mjs'] } };`);
    await writeFile(join(root, 'names.test.mjs'), `import { test, expect, describe } from ${vitest};
      test('saves (draft)', () => expect(true).toBe(true));
      test('saves draft', () => { throw Error('different test'); });
      describe('Wallet', () => test('saves', () => expect(true).toBe(true)));
      describe('First', () => test('duplicate', () => expect(true).toBe(true)));
      describe('Second', () => test('duplicate', () => { throw Error('second duplicate failed'); }));`);
    await writeFile(join(root, 'hook.test.mjs'), `import { test, expect, afterAll } from ${vitest};
      test('passes', () => expect(true).toBe(true));
      afterAll(() => { throw Error('cleanup failed'); });`);
    await executor.boot({ configRoot: join(root, 'vitest.config.mjs'), runsRoot: join(root, 'artifacts') });
  }, 20_000);

  afterAll(async () => {
    await executor.dispose();
    await rm(root, { recursive: true, force: true });
  });

  it('treats punctuation in a test name literally', async () => {
    expect(await executor.rerun(join(root, 'names.test.mjs'), 'saves (draft)')).toMatchObject({ status: 'green' });
  });

  it('focuses a nested test by its full name', async () => {
    expect(await executor.rerun(join(root, 'names.test.mjs'), 'Wallet > saves')).toMatchObject({ status: 'green', testName: 'Wallet > saves' });
  });

  it('does not hide a failed matching test behind a passing one', async () => {
    const result = await executor.rerun(join(root, 'names.test.mjs'), 'duplicate');
    expect(result).toMatchObject({ status: 'red', failure: { message: expect.stringContaining('second duplicate failed') } });
  });

  it('includes suite teardown failures in the run outcome', async () => {
    expect(await executor.rerun(join(root, 'hook.test.mjs'), 'passes')).toMatchObject({ status: 'red', failure: { message: expect.stringContaining('cleanup failed') } });
  });

  it('does not reuse a previous file failure for a later passing focus', async () => {
    expect(await executor.rerun(join(root, 'names.test.mjs'), 'saves (draft)')).toMatchObject({ status: 'green' });
  });

  it('keeps a nonexistent target red with an actionable error', async () => {
    expect(await executor.rerun(join(root, 'names.test.mjs'), 'absent')).toMatchObject({ status: 'red', failure: { message: expect.stringMatching(/no matching test/i) } });
  });

  it('accepts a project directory as configRoot for CLI cycles', async () => {
    await executor.dispose();
    await executor.boot({ configRoot: root, runsRoot: join(root, 'artifacts') });
    expect(await executor.rerun(join(root, 'names.test.mjs'), 'saves (draft)')).toMatchObject({ status: 'green' });
  });
});
