import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeFliwrightConfigSnapshot } from '../src/index.js';
import { afterAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_FLIWRIGHT_CONFIG,
  fliwrightConfigSchema,
  mergeFliwrightConfig,
  readFliwrightEnvironment,
  type FliwrightProjectConfig,
} from '../src/index.js';

const directory = mkdtempSync(join(tmpdir(), 'config-contract-'));
afterAll(() => rmSync(directory, { recursive: true, force: true }));
let nextConfig = 0;
function rawConfigPath(value: string): string {
  const file = join(directory, `${nextConfig++}.json`);
  writeFileSync(file, value);
  return file;
}

describe('recording configuration contract', () => {
  it('transports explicit shared/Item mock sources and replacement selections without dropping fields', () => {
    const scenarios = {
      item: { name: 'item-437', layers: [{ kind: 'mocks', sources: [
        { name: 'shared', directory: '.fliwright/mocks', files: ['api/user.json'] },
        { name: 'item', directory: '.fliwright/test-plans/437/mocks', files: ['api/user.json'] },
      ], rules: [
        { source: 'shared', method: 'POST', endpoint: '/user', rule: 'success' },
        { source: 'item', method: 'POST', endpoint: '/user', rule: 'review', replace: true },
      ] }] },
    };
    const decoded = readFliwrightEnvironment({ FLIWRIGHT_CONFIG_PATH: writeFliwrightConfigSnapshot({ scenarios }) });
    expect(mergeFliwrightConfig({ environment: decoded }).scenarios).toEqual(scenarios);
    expect(() => fliwrightConfigSchema.parse({ scenarios: {
      invalid: { name: 'invalid', layers: [{ kind: 'mocks', sources: [{ name: 'empty', directory: 'mocks', files: [] }] }] },
    } })).toThrow();
  });

  it('uses standard recording and shared project directories by default', () => {
    expect(DEFAULT_FLIWRIGHT_CONFIG).toMatchObject({
      recording: { mode: 'standard', failureCaptureBudgetMs: 3000, testFinalizationBudgetMs: 5000 },
      paths: {
        tests: '.fliwright/tests',
        scripts: '.fliwright/scripts',
        flows: '.fliwright/flows',
      },
    });
  });

  it('resolves recording artifacts for the target project while keeping authored paths portable', () => {
    expect(mergeFliwrightConfig({ projectRoot: '/workspace/app', environmentSource: { FLIWRIGHT_RUNTIME_ROOT: '/local/app' } })).toMatchObject({
      paths: { tests: '.fliwright/tests', scripts: '.fliwright/scripts', flows: '.fliwright/flows', recordings: '/local/app/recordings' },
    });
    expect(mergeFliwrightConfig({ projectRoot: '/workspace/app', project: { paths: { recordings: 'qa/captures' } } }).paths.recordings)
      .toBe('qa/captures');
  });

  it('merges explicit values over environment and project config', () => {
    const project: FliwrightProjectConfig = {
      recording: { mode: 'full' },
      paths: { tests: 'project-tests' },
    };
    expect(mergeFliwrightConfig({
      project,
      environment: { recording: { mode: 'off' }, paths: { scripts: 'env-scripts' } },
      explicit: { recording: { mode: 'standard' } },
    })).toMatchObject({
      recording: { mode: 'standard' },
      paths: {
        tests: 'project-tests',
        scripts: 'env-scripts',
      },
    });
  });

  it('transports and validates the cache root independently of run settings', () => {
    const environment = readFliwrightEnvironment({ FLIWRIGHT_CONFIG_PATH: writeFliwrightConfigSnapshot({ cacheRoot: '/worker/cache' }) });
    expect(mergeFliwrightConfig({ project: { runsRoot: 'history', cacheRoot: 'scratch' }, environment }))
      .toMatchObject({ runsRoot: 'history', cacheRoot: '/worker/cache' });
    expect(() => fliwrightConfigSchema.parse({ cacheRoot: '' })).toThrow();
  });

  it('rejects unknown recording modes and preserves explicit off', () => {
    expect(() => fliwrightConfigSchema.parse({ recording: { mode: 'trace' } })).toThrow();
    expect(fliwrightConfigSchema.parse({ recording: { mode: 'off' } }).recording.mode).toBe('off');
  });

  it('merges the finalization budget independently of the failure evidence budget', () => {
    const project = { recording: { testFinalizationBudgetMs: 8000, failureCaptureBudgetMs: 2000 } };
    const environment = readFliwrightEnvironment({
      FLIWRIGHT_CONFIG_PATH: writeFliwrightConfigSnapshot({ recording: { testFinalizationBudgetMs: 6000 } }),
    });
    expect(mergeFliwrightConfig({ project }).recording).toMatchObject({
      testFinalizationBudgetMs: 8000, failureCaptureBudgetMs: 2000,
    });
    expect(mergeFliwrightConfig({ project, environment }).recording.testFinalizationBudgetMs).toBe(6000);
    expect(mergeFliwrightConfig({ project, environment,
      explicit: { recording: { testFinalizationBudgetMs: 4000 } },
    }).recording).toMatchObject({ testFinalizationBudgetMs: 4000, failureCaptureBudgetMs: 2000 });
  });

  it.each([0, -1, 1.5, '5000', null, Infinity, NaN])('rejects invalid finalization budget %s', (value) => {
    expect(() => fliwrightConfigSchema.parse({ recording: { testFinalizationBudgetMs: value } })).toThrow();
  });

  it('does not let VM endpoints leak into the shared serializable config', () => {
    const merged = mergeFliwrightConfig({ explicit: { vmServiceUrl: 'ws://secret/ws' } });
    expect(merged.vmServiceUrl).toBeUndefined();
  });

  it('reads the complete serializable environment and applies scalar overrides without defaults', () => {
    expect(readFliwrightEnvironment({})).toEqual({});
    const environment = readFliwrightEnvironment({
      FLIWRIGHT_CONFIG_PATH: writeFliwrightConfigSnapshot({ recording: { mode: 'full', requireAssertions: false,
        failureCaptureBudgetMs: 1200, testFinalScreenshots: false }, paths: { tests: 'checks' }, scenarioMode: 'managed-start' }),
      FLIWRIGHT_RECORDING_MODE: 'off', FLIWRIGHT_RUNS_ROOT: '/environment/runs',
    });
    expect(mergeFliwrightConfig({ project: { recording: { mode: 'standard' } }, environment,
      explicit: { recording: { mode: 'full' } } })).toMatchObject({
      recording: { mode: 'full', requireAssertions: false, failureCaptureBudgetMs: 1200, testFinalScreenshots: false },
      paths: { tests: 'checks' }, runsRoot: '/environment/runs', scenarioMode: 'managed-start',
    });
  });

  it.each([
    { FLIWRIGHT_RECORDING_MODE: 'trace' },
    { FLIWRIGHT_CONFIG_PATH: rawConfigPath('{broken') },
    { FLIWRIGHT_CONFIG_PATH: rawConfigPath('{"recording":{"failureCaptureBudgetMs":0}}') },
    { FLIWRIGHT_CONFIG_PATH: rawConfigPath('{"scenarios":{"bad":{"name":"bad","layers":[{"kind":"unsupported"}]}}}') },
    { FLIWRIGHT_SCENARIO_MODE: 'magic' },
  ])('rejects invalid shared environment values: %j', (environment) => {
    expect(() => readFliwrightEnvironment(environment)).toThrow();
  });
});
