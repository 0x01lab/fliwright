import { z } from 'zod';
import type { ScenarioExecutionMode, TestScenario } from './Scenario.js';

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
  recording: Partial<FliwrightRecordingConfig>;
  paths: Partial<FliwrightPathsConfig>;
  runsRoot?: string;
  scenarios?: Record<string, TestScenario>;
  scenarioMode?: ScenarioExecutionMode;
  defaultScenario?: string;
}

export interface ResolvedFliwrightConfig {
  recording: FliwrightRecordingConfig;
  paths: FliwrightPathsConfig;
  runsRoot?: string;
  scenarios?: Record<string, TestScenario>;
  scenarioMode?: ScenarioExecutionMode;
  defaultScenario?: string;
}

export const DEFAULT_FLIWRIGHT_CONFIG: ResolvedFliwrightConfig = {
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
    recordings: '.fliwright/recordings',
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
const scenarioSchema = z.object({
  name: z.string().min(1), extends: z.array(z.string().min(1)).optional(),
  startupIsolation: z.enum(['required', 'optional']).optional(),
  layers: z.array(z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('mocks'), profile: z.string().optional(), directory: z.string().optional(), denyUnmatchedRequests: z.boolean().optional() }).strict(),
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
  recording: recordingSchema.partial().optional(),
  paths: pathsSchema.partial().optional(),
  runsRoot: z.string().min(1).optional(),
  scenarios: z.record(scenarioSchema).optional(),
  scenarioMode: z.enum(['managed-start', 'attach']).optional(),
  defaultScenario: z.string().min(1).optional(),
}).strict();

const resolvedFliwrightConfigSchema = fliwrightConfigSchema.extend({
  recording: recordingSchema,
  paths: pathsSchema,
}).strict();

/** Decode shared settings at a process boundary without loading a project file. */
export function readFliwrightEnvironment(environment: Record<string, string | undefined>): Partial<FliwrightProjectConfig> {
  const config = environment.FLIWRIGHT_CONFIG ? fliwrightConfigSchema.parse(JSON.parse(environment.FLIWRIGHT_CONFIG)) : {};
  return fliwrightConfigSchema.parse({
    ...config,
    ...(environment.FLIWRIGHT_DEFAULT_SCENARIO ? { defaultScenario: environment.FLIWRIGHT_DEFAULT_SCENARIO } : {}),
    ...(environment.FLIWRIGHT_RECORDING_MODE ? { recording: { ...config.recording, mode: environment.FLIWRIGHT_RECORDING_MODE } } : {}),
    ...(environment.FLIWRIGHT_RUNS_ROOT ? { runsRoot: environment.FLIWRIGHT_RUNS_ROOT } : {}),
    ...(environment.FLIWRIGHT_SCENARIOS ? { scenarios: JSON.parse(environment.FLIWRIGHT_SCENARIOS) } : {}),
    ...(environment.FLIWRIGHT_SCENARIO_MODE ? { scenarioMode: environment.FLIWRIGHT_SCENARIO_MODE } : {}),
  }) as Partial<FliwrightProjectConfig>;
}

export function mergeFliwrightConfig(options: {
  project?: Partial<FliwrightProjectConfig>;
  environment?: Partial<FliwrightProjectConfig>;
  explicit?: Partial<FliwrightProjectConfig> & { vmServiceUrl?: string };
} = {}): ResolvedFliwrightConfig {
  const layers = [options.project, options.environment, options.explicit];
  const merged = {
    recording: Object.assign({}, DEFAULT_FLIWRIGHT_CONFIG.recording, ...layers.map((layer) => layer?.recording)),
    paths: Object.assign({}, DEFAULT_FLIWRIGHT_CONFIG.paths, ...layers.map((layer) => layer?.paths)),
    runsRoot: layers.reduce<string | undefined>((value, layer) => layer?.runsRoot ?? value, undefined),
    scenarios: layers.reduce<Record<string, TestScenario> | undefined>((value, layer) => layer?.scenarios ?? value, undefined),
    defaultScenario: layers.reduce<string | undefined>((value, layer) => layer?.defaultScenario ?? value, undefined),
    scenarioMode: layers.reduce<ScenarioExecutionMode | undefined>((value, layer) => layer?.scenarioMode ?? value, undefined),
  } satisfies ResolvedFliwrightConfig;
  return resolvedFliwrightConfigSchema.parse(merged) as ResolvedFliwrightConfig;
}
