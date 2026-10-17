import { it, expect } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

it('loads and reloads TypeScript project scenarios from the portable extension bundle', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fliwright-bundled-config-'));
  try {
    const { bundleExtension } = await import(pathToFileURL(resolve('scripts/bundle-extension.mjs')).href);
    const project = join(root, 'project');
    await mkdir(project);
    await writeFile(join(project, 'scenario.ts'), `export interface ScenarioName { name: string }
      export const scenario: ScenarioName & { layers: never[] } = { name: 'first', layers: [] };`);
    await writeFile(join(project, 'fliwright.config.ts'), `import { scenario } from './scenario.ts';
      export default { scenarios: { fixture: scenario } };`);
    const bundle = join(root, 'portable', 'config.mjs');
    await bundleExtension({
      entryPoints: undefined,
      stdin: { contents: "export { resolveProjectConfig } from '@fliwright/cli';", resolveDir: process.cwd(), sourcefile: 'config-entry.mjs' },
      outfile: bundle,
      sourcemap: false,
    });
    const source = `import { resolveProjectConfig } from ${JSON.stringify(pathToFileURL(bundle).href)};
      import { writeFile } from 'node:fs/promises';
      const first = await resolveProjectConfig(${JSON.stringify(project)}, {}, {});
      await writeFile(${JSON.stringify(join(project, 'scenario.ts'))}, "export const scenario = { name: 'second', layers: [] };");
      const second = await resolveProjectConfig(${JSON.stringify(project)}, {}, {});
      console.log(JSON.stringify([first.scenarios.fixture.name, second.scenarios.fixture.name]));`;
    const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '--eval', source]);
    expect(JSON.parse(stdout.trim())).toEqual(['first', 'second']);
    expect(await readFile(bundle, 'utf8')).not.toContain('fliwright-bundled-config-');
  } finally { await rm(root, { recursive: true, force: true }); }
}, 20000);

it('runs project-installed Vitest from a portable bundle outside the dependency tree', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fliwright-bundled-run-'));
  try {
    const { bundleExtension } = await import(pathToFileURL(resolve('scripts/bundle-extension.mjs')).href);
    const project = join(root, 'project');
    await mkdir(project);
    await symlink(resolve('../../e2e/node_modules'), join(project, 'node_modules'), 'dir');
    await writeFile(join(project, 'package.json'), '{"type":"module"}');
    await writeFile(join(project, 'vitest.config.mjs'), 'export default { test: { maxWorkers: 1 } };');
    await writeFile(join(project, 'proof.test.mjs'), `import { test, expect } from 'vitest';
      test('project runner proof', () => expect(2 + 2).toBe(4));`);
    const bundle = join(root, 'portable', 'run.mjs');
    await bundleExtension({
      entryPoints: undefined,
      stdin: { contents: "export { runCommand } from '@fliwright/cli/run';", resolveDir: process.cwd(), sourcefile: 'run-entry.mjs' },
      outfile: bundle,
      sourcemap: false,
    });
    const source = `import { runCommand } from ${JSON.stringify(pathToFileURL(bundle).href)};
      const result = await runCommand({ cwd: ${JSON.stringify(project)}, runsRoot: ${JSON.stringify(join(root, 'runs'))},
        testPattern: 'proof.test.mjs', print: false }, { resolveVmUrl: async () => 'ws://unused' });
      console.log(JSON.stringify({ passed: result.passed, count: result.passedTests, errors: result.runnerErrors }));`;
    const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '--eval', source]);
    expect(JSON.parse(stdout.trim())).toMatchObject({ passed: true, count: 1 });
  } finally { await rm(root, { recursive: true, force: true }); }
}, 20000);
