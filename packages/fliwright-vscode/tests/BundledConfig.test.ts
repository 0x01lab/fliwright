import { it, expect } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { defineSupportSettings, missingSupportSettingMessage, saveSupportSettings } from '@fliwright/core';

it('loads and reloads TypeScript scenarios with explicit mock sources from the portable extension bundle', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fliwright-bundled-config-'));
  try {
    const { bundleExtension } = await import(pathToFileURL(resolve('scripts/bundle-extension.mjs')).href);
    const project = join(root, 'project');
    await mkdir(project);
    const sources = [{ name: 'item', directory: '.fliwright/test-plans/437/mocks', files: ['api/user.json'] }];
    const rule = { source: 'item', method: 'POST', endpoint: '/user', rule: 'ready', replace: true };
    await writeFile(join(project, 'scenario.ts'), `export interface ScenarioName { name: string }
      export const scenario = { name: 'first', layers: [{ kind: 'mocks',
        sources: ${JSON.stringify(sources)}, rules: [${JSON.stringify(rule)}] }] } satisfies ScenarioName & { layers: unknown[] };`);
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
      await writeFile(${JSON.stringify(join(project, 'scenario.ts'))}, ${JSON.stringify(`export const scenario = { name: 'second', layers: [{ kind: 'mocks', sources: ${JSON.stringify(sources)}, rules: [${JSON.stringify({ ...rule, rule: 'review' })}] }] };`)});
      const second = await resolveProjectConfig(${JSON.stringify(project)}, {}, {});
      console.log(JSON.stringify([first.scenarios.fixture, second.scenarios.fixture]));`;
    const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '--eval', source]);
    expect(JSON.parse(stdout.trim())).toEqual([
      { name: 'first', layers: [{ kind: 'mocks', sources, rules: [rule] }] },
      { name: 'second', layers: [{ kind: 'mocks', sources, rules: [{ ...rule, rule: 'review' }] }] },
    ]);
    expect(await readFile(bundle, 'utf8')).not.toContain('fliwright-bundled-config-');
  } finally { await rm(root, { recursive: true, force: true }); }
}, 20000);

it('reads saved support settings in a plain script and in a project Vitest run launched from the portable CLI bundle', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fliwright-bundled-run-'));
  try {
    const { bundleExtension } = await import(pathToFileURL(resolve('scripts/bundle-extension.mjs')).href);
    const project = join(root, 'project');
    await mkdir(project);
    await symlink(resolve('../../e2e/node_modules'), join(project, 'node_modules'), 'dir');
    await writeFile(join(project, 'package.json'), '{"type":"module"}');
    const settings = defineSupportSettings({ id: 'setup', title: 'Setup', fields: {
      route: { type: 'string', label: 'Start route', required: true },
    } });
    const nested = join(project, '.fliwright', 'support');
    await mkdir(nested, { recursive: true });
    await writeFile(join(nested, 'settings.mjs'), `export const settings = ${JSON.stringify(settings)};`);
    await writeFile(join(project, 'fliwright.config.ts'), `import { settings } from './.fliwright/support/settings.mjs';
      export default { supportSettings: [settings] };`);
    const env = { ...process.env, FLIWRIGHT_RUNTIME_ROOT: join(root, 'runtime') };
    const saved = await saveSupportSettings(settings, { revision: null, changes: { route: '/persisted' } }, { projectRoot: project, env });
    await writeFile(join(nested, 'read.mjs'), `import { readSupportSettings } from '@fliwright/core';
      import { settings } from './settings.mjs';
      console.log(await readSupportSettings(settings).then(values => values.route));`);
    const exec = promisify(execFile);
    const { stdout: scriptValue } = await exec(process.execPath, ['read.mjs'], { cwd: nested, env: { ...env, FLIWRIGHT_PROJECT_ROOT: '' } });
    expect(scriptValue.trim()).toBe('/persisted');
    await writeFile(join(project, 'vitest.config.mjs'), 'export default { test: { maxWorkers: 1 } };');
    await writeFile(join(project, 'proof.test.mjs'), `import { test, expect } from 'vitest';
      import { readFliwrightEnvironment, readSupportSettings } from '@fliwright/core';
      import { settings } from './.fliwright/support/settings.mjs';
      test('project runner proof', async () => {
        expect(readFliwrightEnvironment(process.env).supportSettings).toEqual([settings]);
        expect(await readSupportSettings(settings)).toEqual({ route: '/persisted' });
      });`);
    const bundle = join(root, 'portable', 'run.mjs');
    await bundleExtension({
      entryPoints: undefined,
      stdin: { contents: "export { runCommand } from '@fliwright/cli/run';", resolveDir: process.cwd(), sourcefile: 'run-entry.mjs' },
      outfile: bundle,
      sourcemap: false,
    });
    const source = `import { runCommand } from ${JSON.stringify(pathToFileURL(bundle).href)};
      const result = await runCommand({ cwd: ${JSON.stringify(nested)}, runsRoot: ${JSON.stringify(join(root, 'runs'))},
        testPattern: 'proof.test.mjs', print: false }, { resolveVmUrl: async () => 'ws://unused' });
      console.log(JSON.stringify({ passed: result.passed, count: result.passedTests, results: result.results }));`;
    const { stdout } = await exec(process.execPath, ['--input-type=module', '--eval', source], { env });
    expect(JSON.parse(stdout.trim())).toMatchObject({ passed: true, count: 1 });
    await saveSupportSettings(settings, { revision: saved.revision, changes: { route: null } }, { projectRoot: project, env });
    const { stdout: failedOutput } = await exec(process.execPath, ['--input-type=module', '--eval', source], { env });
    const failure = JSON.parse(failedOutput.trim());
    expect(failure.passed).toBe(false);
    expect(missingSupportSettingMessage(failure.results[0].error)).toContain(`Local settings file ${saved.file}.`);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 20000);
