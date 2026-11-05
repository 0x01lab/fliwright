import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { expect, it } from 'vitest';

it.each(['explicit', 'default'])('reapplies %s shared/Item mocks on retry and records the actual rule provenance', async (mode) => {
  const root = await mkdtemp(join(tmpdir(), 'fliwright-item-rules-'));
  const sessions = join(root, 'sessions.jsonl');
  const integration = fileURLToPath(new URL('../src/index.ts', import.meta.url));
  const core = fileURLToPath(new URL('../../fliwright-core/dist/index.js', import.meta.url));
  const runner = fileURLToPath(new URL('../src/runner.ts', import.meta.url));
  try {
    for (const source of ['shared', 'item']) {
      await mkdir(join(root, source), { recursive: true });
      await writeFile(join(root, source, 'user.json'), JSON.stringify({
        version: 1, name: 'User', method: 'GET', endpoint: '/user',
        rules: [{ name: 'success', status: 200, body: { source } }],
      }));
    }
    await writeFile(join(root, 'vitest.config.mjs'), `export default { test: {
      include: ['rules.test.mjs'], runner: ${JSON.stringify(runner)}, maxWorkers: 1, retry: 1,
    } };`);
    await writeFile(join(root, 'rules.test.mjs'), `
      import { expect } from 'vitest';
      import { MockManager } from ${JSON.stringify(core)};
      import { createFliwrightTest } from ${JSON.stringify(integration)};
      const routes = new Map();
      let resets = 0;
      let attempts = 0;
      const driver = {
        mock: new MockManager(async (method, params) => {
          if (method.endsWith('.clearRoutes')) { routes.clear(); resets++; }
          if (method.endsWith('.addRoute')) {
            const route = JSON.parse(params.route); routes.set(route.path, route);
          }
          if (method.endsWith('.listRoutes')) return { routes: [...routes.values()] };
          if (method.endsWith('.getCalls')) return { calls: [] };
          return { success: true };
        }),
        getDiagnostics: () => [], healing: { getReports: () => [] }, dispose: async () => {},
        sendRequest: async method => method === 'ext.fliwright.screenshot'
          ? { success: true, screenshot: Buffer.from('rules').toString('base64') } : { success: true },
      };
      const test = createFliwrightTest({ vmServiceUrl: 'ws://rules-unused/ws', recording: { mode: 'standard' },
        log: { format: 'silent' }, ${mode === 'default' ? "defaultScenario: 'item'," : ''}
        scenarios: {
          base: { name: 'base', layers: [{ kind: 'mocks', sources: [
            { name: 'shared', directory: ${JSON.stringify(join(root, 'shared'))}, files: ['user.json'] },
          ], rules: [{ source: 'shared', method: 'GET', endpoint: '/user', rule: 'success' }] }] },
          item: { name: 'item', extends: ['base'], layers: [{ kind: 'mocks', sources: [
            { name: 'item-437', directory: ${JSON.stringify(join(root, 'item'))}, files: ['user.json'] },
          ], rules: [{ source: 'item-437', method: 'GET', endpoint: '/user', rule: 'success', replace: true }] }] },
        },
      }, { driverProvider: async () => driver });
      ${mode === 'explicit' ? "test.scenario('base')" : 'test'}('retry gets a clean rule set', async ({ driver }) => {
        attempts++;
        expect(resets).toBe(attempts);
        expect([...routes.keys()]).toEqual(['/user']);
        expect(routes.get('/user').response.body.source).toBe(${JSON.stringify(mode === 'explicit' ? 'shared' : 'item')});
        await driver.mock.routeFlutter('/leak', { method: 'GET', status: 200 });
        expect(attempts).toBe(2);
      });
      ${mode === 'explicit' ? "test.scenario('item')" : 'test'}('Item case gets only its selected response', async ({ driver }) => {
        expect(resets).toBe(3);
        expect([...routes.keys()]).toEqual(['/user']);
        expect(routes.get('/user').response.body).toEqual({ source: 'item' });
      });
    `);
    const child = spawn(process.execPath, [fileURLToPath(new URL('../../../node_modules/vitest/vitest.mjs', import.meta.url)),
      'run', '--config', join(root, 'vitest.config.mjs')], {
      cwd: root, timeout: 20_000, env: { ...process.env, FLIWRIGHT_RUN_ID: `item-rules-${mode}`,
        FLIWRIGHT_RUNS_ROOT: join(root, 'runs'), FLIWRIGHT_SESSION_RESULTS_PATH: sessions },
    });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    const code = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
    expect(code, output).toBe(0);
    const results = (await readFile(sessions, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    expect(results.map(result => result.attemptOutcome)).toEqual(['failed', 'passed', 'passed']);
    for (const result of results) {
      const attempt = join(root, 'runs', result.runId, 'tests', encodeURIComponent(result.testId), 'attempts', result.attemptId);
      const timeline = JSON.parse(await readFile(join(attempt, 'timeline.json'), 'utf8'));
      const node = timeline.nodes.find((node: { title: string }) => node.title.startsWith('Scenario:'));
      expect(node.metadata.mockRuleSet).toMatchObject({
        fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
        routes: [expect.objectContaining({ contentHash: expect.stringMatching(/^[a-f0-9]{64}$/) })],
      });
      expect(node.metadata.mockRuleSet.routes[0]).not.toHaveProperty('response');
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);
