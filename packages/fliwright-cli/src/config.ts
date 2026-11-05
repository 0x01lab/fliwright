import { join } from 'node:path';
import { stat } from 'node:fs/promises';
import { createJiti } from 'jiti';
import { mergeFliwrightConfig, readFliwrightEnvironment, resolveFliwrightProjectRoot, resolveFliwrightRunsRoot, resolveFliwrightCacheRoot, resolveFliwrightPath } from '@fliwright/core';
import type { FliwrightPathsConfig, FliwrightProjectConfig, FliwrightRecordingConfig, ResolvedFliwrightConfig, ScenarioExecutionMode, TestScenario, NativeConfig } from '@fliwright/core';

export interface FliwrightCliConfig {
  native?: NativeConfig;
  suites?: Record<string, string>;
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
  // Keep the machine-local recording default unresolved until the target project is known.
  const { recordings: _recordings, ...paths } = shared.paths;
  return { ...DEFAULTS, ...overrides, ...shared, testDir: shared.paths.tests,
    paths: { ...paths, ...(overrides.paths?.recordings ? { recordings: overrides.paths.recordings } : {}) } };
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
  const projectRoot = resolveFliwrightProjectRoot(projectDir);
  const shared = mergeFliwrightConfig({ project, environment: readFliwrightEnvironment(environment), explicit, projectRoot, environmentSource: environment });
  shared.paths.recordings = resolveFliwrightPath(shared.paths.recordings, projectRoot);
  return { ...project, ...shared, testDir: shared.paths.tests,
    runsRoot: resolveFliwrightRunsRoot({ projectRoot, runsRoot: shared.runsRoot, env: environment }),
    cacheRoot: resolveFliwrightCacheRoot({ projectRoot, cacheRoot: shared.cacheRoot, env: environment }),
  };
}

/** Resolve an ESM dependency from the target project without evaluating it. */
export function resolveProjectImport(specifier: string, projectDir: string): string {
  return createJiti(join(projectDir, 'package.json'), { fsCache: false }).esmResolve(specifier);
}
