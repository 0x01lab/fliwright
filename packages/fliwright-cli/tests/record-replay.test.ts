import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { recordCommand } from '../src/commands/record.js';
import { verifyRecordingReplay } from '../src/RecordingReplay.js';
import { loadConfig } from '../src/config.js';
import { fingerprintScenario, ScenarioResolver } from '@fliwright/core';

let cwd: string;
beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'fliwright-record-replay-'));
  await writeFile(join(cwd, 'fliwright.config.ts'), `export default { runsRoot: ${JSON.stringify(join(cwd, '.fliwright/runs'))}, scenarios: {
    saved: { name: 'saved', layers: [{ kind: 'storage', seed: { text: 'Ready' } }] },
  } };`);
  await writeFile(join(cwd, 'vitest.config.mjs'), `
    import { fliwrightPreset } from ${JSON.stringify(import.meta.resolve('@fliwright/vitest/preset'))};
    import project from './fliwright.config.ts';
    export default {
    root: ${JSON.stringify(cwd)}, resolve: { alias: {
      '@fliwright/vitest': ${JSON.stringify(import.meta.resolve('@fliwright/vitest').replace('file://', ''))},
      '@fliwright/core': ${JSON.stringify(import.meta.resolve('@fliwright/core').replace('file://', ''))},
    } }, test: { ...fliwrightPreset(project).test, include: ['unrelated/*.test.ts'], setupFiles: ['./boundary.mjs'],
      maxWorkers: 1, minWorkers: 1, server: { deps: { inline: [/@fliwright/] } },
    },
  };`);
  // Real Vitest + default Fliwright fixtures; only the VM boundary is controlled.
  await writeFile(join(cwd, 'boundary.mjs'), `
    import { vi } from 'vitest';
    import { writeFileSync } from 'node:fs';
    vi.mock('@fliwright/core', async (original) => {
      const core = await original();
      let text = 'Scenario was not applied';
      class Driver {
        page = {}; mock = {}; healing = { getReports: () => [] };
        storage = { reset: async (seed) => {
          text = seed.text;
          writeFileSync(${JSON.stringify(join(cwd, 'scenario-applied'))}, text);
          return { status: 'ok' };
        } };
        async connect() {} async dispose() {} async listenToDiagnostics() {}
        getDiagnostics() { return []; }
        async sendRequest(method) {
          if (method === 'ext.fliwright.action') {
            if (text !== 'Ready') throw new Error('Scenario must prepare the form before saving');
            text = 'Saved';
            writeFileSync(${JSON.stringify(join(cwd, 'save-action'))}, text);
            return { success: true };
          }
          if (method === 'ext.fliwright.screenshot') return { success: true, screenshot: Buffer.from('frame').toString('base64') };
          if (method === 'ext.fliwright.resolve') return { matches: [{ id: 'result', type: 'Text', text, hitTestable: true }] };
          if (method === 'ext.fliwright.snap') return { snapshot: { text }, refs: [], raw: text };
          return { success: true };
        }
      }
      return { ...core, FliwrightDriver: Driver };
    });
  `);
});
afterEach(async () => { await rm(cwd, { recursive: true, force: true }); });

it('preserves evidence without serializing the local capture directory when replay is blocked', async () => {
  const source = join(cwd, 'capture');
  const destination = join(cwd, 'saved');
  await mkdir(join(source, 'screenshots'), { recursive: true });
  await writeFile(join(source, 'screenshots/frame.png'), 'png');
  await writeFile(join(source, 'events.jsonl'), '{"sequence":1}\n');
  const result = await verifyRecordingReplay({ code: '// draft', cwd, directory: destination,
    vmUrl: 'ws://controlled-vm/ws', scenario: 'unknown',
    capture: { artifactDirectory: source, stopReason: 'requested', selectors: new Map(), recording: {
      status: 'captured', operations: [], receivedSequences: [], missingSequences: [], code: '', issues: [],
      rawEventsFile: 'events.jsonl', frames: [{ id: 'frame', index: 0, kind: 'tap', status: 'ready',
        timestamp: 1, position: { x: 1, y: 2 }, screenshot: { path: 'screenshots/frame.png', byteLength: 3, format: 'png' } }],
    } },
  });
  expect(result.passed).toBe(false);
  await rm(source, { recursive: true });
  const saved = await readFile(join(destination, 'capture.json'), 'utf8');
  expect(saved).not.toContain(source);
  expect(saved).not.toContain('artifactDirectory');
  expect(await readFile(join(destination, 'screenshots/frame.png'), 'utf8')).toBe('png');
  expect(await readFile(join(destination, 'events.jsonl'), 'utf8')).toContain('sequence');
});

async function record(expected: string) {
  const assertions = join(cwd, 'assertions.json');
  await writeFile(assertions, JSON.stringify([{ id: 'saved', query: { match: { key: 'result' } },
    matcher: 'toHaveText', expected, source: 'snapshot', confirmed: true }]));
  return recordCommand({ cwd, mode: 'test', scenario: 'saved', assertions, verify: true,
    resetToHomeBeforeEach: false,
  }, {
    resolveVmUrl: async () => 'ws://controlled-vm/ws',
    openCapture: async () => ({
      recorder: {
        getArtifactDirectory: () => undefined,
        start: vi.fn(), getSelectors: () => new Map([[0, {
          query: { match: { key: 'save' } }, matchCount: 1, ambiguous: false,
        }]]),
        stop: vi.fn(async () => ({ status: 'captured' as const, operations: [{ kind: 'tap' as const, position: { x: 1, y: 2 }, timestamp: 1 }], frames: [],
          receivedSequences: [], missingSequences: [], code: '', issues: [] })),
      }, dispose: vi.fn(),
    }), waitForStop: async () => {},
  });
}

it('replays the exact generated test with the configured scenario and preserves its verified run', async () => {
  const result = await record('Saved');
  expect(result.blockers).toEqual([]);
  expect(result.readiness.readiness).toBe('verified');
  expect(await readFile(join(cwd, 'scenario-applied'), 'utf8')).toBe('Ready');
  expect(await readFile(join(cwd, 'save-action'), 'utf8')).toBe('Saved');
  expect(result.readiness.verifiedRunId).toBeTruthy();
  const run = join(cwd, '.fliwright/runs', result.readiness.verifiedRunId!);
  const manifest = JSON.parse(await readFile(join(run, 'run.json'), 'utf8'));
  expect(manifest.status).toBe('passed');
  expect(manifest.tests).toHaveLength(1);
  const attempt = join(run, manifest.tests[0].attempts[0].resultPath);
  const timeline = JSON.parse(await readFile(join(attempt, '..', 'timeline.json'), 'utf8'));
  expect(timeline.nodes).toContainEqual(expect.objectContaining({ kind: 'assertion', status: 'passed' }));
  expect(await readFile(join(result.recordingPath!, 'replay.test.ts'), 'utf8')).toBe(result.code);
  expect(await readFile(join(cwd, '.fliwright/tests/recorded-test.test.ts'), 'utf8')).toBe(result.code);
  const configPath = join(cwd, 'vitest.config.mjs');
  await writeFile(configPath, (await readFile(configPath, 'utf8')).replace("unrelated/*.test.ts", '.fliwright/tests/*.test.ts'));
  const child = spawn(process.execPath, [fileURLToPath(new URL('./vitest.mjs', import.meta.resolve('vitest/package.json'))), 'run', '--reporter=json'], {
    cwd, env: { ...process.env, FLIWRIGHT_SCENARIOS: '', FLIWRIGHT_VM_URL: 'ws://controlled-vm/ws', FLIWRIGHT_RUN_ID: 'direct-replay' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  const status = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  expect(status, output).toBe(0);
  expect(output).toContain('"numPassedTests":1');
}, 30_000);

it('preserves a failed replay and its source without publishing or claiming verification', async () => {
  const result = await record('Counterexample');
  expect(result.readiness.readiness).toBe('draft');
  expect(result.readiness.verifiedRunId).toBeUndefined();
  expect(result.blockers.join(' ')).toMatch(/replay.*failed/i);
  expect(result.readiness.replayRunId).toBeTruthy();
  const run = join(cwd, '.fliwright/runs', result.readiness.replayRunId!);
  expect(JSON.parse(await readFile(join(run, 'run.json'), 'utf8')).status).toBe('failed');
  const report = JSON.parse(await readFile(join(run, 'report.json'), 'utf8'));
  expect(report.results[0].error).toContain('Counterexample');
  expect(await readFile(join(cwd, 'scenario-applied'), 'utf8')).toBe('Ready');
  expect(await readFile(join(result.recordingPath!, 'replay.test.ts'), 'utf8')).toBe(result.code);
  const saved = JSON.parse(await readFile(join(result.recordingPath!, 'recording.json'), 'utf8'));
  expect(saved.readiness).toEqual(result.readiness);
  await expect(readFile(join(cwd, '.fliwright/tests/recorded-test.test.ts'), 'utf8')).rejects.toThrow();
}, 30_000);

it('never verifies an assertion by healing its missing target into a different widget', async () => {
  const boundaryPath = join(cwd, 'boundary.mjs');
  let boundary = await readFile(boundaryPath, 'utf8');
  boundary = boundary.replace("healing = { getReports: () => [] };", `healing = {
    getReports: () => [], recordSuccess: async () => {},
    tryHeal: async () => {
      writeFileSync(${JSON.stringify(join(cwd, 'healing-attempted'))}, 'yes');
      return { healed: true, report: { suggestedSelector: 'key=result' } };
    },
  };`);
  boundary = boundary.replace("if (method === 'ext.fliwright.resolve') return", "if (method === 'ext.fliwright.resolve' && JSON.parse(arguments[1].selector).match?.key === 'missing') return { matches: [] };\n          if (method === 'ext.fliwright.resolve') return");
  await writeFile(boundaryPath, boundary);
  const config = await loadConfig(cwd);
  const code = "import { test, expect } from '@fliwright/vitest'; test.scenario('saved')('strict target', async ({ page }) => { await expect(page.getByKey('missing')).toBeVisible({ timeout: 0 }); });";
  const result = await verifyRecordingReplay({ code, cwd, vmUrl: 'ws://controlled-vm/ws', scenario: 'saved',
    scenarioFingerprint: fingerprintScenario(new ScenarioResolver(config.scenarios!).resolve('saved')),
  });
  expect(result.passed).toBe(false);
  expect(result.verifiedRunId).toBeUndefined();
  expect(result.manifestPath).toBeTruthy();
  expect(JSON.parse(await readFile(result.manifestPath!, 'utf8')).status).toBe('failed');
  await expect(readFile(join(cwd, 'healing-attempted'))).rejects.toThrow();
  expect(await readFile(result.replayPath!, 'utf8')).toBe(code);
}, 30_000);

it.each([
  ["import { test } from '@fliwright/vitest'; test.scenario('saved')('empty', async ({ page }) => {});", /replay.*failed/i],
  ["import { test, expect } from '@fliwright/vitest'; test('unbound', async ({ page }) => { await expect(page.getByKey('result')).toHaveText('Scenario was not applied'); });", /bound scenario/i],
  ["import { test } from 'vitest'; test.skip('skipped', () => {});", /replay.*failed/i],
])('does not verify empty, unbound, or skipped replay candidates', async (code, issue) => {
  const config = await loadConfig(cwd);
  const result = await verifyRecordingReplay({ code, cwd, vmUrl: 'ws://controlled-vm/ws', scenario: 'saved',
    scenarioFingerprint: fingerprintScenario(new ScenarioResolver(config.scenarios!).resolve('saved')),
  });
  expect(result.passed).toBe(false);
  expect(result.verifiedRunId).toBeUndefined();
  expect(result.issues.join(' ')).toMatch(issue);
  expect(await readFile(result.replayPath!, 'utf8')).toBe(code);
}, 30_000);

it('invalidates verification if the scenario declaration changes during a passing replay', async () => {
  const boundary = await readFile(join(cwd, 'boundary.mjs'), 'utf8');
  await writeFile(join(cwd, 'boundary.mjs'), boundary.replace('text = seed.text;', `text = seed.text;
    writeFileSync(${JSON.stringify(join(cwd, 'fliwright.config.ts'))}, "export default { scenarios: { saved: { name: 'saved', layers: [] } } };");`));
  const result = await record('Saved');
  expect(result.readiness.readiness).toBe('draft');
  expect(result.readiness.verifiedRunId).toBeUndefined();
  expect(result.blockers.join(' ')).toMatch(/changed during replay/i);
  expect(result.readiness.replayRunId).toBeTruthy();
}, 30_000);
