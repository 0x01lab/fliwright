import { describe, it, expect } from 'vitest';
import { chmod, mkdir, mkdtemp, readdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { collectCatalog, catalogCaseId } from '../src/catalog.js';
import { runCommand } from '../src/commands/run.js';

describe('catalog collection and exact selection', () => {
  it('collects mock rule choices without publishing response bodies or requiring scenarios', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-catalog-mocks-'));
    try {
      await mkdir(join(root, '.fliwright/mocks/api'), { recursive: true });
      await writeFile(join(root, '.fliwright/mocks/api/user.json'), JSON.stringify({
        endpoint: '/user', method: 'GET', rules: [
          { name: 'success', status: 200, body: { privateValue: 'must-not-be-published' } },
          { name: 'guest', status: 200, body: {} },
        ],
      }));
      const result = await collectCatalog({ cwd: root, suites: {} });
      expect(result.mocks).toEqual([{ directory: '.fliwright/mocks', endpoints: [
        { endpoint: '/user', method: 'GET', rules: ['success', 'guest'], activeRule: 'success' },
      ], profiles: ['guest', 'success'] }]);
      expect(JSON.stringify(result)).not.toContain('must-not-be-published');
      expect(result.scenarios).toEqual([]);
      await mkdir(join(root, 'custom-mocks/api'), { recursive: true });
      await writeFile(join(root, 'custom-mocks/mock-index.json'), JSON.stringify({ defaultRule: 'empty', files: ['api/assets.json'] }));
      await writeFile(join(root, 'custom-mocks/api/assets.json'), JSON.stringify({ endpoint: '/assets', method: 'GET', rules: [{ name: 'empty', status: 200, body: [] }] }));
      await writeFile(join(root, 'fliwright.config.ts'), `export default { scenarios: { custom: { name: 'custom', layers: [{ kind: 'mocks', directory: 'custom-mocks' }] } } };`);
      const custom = await collectCatalog({ cwd: root, suites: {} });
      expect(custom.mocks.map(item => item.directory)).toEqual(['.fliwright/mocks', 'custom-mocks']);
      expect(custom.mocks[1]?.endpoints[0]?.activeRule).toBe('empty');
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('collects a TypeScript Vitest configuration from a read-only checkout without writing into it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-catalog-readonly-'));
    try {
      await writeFile(join(root, 'vitest.config.ts'), 'export default { test: {} };');
      await writeFile(join(root, 'proof.test.mjs'), `import { test } from ${JSON.stringify(import.meta.resolve('vitest'))}; test('read-only case', () => {});`);
      const files = await readdir(root);
      for (const file of files) await chmod(join(root, file), 0o444);
      await chmod(root, 0o555);
      const result = await collectCatalog({ cwd: root, suites: { smoke: '*.test.mjs' } });
      expect(result.suites[0]?.cases[0]?.titlePath).toEqual(['read-only case']);
      expect(await readdir(root)).toEqual(files);
    } finally { await chmod(root, 0o700); await rm(root, { recursive: true, force: true }); }
  });

  it('discovers repository scenarios and collects cases when no scenarios are declared', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-catalog-discovery-'));
    try {
      await symlink(resolve('../../node_modules'), join(root, 'node_modules'));
      await writeFile(join(root, 'proof.test.mjs'), `import { test } from 'vitest'; test('discovered case', () => {});`);
      for (const scenarios of [undefined, { guest: { name: 'guest', layers: [] } }]) {
        await writeFile(join(root, 'fliwright.config.ts'), `export default ${JSON.stringify({ scenarios })};`);
        // Replays the stale Cloud default; catalog discovery must use the repository.
        const request = { cwd: root, suites: { smoke: '*.test.mjs' }, scenarios: ['clean'] };
        const result = await collectCatalog(request);
        expect(result.scenarios.map(item => item.name)).toEqual(Object.keys(scenarios ?? {}));
        expect(result.suites[0]?.cases[0]?.titlePath).toEqual(['discovered case']);
      }
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('collects dynamic Fliwright cases without a VM or hooks, then runs only the selected duplicate', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-catalog-'));
    try {
      await symlink(resolve('../../node_modules'), join(root, 'node_modules'));
      await writeFile(join(root, 'fliwright.config.ts'), `export default { scenarios: { clean: { name:'clean', layers: [] } } };`);
      await writeFile(join(root, 'proof.test.mjs'), `
        import { createFliwrightTest } from ${JSON.stringify(import.meta.resolve('@fliwright/vitest'))};
        import { describe, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
        import { appendFileSync } from 'node:fs';
        const mark = value => appendFileSync(${JSON.stringify(join(root, 'markers'))}, value+'\\n');
        const test = createFliwrightTest({ vmServiceUrl:'ws://unused', requireAssertions:false, recording:{mode:'off'}, log:{format:'silent'} });
        mark('module');
        for(const hook of [beforeAll,beforeEach,afterEach,afterAll]) hook(()=>mark('hook'));
        describe('group',()=>{ for(const index of [0,1]) test('same',()=>mark('body'+index)); });
      `);
      const result = await collectCatalog({ cwd: root, suites: { smoke: '*.test.mjs' } });
      expect(await readFile(join(root, 'markers'), 'utf8')).toBe('module\n');
      expect(result.suites[0]?.cases.map(item => [item.titlePath, item.duplicateIndex])).toEqual([[['group', 'same'], 0], [['group', 'same'], 1]]);
      const selected = result.suites[0]!.cases[1]!;
      expect(selected.caseId).toBe(catalogCaseId('proof.test.mjs', ['group', 'same'], 1));
      const run = await runCommand({ cwd: root, testPattern: selected.file, caseSelection: selected, runsRoot: join(root, 'runs'), print: false }, { resolveVmUrl: async () => 'ws://unused' });
      expect(run.passed, JSON.stringify(run)).toBe(true);
      const markers = await readFile(join(root, 'markers'), 'utf8');
      expect(markers).toContain('body1');
      expect(markers).not.toContain('body0');
    } finally { await rm(root, { recursive: true, force: true }); }
  }, 30000);
});

it('collects multiple test files in one cases-only pass without scanning Mock responses', async () => {
  const { collectTestCases } = await import('../src/catalog.js');
  const root = await mkdtemp(join(tmpdir(), 'fliwright-cases-only-'));
  try {
    await symlink(resolve('../../node_modules'), join(root, 'node_modules'));
    await mkdir(join(root, '.fliwright/mocks/api'), { recursive: true });
    await writeFile(join(root, '.fliwright/mocks/api/broken.json'), 'not JSON');
    for (const name of ['a', 'b']) await writeFile(join(root, `${name}.test.mjs`), `import {test} from 'vitest'; test('${name}', () => {});`);
    await writeFile(join(root, 'broken.test.mjs'), "throw new Error('invalid fixture');");
    const result = await collectTestCases({ cwd: root, patterns: ['*.test.mjs'] });
    expect(result.filter(file => !file.errors.length).flatMap(file => file.cases.map(item => item.titlePath))).toEqual([['a'], ['b']]);
    expect(result.find(file => file.file === 'broken.test.mjs')?.errors).toEqual([expect.stringContaining('invalid fixture')]);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 15000);
