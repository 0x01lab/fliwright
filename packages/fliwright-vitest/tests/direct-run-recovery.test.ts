import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = resolve(dirname(fileURLToPath(import.meta.url)), '../../../node_modules/vitest/vitest.mjs');

describe('direct Vitest terminal recovery', () => {
  it('uses the preset to recover terminal artifacts after worker persistence exhausts its deadline', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-direct-recovery-'));
    const runs = join(root, 'runs');
    let retainEvidence = false;
    try {
      await mkdir(join(root, '.fliwright/tests'), { recursive: true });
      await writeFile(join(root, 'observer.mjs'), `
        import { writeFile } from 'node:fs/promises';
        export default class Observer {
          async onTestRunEnd(modules) {
            await writeFile(${JSON.stringify(join(root, 'recovery.json'))}, JSON.stringify(modules.flatMap(
              module => [...module.children.allTests()].flatMap(test => test.meta().fliwrightRecovery ?? [])
            )));
          }
        }
      `);
      await writeFile(join(root, 'vitest.config.mjs'), `
        import { fliwrightPreset } from ${JSON.stringify(import.meta.resolve('@fliwright/vitest/preset'))};
        export default { root: ${JSON.stringify(root)}, ...fliwrightPreset({ runsRoot: ${JSON.stringify(runs)},
          recording: { mode: 'standard', requireAssertions: false, testFinalizationBudgetMs: 150 },
          test: { include: ['.fliwright/tests/*.test.mjs'], maxWorkers: 1,
            reporters: ['dot', './observer.mjs'] },
        }) };
      `);
      await writeFile(join(root, '.fliwright/tests/persistence.test.mjs'), `
        import { createFliwrightTest } from ${JSON.stringify(import.meta.resolve('@fliwright/vitest'))};
        const test = createFliwrightTest({ vmServiceUrl: '', requireAssertions: false, log: { format: 'silent' } });
        for (const failed of [false, true]) test(failed ? 'original business failure' : 'successful body', async ({ timeline }) => {
          const write = timeline.artifactStore.writeTimeline.bind(timeline.artifactStore);
          timeline.artifactStore.writeTimeline = (data, options) => data.status === 'running'
            ? write(data, options) : new Promise(() => {});
          await timeline.artifactStore.writeTimeline(timeline.recorder.toJSON());
          if (failed) throw new Error('original business failure');
        });
      `);
      const child = spawn(process.execPath, [cli, 'run', '--config', join(root, 'vitest.config.mjs')], {
        cwd: root, env: { ...process.env, FLIWRIGHT_RUN_ID: 'direct-recovery', FLIWRIGHT_RUNS_ROOT: runs },
        stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000,
      });
      let output = '';
      child.stdout.on('data', (chunk) => { output += chunk; });
      child.stderr.on('data', (chunk) => { output += chunk; });
      const code = await new Promise<number | null>((resolveCode, reject) => {
        child.once('error', reject); child.once('close', resolveCode);
      });
      await writeFile(join(root, 'vitest-output.log'), output);
      expect(code, output).toBe(1);
      const recovery = JSON.parse(await readFile(join(root, 'recovery.json'), 'utf8'));
      expect(recovery).toHaveLength(2);
      expect(recovery.map(({ timeline }: { timeline: { status: string } }) => timeline.status).sort()).toEqual(['failed', 'passed']);
      const tests = join(runs, 'direct-recovery/tests');
      const ids = await readdir(tests);
      expect(ids).toHaveLength(2);
      for (const id of ids) {
        const dir = join(tests, id, 'attempts/attempt-0');
        const result = JSON.parse(await readFile(join(dir, 'result.json'), 'utf8'));
        const timeline = JSON.parse(await readFile(join(dir, 'timeline.json'), 'utf8'));
        const trace = JSON.parse(await readFile(join(dir, 'trace/trace.json'), 'utf8'));
        const outcome = result.testName === 'successful body' ? 'passed' : 'failed';
        expect(result).toMatchObject({ finalized: true, testOutcome: outcome, evidenceStatus: 'partial' });
        expect(timeline.status).toBe(outcome);
        expect(trace.meta.status).toBe(outcome);
        expect(result.evidenceIssues).toContainEqual(expect.stringContaining('Artifact persistence'));
        if (outcome === 'failed') expect(result.runnerErrors).toContainEqual(expect.objectContaining({ message: 'original business failure' }));
      }
      expect(output).not.toContain('Hook timed out');
    } catch (error) {
      retainEvidence = true;
      throw new Error(`Direct-run recovery evidence retained at ${root}`, { cause: error });
    } finally { if (!retainEvidence) await rm(root, { recursive: true, force: true }); }
  }, 15_000);
});
