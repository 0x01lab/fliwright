import { join } from 'node:path';
import { stat } from 'node:fs/promises';
import { createJiti } from 'jiti';
import { mergeFliwrightConfig, readFliwrightEnvironment, resolveFliwrightProjectRoot, resolveFliwrightRunsRoot, resolveFliwrightCacheRoot } from '@fliwright/core';
import type { FliwrightPathsConfig, FliwrightProjectConfig, FliwrightRecordingConfig, ResolvedFliwrightConfig, ScenarioExecutionMode, TestScenario } from '@fliwright/core';

export interface FliwrightCliConfig {
  vmServiceUrl?: string;
  timeout: number;
  screenshot: 'file' | 'base64' | 'off';
  testDir: string;
  reporter: 'pretty' | 'json' | 'junit';
  runsRoot?: string;
  cacheRoot?: string;
  recording?: Partial<FliwrightRecordingConfig>;
  paths?: Partial<FliwrightPathsConfig>;
  scenarios?: Record<string, TestScenario>;
  scenarioMode?: ScenarioExecutionMode;
  defaultScenario?: string;
}

const DEFAULTS: FliwrightCliConfig = {
  timeout: 30000,
  screenshot: 'file',
  testDir: '.fliwright/tests',
  reporter: 'pretty',
  recording: { mode: 'standard' },
};

export function defineConfig(overrides: Partial<FliwrightCliConfig> = {}): FliwrightCliConfig {
  const shared = mergeFliwrightConfig({ project: { ...overrides,
    paths: { ...overrides.paths, ...(overrides.testDir ? { tests: overrides.testDir } : {}) },
  } });
  return { ...DEFAULTS, ...overrides, ...shared, testDir: shared.paths.tests };
}

export async function loadConfig(projectDir: string): Promise<FliwrightCliConfig> {
  const configPath = join(resolveFliwrightProjectRoot(projectDir), 'fliwright.config.ts');

  try {
    await stat(configPath);
  } catch {
    return defineConfig();
  }

  const jiti = createJiti(import.meta.url, { moduleCache: false, fsCache: false });
  const raw = await jiti.import(configPath) as Record<string, unknown>;
  const loaded = (raw.default ?? raw) as Partial<FliwrightCliConfig>;
  return defineConfig(loaded);
}

/** Resolve serializable settings consistently for commands and external integrations. */
export async function resolveProjectConfig(
  projectDir: string,
  explicit: Partial<FliwrightProjectConfig> = {},
  environment: Record<string, string | undefined> = process.env,
): Promise<FliwrightCliConfig & ResolvedFliwrightConfig> {
  const project = await loadConfig(projectDir);
  const shared = mergeFliwrightConfig({ project, environment: readFliwrightEnvironment(environment), explicit });
  const projectRoot = resolveFliwrightProjectRoot(projectDir);
  return { ...project, ...shared, testDir: shared.paths.tests,
    runsRoot: resolveFliwrightRunsRoot({ projectRoot, runsRoot: shared.runsRoot, env: {} }),
    cacheRoot: resolveFliwrightCacheRoot({ projectRoot, cacheRoot: shared.cacheRoot }),
  };
}
