import { fileURLToPath } from 'node:url';
import { mergeFliwrightConfig, readFliwrightEnvironment, resolveFliwrightProjectRoot, resolveFliwrightRunsRoot, resolveFliwrightCacheRoot } from '@fliwright/core';
import type { FliwrightPathsConfig, FliwrightRecordingConfig, ScenarioExecutionMode, TestScenario } from '@fliwright/core';

export interface FliwrightVitestPresetOptions {
  runner?: string;
  test?: Record<string, unknown>;
  recording?: Partial<FliwrightRecordingConfig>;
  paths?: Partial<FliwrightPathsConfig>;
  runsRoot?: string;
  cacheRoot?: string;
  projectRoot?: string;
  scenarios?: Record<string, TestScenario>;
  scenarioMode?: ScenarioExecutionMode;
  defaultScenario?: string;
}

/** Returns a Vitest config fragment using the built Fliwright runner adapter. */
export function fliwrightPreset(options: FliwrightVitestPresetOptions = {}): {
  test: Record<string, unknown>;
} {
  const config = mergeFliwrightConfig({ project: options, environment: readFliwrightEnvironment(process.env) });
  const projectRoot = options.projectRoot ?? process.env.FLIWRIGHT_PROJECT_ROOT ?? resolveFliwrightProjectRoot();
  config.runsRoot = resolveFliwrightRunsRoot({ projectRoot, runsRoot: config.runsRoot, env: {} });
  config.cacheRoot = resolveFliwrightCacheRoot({ projectRoot, cacheRoot: config.cacheRoot });
  const reporters = options.test?.reporters ?? ['default'];
  const env = {
    FLIWRIGHT_PROJECT_ROOT: projectRoot,
    FLIWRIGHT_CONFIG: JSON.stringify(config),
    FLIWRIGHT_RECORDING_MODE: config.recording.mode,
    ...(config.runsRoot ? { FLIWRIGHT_RUNS_ROOT: config.runsRoot } : {}),
  };
  return {
    test: {
      runner: options.runner ?? fileURLToPath(new URL('./runner.js', import.meta.url)),
      include: [`${config.paths.tests}/**/*.test.ts`, `${config.paths.scripts}/**/*.script.ts`],
      ...options.test,
      reporters: [
        ...(Array.isArray(reporters) ? reporters : [reporters]),
        fileURLToPath(new URL('./RecoveryReporter.js', import.meta.url)),
      ],
      env: { ...(options.test?.env as Record<string, unknown> | undefined), ...env },
    },
  };
}
