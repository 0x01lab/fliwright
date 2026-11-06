import { resolveFliwrightRunsRoot } from '@fliwright/core';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, mkdtemp, readdir, writeFile, rm, realpath, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { defaultArtifactsRoot, PersistentTestExecutor } from '../../src/executor/PersistentTestExecutor.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('PersistentTestExecutor.rerun', () => {
  it('loads large shared configuration by path in fork workers and restores the parent path after disposal', async () => {
    const project = await mkdtemp(resolve(tmpdir(), 'fliwright-tdd-large-config-'));
    const executor = new PersistentTestExecutor();
    const previousPath = process.env.FLIWRIGHT_CONFIG_PATH;
    try {
      const testFile = resolve(project, 'proof.test.mjs');
      const configFile = resolve(project, 'vitest.config.mjs');
      await writeFile(configFile, `export default { root: ${JSON.stringify(project)}, test: { include: ['proof.test.mjs'] } };`);
      await writeFile(testFile, `import { test, expect } from ${JSON.stringify(import.meta.resolve('vitest'))};
        import { readFileSync } from 'node:fs';
        import { spawnSync } from 'node:child_process';
        test('large config', () => {
          expect(process.env.FLIWRIGHT_CONFIG).toBeUndefined();
          const config = JSON.parse(readFileSync(process.env.FLIWRIGHT_CONFIG_PATH, 'utf8'));
          expect(config.scenarios.large.layers[0].seed.payload.length).toBe(2 * 1024 * 1024);
          const child = spawnSync(process.execPath, ['-e', 'process.exit(0)']);
          expect(child.error).toBeUndefined();
          expect(child.status).toBe(0);
        });`);
      await executor.boot({ configRoot: configFile, runsRoot: resolve(project, 'runs'),
        sharedConfig: { cacheRoot: resolve(project, 'cache'), recording: { mode: 'off' },
          scenarios: { large: { name: 'large', layers: [{ kind: 'storage', seed: { payload: 'x'.repeat(2 * 1024 * 1024) } }] } } } });
      expect(process.env.FLIWRIGHT_CONFIG_PATH).toBeTruthy();
      expect(await executor.rerun(testFile, 'large config')).toMatchObject({ status: 'green' });
      await executor.dispose();
      expect(process.env.FLIWRIGHT_CONFIG_PATH).toBe(previousPath);
    } finally { await executor.dispose(); await rm(project, { recursive: true, force: true }); }
  }, 20000);

  it('places default artifacts outside the project for file and directory config roots', () => {
    expect(defaultArtifactsRoot('/repo/app/vitest.config.ts')).toBe(resolveFliwrightRunsRoot({ projectRoot: '/repo/app' }));
    expect(defaultArtifactsRoot('/repo/app/custom.vitest.mjs')).toBe(resolveFliwrightRunsRoot({ projectRoot: '/repo/app' }));
    expect(defaultArtifactsRoot('/repo/app')).toBe(resolveFliwrightRunsRoot({ projectRoot: '/repo/app' }));
  });

  it('does not restore runtime env before boot has applied it', async () => {
    const previous = process.env.FLIWRIGHT_VM_SERVICE_URL;
    process.env.FLIWRIGHT_VM_SERVICE_URL = 'ws://preexisting/ws';
    const executor = new PersistentTestExecutor();

    try {
      await executor.dispose();
      expect(process.env.FLIWRIGHT_VM_SERVICE_URL).toBe('ws://preexisting/ws');
    } finally {
      if (previous === undefined) delete process.env.FLIWRIGHT_VM_SERVICE_URL;
      else process.env.FLIWRIGHT_VM_SERVICE_URL = previous;
    }
  });

  it('reports red for a failing fixture test and green for a passing one', async () => {
    const artifactsRoot = await mkdtemp(resolve(tmpdir(), 'fliwright-tdd-'));
    const executor = new PersistentTestExecutor();

    await executor.boot({
      configRoot: resolve(__dirname, '../../spike/fixture-project/vitest.config.ts'),
      runsRoot: artifactsRoot,
      vmServiceUrl: 'ws://runtime/ws',
      scenarioMode: 'managed-start',
    });

    try {
      expect(process.env.FLIWRIGHT_VM_SERVICE_URL).toBe('ws://runtime/ws');
      expect(process.env.FLIWRIGHT_SCENARIO_MODE).toBe('managed-start');
      const failing = await executor.rerun(resolve(__dirname, '../../spike/fixture-project/.fliwright/tests/sample.test.ts'), 'beta fails');
      expect(failing.status).toBe('red');

      const passing = await executor.rerun(resolve(__dirname, '../../spike/fixture-project/.fliwright/tests/sample.test.ts'), 'alpha passes');
      expect(passing.status).toBe('green');
    } finally {
      await executor.dispose();
    }
    expect(process.env.FLIWRIGHT_VM_SERVICE_URL).not.toBe('ws://runtime/ws');
  }, 30_000);

  it('runs a generated candidate as an explicit focus without broadening ordinary discovery', async () => {
    const artifactsRoot = await mkdtemp(resolve(tmpdir(), 'fliwright-tdd-generated-'));
    const executor = new PersistentTestExecutor();
    const fixtureRoot = resolve(__dirname, '../../spike/fixture-project');
    const candidatePath = resolve(fixtureRoot, '.fliwright/generated/generated-candidate.test.ts');

    await executor.boot({
      configRoot: resolve(fixtureRoot, 'vitest.config.ts'),
      runsRoot: artifactsRoot,
      vmServiceUrl: 'ws://runtime/ws',
    });

    try {
      const candidate = await executor.rerun(candidatePath, 'generated candidate passes');

      expect(candidate).toMatchObject({
        status: 'green',
        testName: 'generated candidate passes',
      });
      expect(candidate.timelinePath).toMatch(/tests\/[^/]+\/attempts\/attempt-0\/timeline.json$/);
      expect(await readdir(resolve(fixtureRoot, '.fliwright/tests'))).toEqual(['sample.test.ts']);
    } finally {
      await executor.dispose();
    }
  }, 30_000);

  it.each(['explicit', 'preset'] as const)('reads current attempt evidence in one shared root across reruns (%s)', async (storage) => {
    const project = await realpath(await mkdtemp(resolve(tmpdir(), 'fliwright-tdd-canonical-')));
    const artifactsRoot = resolve(project, 'artifacts');
    const testDir = resolve(project, '.fliwright/tests');
    const testFile = resolve(testDir, 'failure.test.ts');
    const configFile = resolve(project, 'vitest.config.mjs');
    const fixtureApi = resolve(__dirname, '../../../fliwright-vitest/src/index.ts');
    await mkdir(testDir, { recursive: true });
    await writeFile(configFile, storage === 'preset' ? `
      import { fliwrightPreset } from ${JSON.stringify(import.meta.resolve('@fliwright/vitest/preset'))};
      export default { root: ${JSON.stringify(project)}, ...fliwrightPreset({ projectRoot: ${JSON.stringify(project)},
        runsRoot: 'artifacts', cacheRoot: 'scratch' }) };
    ` : `export default { root: ${JSON.stringify(project)}, test: { include: ['.fliwright/tests/*.test.ts'] } };`);
    await writeFile(testFile, `
      import { createFliwrightTest } from ${JSON.stringify(fixtureApi)};
      const driver = {
        sendRequest: async (method) => {
          if (method === 'ext.fliwright.screenshot') return { success: true, screenshot: Buffer.from('failure-frame').toString('base64') };
          if (method === 'ext.fliwright.snap') return { widgets: [{ type: 'Root' }] };
          if (method === 'ext.fliwright.captureFrame') return { diagnostics: [] };
          return { success: true };
        }, getDiagnostics: () => [], healing: { getReports: () => [] }, dispose: async () => {},
      };
      const test = createFliwrightTest({ vmServiceUrl: 'ws://unused', requireAssertions: false, log: { format: 'silent' } }, { driverProvider: async () => driver });
      test('beta fails', async ({ page }) => { throw new Error('current attempt error'); });
    `);
    const executor = new PersistentTestExecutor();
    try {
      await executor.boot({ configRoot: configFile, runsRoot: storage === 'explicit' ? artifactsRoot : undefined });
      const first = await executor.rerun(testFile, 'beta fails');
      expect(first.status).toBe('red');
      expect(first.failureDetails, JSON.stringify(first)).toMatchObject({
        assertion: { actual: 'current attempt error' },
        artifacts: { screenshotBase64: Buffer.from('failure-frame').toString('base64'), widgetTree: { widgets: [{ type: 'Root' }] } },
      });
      expect(first.timelinePath).toMatch(/tests\/[^/]+\/attempts\/attempt-0\/timeline.json$/);
      const second = await executor.rerun(testFile, 'beta fails');
      expect(second.failureDetails?.assertion?.actual).toBe('current attempt error');
      expect(second.timelinePath).not.toBe(first.timelinePath);
      expect(first.timelinePath).toContain(`${artifactsRoot}/run-`);
      expect(second.timelinePath).toContain(`${artifactsRoot}/run-`);
      expect(await readdir(artifactsRoot)).not.toContain('runs');
    } finally {
      await executor.dispose();
      await rm(project, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }, 30_000);

  it('boots without executing tests before an explicit focused rerun', async () => {
    const project = await realpath(await mkdtemp(resolve(tmpdir(), 'fliwright-tdd-no-boot-run-')));
    const marker = resolve(project, 'executed');
    const testFile = resolve(project, 'boot.test.ts');
    const config = resolve(project, 'vitest.config.mjs');
    await writeFile(config, `export default { root: ${JSON.stringify(project)}, test: { include: ['boot.test.ts'] } };`);
    await writeFile(testFile, `import { test } from 'vitest'; import { writeFileSync } from 'node:fs';
      test('explicit only', () => writeFileSync(${JSON.stringify(marker)}, 'ran'));`);
    const executor = new PersistentTestExecutor();
    try {
      await executor.boot({ configRoot: config, runsRoot: resolve(project, 'artifacts') });
      await expect(stat(marker)).rejects.toThrow();
      const result = await executor.rerun(testFile, 'explicit only');
      expect(result.status, JSON.stringify(result)).toBe('green');
      expect((await stat(marker)).isFile()).toBe(true);
    } finally { await executor.dispose(); await rm(project, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
  }, 30_000);
});
