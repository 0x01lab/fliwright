import { describe, expect, it, vi } from 'vitest';
import { fliwrightPreset } from '../src/index.js';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

describe('fliwright Vitest preset', () => {
  it('resolves storage against the project before transporting config to workers', () => {
    try {
      vi.stubEnv('FLIWRIGHT_CONFIG', '');
      vi.stubEnv('FLIWRIGHT_RUNS_ROOT', '');
      const preset = fliwrightPreset({ projectRoot: '/repos/app', runsRoot: 'evidence', cacheRoot: 'scratch' });
      const env = preset.test.env as Record<string, string>;
      expect(env.FLIWRIGHT_PROJECT_ROOT).toBe('/repos/app');
      expect(env.FLIWRIGHT_RUNS_ROOT).toBe('/repos/app/evidence');
      expect(JSON.parse(env.FLIWRIGHT_CONFIG)).toMatchObject({ runsRoot: '/repos/app/evidence', cacheRoot: '/repos/app/scratch' });
    } finally { vi.unstubAllEnvs(); }
  });

  it('keeps project reporters and adds terminal recovery for direct runs', () => {
    const custom = { onTestRunEnd: () => {} };
    for (const reporters of ['json', ['dot', custom], []]) {
      const configured = fliwrightPreset({ test: { reporters } }).test.reporters as unknown[];
      expect(configured.slice(0, -1)).toEqual(Array.isArray(reporters) ? reporters : [reporters]);
      expect(configured.at(-1)).toMatch(/RecoveryReporter\.js$/);
    }
    expect((fliwrightPreset().test.reporters as unknown[])[0]).toBe('default');
  });
  it('propagates named scenarios to the default generated-test fixture in direct runs', () => {
    const scenarios = { saved: { name: 'saved', layers: [] } };
    try {
      vi.stubEnv('FLIWRIGHT_SCENARIOS', '');
      vi.stubEnv('FLIWRIGHT_SCENARIO_MODE', '');
      const preset = fliwrightPreset({ scenarios, scenarioMode: 'managed-start' });
      const env = preset.test.env as Record<string, string>;
      expect(JSON.parse(env.FLIWRIGHT_CONFIG).scenarios).toEqual(scenarios);
      expect(JSON.parse(env.FLIWRIGHT_CONFIG).scenarioMode).toBe('managed-start');
      expect(process.env.FLIWRIGHT_SCENARIOS).toBe('');
    } finally { vi.unstubAllEnvs(); }
  });
  it('loads from the public preset entry outside a Vitest worker', () => {
    const child = spawnSync(process.execPath, ['--input-type=module', '--eval', `
      import { fliwrightPreset } from '@fliwright/vitest/preset';
      process.stdout.write(JSON.stringify(fliwrightPreset()));
    `], { cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8', timeout: 10_000 });
    expect(child.status, child.stderr).toBe(0);
    expect(JSON.parse(child.stdout).test.runner).toMatch(/runner\.js$/);
  });
  it('points direct Vitest runs at the built runner adapter and preserves overrides', () => {
    const preset = fliwrightPreset({ test: { retry: 2 } });
    expect(preset.test.retry).toBe(2);
    expect(preset.test.runner).toMatch(/runner\.js$/);
  });

  it('propagates scalar recording settings to Vitest workers', () => {
    const previousMode = process.env.FLIWRIGHT_RECORDING_MODE;
    const previousRoot = process.env.FLIWRIGHT_RUNS_ROOT;
    try {
      fliwrightPreset({ recording: { mode: 'full' }, runsRoot: '/tmp/fliwright-preset-runs' });
      const preset = fliwrightPreset({ recording: { mode: 'full' }, runsRoot: '/tmp/fliwright-preset-runs' });
      const env = preset.test.env as Record<string, string>;
      expect(env.FLIWRIGHT_RECORDING_MODE).toBe(previousMode || 'full');
      expect(env.FLIWRIGHT_RUNS_ROOT).toBe(previousRoot || '/tmp/fliwright-preset-runs');
    } finally {
      if (previousMode === undefined) delete process.env.FLIWRIGHT_RECORDING_MODE;
      else process.env.FLIWRIGHT_RECORDING_MODE = previousMode;
      if (previousRoot === undefined) delete process.env.FLIWRIGHT_RUNS_ROOT;
      else process.env.FLIWRIGHT_RUNS_ROOT = previousRoot;
    }
  });

  it('preserves environment priority and transports every recording field without mutating the parent', () => {
    try {
      vi.stubEnv('FLIWRIGHT_RECORDING_MODE', 'off');
      vi.stubEnv('FLIWRIGHT_RUNS_ROOT', '/environment/runs');
      const preset = fliwrightPreset({ recording: { mode: 'full', requireAssertions: false,
        failureCaptureBudgetMs: 1200, testFinalScreenshots: false }, runsRoot: '/project/runs',
        paths: { tests: 'checks' }, test: { env: { PROJECT_FLAG: 'yes' } } });
      const env = preset.test.env as Record<string, string>;
      expect(JSON.parse(env.FLIWRIGHT_CONFIG)).toMatchObject({ recording: { mode: 'off', requireAssertions: false,
        failureCaptureBudgetMs: 1200, testFinalScreenshots: false }, runsRoot: '/environment/runs', paths: { tests: 'checks' } });
      expect(env.PROJECT_FLAG).toBe('yes');
      expect(process.env.FLIWRIGHT_RECORDING_MODE).toBe('off');
      expect(process.env.FLIWRIGHT_RUNS_ROOT).toBe('/environment/runs');
    } finally { vi.unstubAllEnvs(); }
  });
});
