import { afterAll, beforeAll, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { TestCatalogCollector } from '../src/testing/TestCatalogCollector.js';

let root: string;
let collector: TestCatalogCollector;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'fliwright-catalog-editor-'));
  await symlink(resolve('../../node_modules'), join(root, 'node_modules'), 'dir');
  const { bundleCatalogWorker } = await import(pathToFileURL(resolve('scripts/bundle-extension.mjs')).href);
  const worker = join(root, 'catalog-worker.mjs');
  await bundleCatalogWorker({ outfile: worker, sourcemap: false });
  collector = new TestCatalogCollector(pathToFileURL(worker));
});
afterAll(async () => { if (root) await rm(root, { recursive: true, force: true }); });

it('collects scenario, imported tables and generated tests from a portable worker without running hooks or fixtures', async () => {
  const integration = resolve('../fliwright-vitest/src/index.ts');
  await writeFile(join(root, 'data.ts'), "export const rows = ['home', 'assets'];");
  await writeFile(join(root, 'vitest.config.ts'), "export default { test: { include: ['wrong-pattern.test.ts'] } };");
  await writeFile(join(root, 'refresh.test.ts'), `
    import { createFliwrightTest } from ${JSON.stringify(integration)};
    import { describe, beforeAll } from 'vitest';
    import { appendFileSync } from 'node:fs';
    import { rows } from './data';
    const mark = value => appendFileSync(${JSON.stringify(join(root, 'executed'))}, value + '\\n');
    mark('module');
    beforeAll(() => mark('hook'));
    const test = createFliwrightTest({ vmServiceUrl: '', scenarios: {
      ready: { name: 'ready', layers: [{ kind: 'app', capability: 'fixture', method: 'prepare' }] }
    }});
    describe('balance [USD]', () => {
      test.scenario('ready').for(rows)('refresh / %s (REST)', () => mark('body'));
      test.scenario('ready').skip('skipped', () => mark('body'));
      test.scenario('ready').todo('later');
      for (const row of rows) test.scenario('ready')('generated ' + row, () => mark('body'));
    });
  `);
  const file = await collector.collect(root, 'refresh.test.ts');
  expect(file.nodes).toEqual([{ kind: 'group', title: 'balance [USD]', children: [
    { kind: 'test', title: 'refresh / home (REST)' },
    { kind: 'test', title: 'refresh / assets (REST)' },
    { kind: 'test', title: 'skipped' }, { kind: 'test', title: 'later' },
    { kind: 'test', title: 'generated home' }, { kind: 'test', title: 'generated assets' },
  ] }]);
  expect(await readFile(join(root, 'executed'), 'utf8')).toBe('module\n');
  await writeFile(join(root, 'data.ts'), "export const rows = ['updated'];");
  const updated = await collector.collect(root, 'refresh.test.ts');
  expect(JSON.stringify(updated)).toContain('refresh / updated (REST)');
  expect(JSON.stringify(updated)).not.toContain('refresh / home (REST)');
}, 30_000);

it('reports module import failures with their original cause', async () => {
  await writeFile(join(root, 'broken.test.ts'), "throw new Error('broken fixture import');");
  await expect(collector.collect(root, 'broken.test.ts')).rejects.toThrow('broken fixture import');
}, 15_000);

it('terminates a collection that exceeds its deadline', async () => {
  const worker = join(root, 'hanging.mjs');
  await writeFile(worker, 'setInterval(() => {}, 1000);');
  const bounded = new TestCatalogCollector(pathToFileURL(worker), 100);
  await expect(bounded.collect(root, 'refresh.test.ts')).rejects.toThrow(/timed out/i);
});

it('cancels a collection when the editor invalidates it', async () => {
  const worker = join(root, 'cancelled.mjs');
  await writeFile(worker, 'setInterval(() => {}, 1000);');
  const controller = new AbortController();
  const pending = new TestCatalogCollector(pathToFileURL(worker)).collect(root, 'refresh.test.ts', controller.signal);
  controller.abort();
  await expect(pending).rejects.toThrow(/abort/i);
});


it('collects a literal filename containing glob syntax', async () => {
  await writeFile(join(root, 'balance [USD].test.ts'), "import {test} from 'vitest'; test('literal file', () => {});");
  const result = await collector.collect(root, 'balance [USD].test.ts');
  expect(result.nodes).toEqual([{ kind: 'test', title: 'literal file' }]);
}, 15_000);

it('batches simultaneous file expansions into one collection process', async () => {
  const events = join(root, 'batch-events');
  const worker = join(root, 'counted-worker.mjs');
  await writeFile(worker, `
    import { appendFileSync } from 'node:fs';
    const request = JSON.parse(process.argv[2]);
    appendFileSync(${JSON.stringify(events)}, 'start\\n');
    await new Promise(resolve => setTimeout(resolve, 60));
    const files = Object.fromEntries((request.files ?? [request.file]).map(file => [file, {nodes:[{kind:'test',title:file}]}]));
    console.log('FLIWRIGHT_EDITOR_CATALOG=' + JSON.stringify({nodes: [{kind:'test',title:request.file}], files}));
    appendFileSync(${JSON.stringify(events)}, 'end\\n');
  `);
  const batched = new TestCatalogCollector(pathToFileURL(worker));
  const results = await Promise.all(['a.test.ts', 'b.test.ts', 'c.test.ts'].map(file => batched.collect(root, file)));
  expect(results.map(result => result.nodes[0].title)).toEqual(['a.test.ts', 'b.test.ts', 'c.test.ts']);
  const starts = (await readFile(events, 'utf8')).split('\n').filter(line => line === 'start').length;
  expect(starts).toBe(1);
});

it('keeps one active process when more files arrive during collection, and cancels only the departing subscriber', async () => {
  const events = join(root, 'serial-events');
  const worker = join(root, 'serial-worker.mjs');
  await writeFile(worker, `
    import { appendFileSync } from 'node:fs';
    const {files} = JSON.parse(process.argv[2]);
    appendFileSync(${JSON.stringify(events)}, 'start\\n');
    await new Promise(resolve => setTimeout(resolve, 180));
    console.log('FLIWRIGHT_EDITOR_CATALOG=' + JSON.stringify({files: Object.fromEntries(files.map(file => [file,{nodes:[{kind:'test',title:file}]}]))}));
    appendFileSync(${JSON.stringify(events)}, 'end\\n');
  `);
  const serial = new TestCatalogCollector(pathToFileURL(worker));
  const abort = new AbortController();
  const cancelled = serial.collect(root, 'cancel.test.ts', abort.signal);
  const cancelledResult = expect(cancelled).rejects.toThrow(/abort/i);
  const first = serial.collect(root, 'first.test.ts');
  await expect.poll(async () => readFile(events, 'utf8').catch(() => '')).toContain('start');
  const later = serial.collect(root, 'later.test.ts');
  abort.abort();
  await cancelledResult;
  expect((await first).nodes[0].title).toBe('first.test.ts');
  expect((await later).nodes[0].title).toBe('later.test.ts');
  expect((await readFile(events, 'utf8')).trim().split('\n')).toEqual(['start', 'end', 'start', 'end']);
});

it('isolates a broken module from healthy files in the same batch', async () => {
  await writeFile(join(root, 'healthy.test.ts'), "import {test} from 'vitest'; test('healthy', () => {});");
  await writeFile(join(root, 'bad-batch.test.ts'), "throw new Error('bad batch fixture');");
  const results = await Promise.allSettled([collector.collect(root, 'healthy.test.ts'), collector.collect(root, 'bad-batch.test.ts')]);
  expect(results[0]).toEqual({status:'fulfilled', value:{nodes:[{kind:'test',title:'healthy'}]}});
  expect(results[1].status).toBe('rejected');
  if (results[1].status === 'rejected') expect(results[1].reason.message).toContain('bad batch fixture');
}, 15_000);
