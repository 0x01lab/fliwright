import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { resolveFliwrightCacheRoot, resolveFliwrightRuntimeRoot } from './runArtifacts.js';
import { z } from 'zod';
import type { ScenarioExecutionMode, TestScenario } from './Scenario.js';
import { nativeConfigSchema, type NativeConfig } from './native/NativeConfig.js';

export type RecordingMode = 'standard' | 'full' | 'off';

export interface FliwrightPathsConfig {
  tests: string;
  scripts: string;
  recordings: string;
  flows: string;
}

export interface FliwrightRecordingConfig {
  mode: RecordingMode;
  requireAssertions: boolean;
  failureCaptureBudgetMs: number;
  /** Total time for Fliwright-owned attempt finalization; project hooks retain Vitest's hookTimeout. */
  testFinalizationBudgetMs: number;
  testFinalScreenshots: boolean;
}

export interface FliwrightProjectConfig {
  native?: NativeConfig;
  recording: Partial<FliwrightRecordingConfig>;
  paths: Partial<FliwrightPathsConfig>;
  runsRoot?: string;
  cacheRoot?: string;
  scenarios?: Record<string, TestScenario>;
  scenarioMode?: ScenarioExecutionMode;
  defaultScenario?: string;
}

export interface ResolvedFliwrightConfig {
  native?: NativeConfig;
  recording: FliwrightRecordingConfig;
  paths: FliwrightPathsConfig;
  runsRoot?: string;
  cacheRoot?: string;
  scenarios?: Record<string, TestScenario>;
  scenarioMode?: ScenarioExecutionMode;
  defaultScenario?: string;
}

export const DEFAULT_FLIWRIGHT_CONFIG: Omit<ResolvedFliwrightConfig, 'paths'> & { paths: Omit<FliwrightPathsConfig, 'recordings'> } = {
  recording: {
    mode: 'standard',
    requireAssertions: true,
    failureCaptureBudgetMs: 3000,
    testFinalizationBudgetMs: 5000,
    testFinalScreenshots: true,
  },
  paths: {
    tests: '.fliwright/tests',
    scripts: '.fliwright/scripts',
    flows: '.fliwright/flows',
  },
};

const recordingSchema = z.object({
  mode: z.enum(['standard', 'full', 'off']),
  requireAssertions: z.boolean(),
  failureCaptureBudgetMs: z.number().int().positive(),
  testFinalizationBudgetMs: z.number().int().positive(),
  testFinalScreenshots: z.boolean(),
}).strict();

const pathsSchema = z.object({
  tests: z.string().min(1),
  scripts: z.string().min(1),
  recordings: z.string().min(1),
  flows: z.string().min(1),
}).strict();

const authState = z.enum(['guest', 'authenticated']);
// References resolve through project-owned registries; never transport host paths.
const deviceReference = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
const cameraSourceSchema = z.object({
  kind: z.enum(['image', 'video']), fixtureId: deviceReference,
}).strict();
const devicePermissionsSchema = z.array(z.object({
  permission: deviceReference, state: z.enum(['granted', 'denied', 'prompt']),
}).strict()).superRefine((permissions, context) => {
  const seen = new Set<string>();
  permissions.forEach((permission, index) => {
    if (seen.has(permission.permission)) context.addIssue({
      code: z.ZodIssueCode.custom, message: 'A device permission can be declared only once.', path: [index, 'permission'],
    });
    seen.add(permission.permission);
  });
});
const scenarioSchema = z.object({
  name: z.string().min(1), extends: z.array(z.string().min(1)).optional(),
  startupIsolation: z.enum(['required', 'optional']).optional(),
  layers: z.array(z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('device'), requiredCapabilities: z.array(deviceReference).optional(),
      baseline: deviceReference.optional(), biometricBaseline: deviceReference.optional(),
      permissions: devicePermissionsSchema.optional(),
      media: z.array(z.object({ kind: z.literal('image'), fixtureId: deviceReference }).strict()).optional(),
      cameraSource: z.object({ front: cameraSourceSchema.optional(), back: cameraSourceSchema.optional() }).strict()
        .refine(source => !!source.front || !!source.back, 'Select at least one camera source.').optional(),
    }).strict(),
    z.object({ kind: z.literal('mocks'), profile: z.string().optional(), directory: z.string().optional(), denyUnmatchedRequests: z.boolean().optional(),
      sources: z.array(z.object({ name: z.string().min(1), directory: z.string().min(1), files: z.array(z.string().min(1)).min(1) }).strict()).optional(),
      rules: z.array(z.object({ endpoint: z.string().min(1), method: z.string().min(1), rule: z.string().min(1),
        source: z.string().min(1).optional(), replace: z.boolean().optional(),
      }).strict()).optional(),
    }).strict(),
    z.object({ kind: z.literal('storage'), seed: z.record(z.unknown()).optional() }).strict(),
    z.object({ kind: z.literal('auth'), state: authState, preset: z.string().optional(), userId: z.string().optional(), roles: z.array(z.string()).optional(), metadata: z.record(z.unknown()).optional() }).strict(),
    z.object({ kind: z.literal('state'), adapter: z.string().min(1), key: z.string().min(1), value: z.unknown() }).strict(),
    z.object({ kind: z.literal('app'), capability: z.string().min(1), method: z.string().min(1), input: z.unknown().optional() }).strict(),
    z.object({ kind: z.literal('navigation'), route: z.string() }).strict(),
  ])),
  ready: z.array(z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('auth'), state: authState }).strict(),
    z.object({ kind: z.literal('route'), equals: z.string() }).strict(),
    z.object({ kind: z.literal('capability'), capability: z.string().min(1), method: z.string().min(1), input: z.unknown().optional() }).strict(),
  ])).optional(),
}).strict();

export const fliwrightConfigSchema = z.object({
  native: nativeConfigSchema.optional(),
  recording: recordingSchema.partial().optional(),
  paths: pathsSchema.partial().optional(),
  runsRoot: z.string().min(1).optional(),
  cacheRoot: z.string().min(1).optional(),
  scenarios: z.record(scenarioSchema).optional(),
  scenarioMode: z.enum(['managed-start', 'attach']).optional(),
  defaultScenario: z.string().min(1).optional(),
}).strict();

const resolvedFliwrightConfigSchema = fliwrightConfigSchema.extend({
  recording: recordingSchema,
  paths: pathsSchema,
}).strict();

/**
 * Publish an immutable, private JSON snapshot in the project's machine-local cache.
 * Pass only the returned absolute path as FLIWRIGHT_CONFIG_PATH. Identical settings
 * reuse one file; atomic publication keeps concurrent workers from reading partial JSON.
 */
export function writeFliwrightConfigSnapshot(config: unknown, options: {
  projectRoot?: string;
  cacheRoot?: string;
} = {}): string {
  const serialized = JSON.stringify(fliwrightConfigSchema.parse(config));
  const directory = join(resolveFliwrightCacheRoot(options), 'config');
  const file = join(directory, `${createHash('sha256').update(serialized).digest('hex')}.json`);
  if (existsSync(file)) return file;
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, serialized, { mode: 0o600, flag: 'wx' });
    renameSync(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
  return file;
}

/** Load shared settings from the referenced snapshot only when the caller needs them. */
export function readFliwrightEnvironment(environment: Record<string, string | undefined>): Partial<FliwrightProjectConfig> {
  const configPath = environment.FLIWRIGHT_CONFIG_PATH;
  const config = configPath
    ? fliwrightConfigSchema.parse(JSON.parse(readFileSync(resolve(environment.FLIWRIGHT_PROJECT_ROOT ?? process.cwd(), configPath), 'utf8')))
    : {};
  return fliwrightConfigSchema.parse({
    ...config,
    ...(environment.FLIWRIGHT_DEFAULT_SCENARIO ? { defaultScenario: environment.FLIWRIGHT_DEFAULT_SCENARIO } : {}),
    ...(environment.FLIWRIGHT_RECORDING_MODE ? { recording: { ...config.recording, mode: environment.FLIWRIGHT_RECORDING_MODE } } : {}),
    ...(environment.FLIWRIGHT_CACHE_ROOT ? { cacheRoot: environment.FLIWRIGHT_CACHE_ROOT } : {}),
    ...(environment.FLIWRIGHT_RUNS_ROOT ? { runsRoot: environment.FLIWRIGHT_RUNS_ROOT } : {}),
    ...(environment.FLIWRIGHT_SCENARIO_MODE ? { scenarioMode: environment.FLIWRIGHT_SCENARIO_MODE } : {}),
  }) as Partial<FliwrightProjectConfig>;
}

export function mergeFliwrightConfig(options: {
  projectRoot?: string;
  environmentSource?: NodeJS.ProcessEnv;
  project?: Partial<FliwrightProjectConfig>;
  environment?: Partial<FliwrightProjectConfig>;
  explicit?: Partial<FliwrightProjectConfig> & { vmServiceUrl?: string };
} = {}): ResolvedFliwrightConfig {
  const layers = [options.project, options.environment, options.explicit];
  const merged = {
    recording: Object.assign({}, DEFAULT_FLIWRIGHT_CONFIG.recording, ...layers.map((layer) => layer?.recording)),
    paths: Object.assign({
      recordings: join(resolveFliwrightRuntimeRoot({ projectRoot: options.projectRoot, env: options.environmentSource }), 'recordings'),
    }, DEFAULT_FLIWRIGHT_CONFIG.paths, ...layers.map((layer) => layer?.paths)),
    runsRoot: layers.reduce<string | undefined>((value, layer) => layer?.runsRoot ?? value, undefined),
    cacheRoot: layers.reduce<string | undefined>((value, layer) => layer?.cacheRoot ?? value, undefined),
    scenarios: layers.reduce<Record<string, TestScenario> | undefined>((value, layer) => layer?.scenarios ?? value, undefined),
    defaultScenario: layers.reduce<string | undefined>((value, layer) => layer?.defaultScenario ?? value, undefined),
    scenarioMode: layers.reduce<ScenarioExecutionMode | undefined>((value, layer) => layer?.scenarioMode ?? value, undefined),
    native: layers.reduce<NativeConfig | undefined>((value, layer) => layer?.native ?? value, undefined),
  } satisfies ResolvedFliwrightConfig;
  return resolvedFliwrightConfigSchema.parse(merged) as ResolvedFliwrightConfig;
}
