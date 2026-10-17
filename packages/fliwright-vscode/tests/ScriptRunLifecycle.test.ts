import { it, expect } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { Uri } from 'vscode';
import { ScriptRunner } from '../src/scripts/ScriptRunner.js';
import { terminalScriptCommand } from '../src/extension.js';

it.each(['editor', 'terminal', 'editor support', 'terminal support'] as const)('runs a project script with the shared preset and configuration through the %s path', async (entry) => {
  const root = await mkdtemp(join(tmpdir(), 'fliwright-script-lifecycle-'));
  const runId = `script-${entry}`;
  const runsRoot = join(root, 'runs');
  try {
    await symlink(resolve('../../e2e/node_modules'), join(root, 'node_modules'), 'dir');
    await writeFile(join(root, 'package.json'), '{"type":"module"}');
    await writeFile(join(root, 'fliwright.config.ts'), `export default { recording: { mode: 'off' },
      scenarios: { seeded: { name: 'seeded', layers: [] } }, paths: { scripts: 'qa/tasks' } };`);
    await mkdir(join(root, 'qa/tasks'), { recursive: true });
    const file = 'qa/tasks/proof.script.ts';
    const support = entry.endsWith('support');
    if (support) {
      await mkdir(join(root, 'qa/support'), { recursive: true });
      await writeFile(join(root, 'qa/support/app-script.ts'), `import { script as base, extendFliwrightTest } from '@fliwright/vitest';
        export const script = extendFliwrightTest<{ project: string }>(base, {
          project: async ({}, use) => { await use('project fixture'); },
        });`);
    }
    await writeFile(join(root, file), `import { script } from '${support ? '../support/app-script.js' : '@fliwright/vitest'}';
      import assert from 'node:assert/strict';
      script('project script', async ({ timeline${support ? ', project' : ''} }) => {
        ${support ? "assert.equal(project, 'project fixture');" : ''}
        assert.equal(timeline.recorder.toJSON().mode, 'script');
        assert.equal(JSON.parse(process.env.FLIWRIGHT_CONFIG!).scenarios.seeded.name, 'seeded');
        const node = timeline.recorder.startNode('step', 'durable script work');
        timeline.recorder.passNode(node.id);
      });`);
    if (entry.startsWith('editor')) {
      const result = await new ScriptRunner().run({ workspaceRoot: Uri.file(root),
        script: { kind: 'scriptFile', uri: Uri.file(join(root, file)), label: 'proof' }, runsRoot, runId });
      expect(result, result.stderr ?? result.stdout).toMatchObject({ passed: true, runId });
      const manifest = JSON.parse(await readFile(join(runsRoot, runId, 'run.json'), 'utf8'));
      const report = JSON.parse(await readFile(join(runsRoot, runId, 'report.json'), 'utf8'));
      expect(manifest).toMatchObject({ runId, status: 'passed', evidenceStatus: 'disabled' });
      expect(manifest.tests).toHaveLength(1);
      expect(report).toMatchObject({ passed: true, artifacts: { runId } });
    } else {
      const command = await terminalScriptCommand(Uri.file(root), {
        kind: 'scriptFile', uri: Uri.file(join(root, file)), label: 'proof',
      });
      expect(command).toContain('--config');
      expect(command.replace(/\\/g, '/')).toContain('vitest/vitest.mjs run qa/tasks/proof.script.ts');
      const child = await promisify(exec)(command, {
          cwd: root, env: { ...process.env, FLIWRIGHT_RUN_ID: runId, FLIWRIGHT_RUNS_ROOT: runsRoot }, timeout: 15000,
        });
      expect(child.stdout).toContain('1 passed');
    }
    const files: string[] = [];
    const { glob } = await import('node:fs/promises');
    for await (const file of glob('**/result.json', { cwd: join(runsRoot, runId) })) files.push(file);
    const attempts = await Promise.all(files.filter(file => file.includes('/attempts/')).map(async file =>
      JSON.parse(await readFile(join(runsRoot, runId, file), 'utf8'))));
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({ testOutcome: 'passed', evidenceStatus: 'disabled', testFile: file,
      testPath: ['project script'] });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 25000);
