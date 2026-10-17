import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FLIWRIGHT_CONFIG,
  fliwrightConfigSchema,
  mergeFliwrightConfig,
  readFliwrightEnvironment,
  type FliwrightProjectConfig,
} from '../src/index.js';

describe('recording configuration contract', () => {
  it('uses standard recording and shared project directories by default', () => {
    expect(DEFAULT_FLIWRIGHT_CONFIG).toMatchObject({
      recording: { mode: 'standard', failureCaptureBudgetMs: 3000, testFinalizationBudgetMs: 5000 },
      paths: {
        tests: '.fliwright/tests',
        scripts: '.fliwright/scripts',
        recordings: '.fliwright/recordings',
        flows: '.fliwright/flows',
      },
    });
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

  it('rejects unknown recording modes and preserves explicit off', () => {
    expect(() => fliwrightConfigSchema.parse({ recording: { mode: 'trace' } })).toThrow();
    expect(fliwrightConfigSchema.parse({ recording: { mode: 'off' } }).recording.mode).toBe('off');
  });

  it('merges the finalization budget independently of the failure evidence budget', () => {
    const project = { recording: { testFinalizationBudgetMs: 8000, failureCaptureBudgetMs: 2000 } };
    const environment = readFliwrightEnvironment({
      FLIWRIGHT_CONFIG: JSON.stringify({ recording: { testFinalizationBudgetMs: 6000 } }),
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
      FLIWRIGHT_CONFIG: JSON.stringify({ recording: { mode: 'full', requireAssertions: false,
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
    { FLIWRIGHT_CONFIG: '{broken' },
    { FLIWRIGHT_CONFIG: '{"recording":{"failureCaptureBudgetMs":0}}' },
    { FLIWRIGHT_SCENARIOS: '{"bad":{"name":"bad","layers":[{"kind":"unsupported"}]}}' },
    { FLIWRIGHT_SCENARIO_MODE: 'magic' },
  ])('rejects invalid shared environment values: %j', (environment) => {
    expect(() => readFliwrightEnvironment(environment)).toThrow();
  });
});
