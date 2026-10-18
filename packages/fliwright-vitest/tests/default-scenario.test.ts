import { expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

it('applies the CLI-selected scenario before every fixture attempt, including retries', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fliwright-default-scenario-'));
  const integration = fileURLToPath(new URL('../src/index.ts', import.meta.url));
  const runner = fileURLToPath(new URL('../src/runner.ts', import.meta.url));
  try {
    await writeFile(join(root, 'vitest.config.mjs'), `export default { test: { include: ['case.test.mjs'], runner: ${JSON.stringify(runner)}, maxWorkers: 1, retry: 1 } };`);
    await writeFile(join(root, 'case.test.mjs'), `
      import { createFliwrightTest } from ${JSON.stringify(integration)};
      import { expect } from 'vitest';
      let prepared = 0, bodies = 0;
      const driver = { app: { invoke: async () => { prepared++; } }, dispose: async () => {}, mock: {}, getDiagnostics: () => [], healing: { getReports: () => [] } };
      const test = createFliwrightTest({ vmServiceUrl: 'ws://default-scenario/ws', recording: { mode: 'off' }, log: { format: 'silent' },
        scenarios: { ready: { name: 'ready', layers: [{ kind: 'app', capability: 'test', method: 'prepare' }] } }
      }, { driverProvider: async () => driver });
      test('selected scenario', async ({ driver }) => { bodies++; expect(prepared).toBe(bodies); expect(bodies).toBe(2); });
    `);
    const child = spawn(process.execPath, [fileURLToPath(new URL('../../../node_modules/vitest/vitest.mjs', import.meta.url)), 'run', '--config', join(root, 'vitest.config.mjs')], {
      cwd: root, timeout: 15000, env: { ...process.env, FLIWRIGHT_DEFAULT_SCENARIO: 'ready', FLIWRIGHT_RUNS_ROOT: join(root, 'runs') },
    });
    let output = ''; child.stdout.on('data', (chunk) => { output += chunk; }); child.stderr.on('data', (chunk) => { output += chunk; });
    const code = await new Promise((resolve, reject) => { child.once('close', resolve); child.once('error', reject); });
    expect(code, output).toBe(0);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 20000);
