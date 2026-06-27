import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { analyzeInteractionSpecCoverage, defaultStatusFilePath, TddRuntime, validateInteractionSpec } from '@fliwright/tdd';
import type {
  InteractionSpec,
  InteractionSpecCoverageReport,
  InteractionSpecValidationIssue,
  RuntimeSnapshot,
  Scenario,
  TddCycleResult,
} from '@fliwright/tdd';
import type { ServerState } from '../state.js';
import type { GenerateTestResult, TddWorkflowContext } from '../types.js';
import { prepareRedFirstGeneratedTest } from './generateTest.js';

const ScenarioSchema = z.object({
  homeRoute: z.string().default('/'),
  resetCategories: z.array(z.enum([
    'navigation',
    'riverpod',
    'mock',
    'storage',
    'secureStorage',
    'authTokens',
    'webview',
    'localDb',
    'timers',
    'isolates',
    'permissions',
  ])).default(['navigation', 'mock']),
  riverpodOverrides: z.array(z.any()).optional(),
  mockProfile: z.string().optional(),
  mockDir: z.string().optional(),
  storageSeed: z.record(z.string(), z.unknown()).optional(),
});

export const TddStartParamsSchema = z.object({
  configRoot: z.string().describe('Path to the Vitest config file or project root for the persistent executor'),
  vmServiceUrl: z.string().optional().describe('Attach to an already-running Flutter VM service URL'),
  deviceId: z.string().optional().describe('Flutter daemon device id to launch'),
  target: z.string().optional().describe('Flutter target file, usually lib/main.dart'),
  projectId: z.string().optional().describe('Flutter project directory/id for app.start'),
  flutterArgs: z.array(z.string()).optional().describe('Extra flutter run arguments for app.start'),
  mode: z.enum(['run', 'drive']).optional().describe('Flutter daemon app.start mode'),
  scenario: ScenarioSchema.optional(),
  statusFilePath: z.string().optional()
    .describe('Path the runtime writes its RuntimeSnapshot to for read-only monitors (VS Code TDD Loop). Defaults to <projectRoot>/.fliwright/tdd-status.json.'),
});

export const TddFocusParamsSchema = z.object({
  file: z.string().optional().describe('Absolute or project-relative test file path'),
  testName: z.string().optional().describe('Focused test name or regex text'),
});

export const TddCycleParamsSchema = z.object({
  testName: z.string().optional().describe('Override focused test name for this cycle'),
  sync: z.enum(['none', 'reload', 'restart', 'auto']).optional().default('none')
    .describe("'auto' decides reload vs restart from `changes` (generated/pubspec/assets -> restart, else reload)."),
  fullReset: z.boolean().optional()
    .describe('Force a full baseline reset. Defaults to true after a restart.'),
  changes: z.array(z.string()).optional()
    .describe('Changed file paths since the last sync; only consulted when sync is "auto".'),
  autoEscalate: z.boolean().optional().default(true)
    .describe('Retry a structural-looking reload failure once with a hot restart (when restart is available).'),
  timeoutMs: z.number().int().positive().optional()
    .describe('Per-cycle wall-clock budget (ms). On expiry the caller gets a red `timeout` result while the body finishes.'),
  repair: z.object({
    mode: z.enum(['suggest', 'safe-apply'])
      .describe("'suggest' emits a repair diff for approval (no apply, no loop); 'safe-apply' applies only guardrail-safe repairs and loops cycle(red) → repair → cycle until green or the cap."),
    iterations: z.number().int().positive().optional()
      .describe('Max repair→cycle iterations in safe-apply mode (default 3). Ignored for suggest.'),
  }).optional()
    .describe('Run an inline AI repair closed loop after the initial cycle when it is red (design P3). Requires a repair planner wired into the runtime.'),
});

export const TddRepairParamsSchema = z.object({
  mode: z.enum(['suggest', 'safe-apply'])
    .describe("'suggest' returns the repair diff/plan for approval and applies nothing; 'safe-apply' applies only guardrail-safe repairs and re-cycles until green or the iteration cap."),
  testName: z.string().optional()
    .describe('Override focused test name for the cycle driving this repair'),
  iterations: z.number().int().positive().optional()
    .describe('Max repair→cycle iterations in safe-apply mode (default 3). Ignored for suggest.'),
  sync: z.enum(['none', 'reload', 'restart', 'auto']).optional().default('none')
    .describe('App sync for each cycle in the loop.'),
  fullReset: z.boolean().optional()
    .describe('Force a full baseline reset for each cycle in the loop.'),
  changes: z.array(z.string()).optional()
    .describe('Changed file paths since the last sync; only consulted when sync is "auto".'),
  autoEscalate: z.boolean().optional().default(true)
    .describe('Retry a structural-looking reload failure once with a hot restart per cycle (when restart is available).'),
  timeoutMs: z.number().int().positive().optional()
    .describe('Per-cycle wall-clock budget (ms) for each cycle in the loop.'),
});

export const TddStopParamsSchema = z.object({
  keepAppAlive: z.boolean().optional().default(false),
});

export const TddSetScenarioParamsSchema = ScenarioSchema;

export interface TddSyncToolResult {
  lastSync: 'reload' | 'restart' | 'none';
  snapshot: RuntimeSnapshot;
}

interface TddRuntimeScenarioControl {
  setScenario(scenario: Scenario): Promise<RuntimeSnapshot>;
  syncApp(sync: 'reload' | 'restart' | 'none'): Promise<TddSyncToolResult>;
}

export const TddPrepareParamsSchema = z.object({
  spec: z.object({
    app: z.any().optional(),
    initialState: z.any().optional(),
    elements: z.array(z.any()),
    flows: z.array(z.any()),
    assertions: z.array(z.any()).optional(),
  }).passthrough().describe('InteractionSpec from Figma MCP and interaction intent parsing'),
  flowId: z.string().optional().describe('Flow id to generate when the spec contains multiple flows'),
  allFlows: z.boolean().optional().default(false)
    .describe('Generate one red-first test for every selected flow in the InteractionSpec'),
  flowIds: z.array(z.string()).optional()
    .describe('Subset of flow ids to generate when allFlows is true'),
  testNamePrefix: z.string().optional()
    .describe('Prefix to apply to generated suite test names when allFlows is true'),
  snapshot: z.string().optional().describe('Agent-readable snapshot text from fliwright_snap'),
  refs: z.array(z.object({
    role: z.string(),
    label: z.string(),
    key: z.string().optional(),
    type: z.string().optional(),
    selector: z.string().optional(),
    textField: z.boolean().optional(),
  })).optional().describe('Structured refs from fliwright_snap'),
  testName: z.string().optional().describe('Name for the generated red-first test'),
  resetToHomeBeforeEach: z.boolean().optional().default(true)
    .describe('Whether to generate a beforeEach hook that navigates to the home route before each test'),
  homeRoute: z.string().optional().default('/')
    .describe('Route used by the generated beforeEach home reset hook'),
  outputFile: z.string().optional().describe('Optional path to write the generated red-first test file'),
  focus: z.boolean().optional().default(true)
    .describe('Focus the persistent TDD runtime on the generated test when runtime and outputFile are available'),
});

export interface TddPrepareResult extends GenerateTestResult {
  focused?: RuntimeSnapshot;
}

export interface TddStatusResult extends RuntimeSnapshot {
  workflowContext?: TddWorkflowContext | null;
}

export const TddValidateSpecParamsSchema = z.object({
  spec: z.any().describe('InteractionSpec candidate to validate before red-first generation'),
});

export type TddValidateSpecResult =
  | {
    valid: true;
    issues: [];
    coverage: InteractionSpecCoverageReport;
  }
  | {
    valid: false;
    issues: InteractionSpecValidationIssue[];
  };

export function stoppedTddSnapshot(): RuntimeSnapshot {
  return {
    connected: false,
    daemonStatus: 'stopped',
    supportsRestart: false,
    launchMode: 'attach',
    restartCapable: false,
    driverConnections: 0,
    fixtureDriverSharing: 'vm-service-url',
    baselineVersion: 0,
  };
}

export async function handleTddStart(
  params: z.infer<typeof TddStartParamsSchema>,
  state: ServerState,
  runtimeFactory: () => TddRuntime = () => new TddRuntime(),
): Promise<RuntimeSnapshot> {
  const input = TddStartParamsSchema.parse(params);
  if (!input.vmServiceUrl && !input.deviceId) {
    throw new Error('fliwright_tdd_start requires either vmServiceUrl or deviceId.');
  }

  const existingRuntime = state.getTddRuntime();
  const runtime = existingRuntime ?? runtimeFactory();
  try {
    const snapshot = await runtime.start({
      configRoot: input.configRoot,
      vmServiceUrl: input.vmServiceUrl,
      app: input.deviceId
        ? {
          deviceId: input.deviceId,
          flutterArgs: input.flutterArgs,
          mode: input.mode,
          target: input.target,
          projectId: input.projectId,
        }
        : undefined,
      launchMode: input.vmServiceUrl ? 'attach' : 'start',
      scenario: input.scenario as Scenario | undefined,
      statusFilePath: input.statusFilePath ?? defaultStatusFilePath(input.configRoot),
    });
    state.setTddRuntime(runtime);
    return snapshot;
  } catch (error) {
    if (!existingRuntime) state.setTddRuntime(null);
    throw error;
  }
}

export async function handleTddFocus(
  params: z.infer<typeof TddFocusParamsSchema>,
  state: ServerState,
): Promise<RuntimeSnapshot> {
  const runtime = requireTddRuntime(state);
  const input = TddFocusParamsSchema.parse(params);
  const workflowContext = state.getTddWorkflowContext();
  const file = input.file ?? workflowContext?.testFile;
  if (!file) {
    throw new Error('fliwright_tdd_focus requires file, or a prior red-first fliwright_generate_test call with outputFile.');
  }
  await runtime.focus(file, input.testName ?? workflowContext?.testName);
  return runtime.snapshot();
}

export function handleTddStatus(state: ServerState): TddStatusResult {
  return {
    ...(state.getTddRuntime()?.snapshot() ?? stoppedTddSnapshot()),
    workflowContext: state.getTddWorkflowContext(),
  };
}

export async function handleTddCycle(
  params: z.infer<typeof TddCycleParamsSchema>,
  state: ServerState,
): Promise<TddCycleResult> {
  const runtime = requireTddRuntime(state);
  const input = TddCycleParamsSchema.parse(params);
  await focusWorkflowTestIfNeeded(runtime, state, input.testName);
  // Conditional spread keeps the cycle opts byte-for-byte identical to today when `repair` is absent
  // (the existing tool contract asserts an exact opts object without a `repair` key).
  const cycleOpts = input.repair
    ? {
      sync: input.sync,
      fullReset: input.fullReset,
      changes: input.changes,
      autoEscalate: input.autoEscalate,
      timeoutMs: input.timeoutMs,
      repair: input.repair,
    }
    : {
      sync: input.sync,
      fullReset: input.fullReset,
      changes: input.changes,
      autoEscalate: input.autoEscalate,
      timeoutMs: input.timeoutMs,
    };
  return await runtime.cycle(input.testName, cycleOpts);
}

/**
 * Drives the AI repair closed loop standalone (design §7 P3). Runs an initial cycle on the focused
 * test; if red, proposes/applies a guardrail-bounded repair and (in safe-apply) re-cycles until green
 * or the iteration cap. Returns the final cycle result plus the repair trace (diffs suggested/applied).
 * Requires a repair planner wired into the runtime.
 */
export async function handleTddRepair(
  params: z.infer<typeof TddRepairParamsSchema>,
  state: ServerState,
): Promise<TddCycleResult> {
  const runtime = requireTddRuntime(state);
  const input = TddRepairParamsSchema.parse(params);
  await focusWorkflowTestIfNeeded(runtime, state, input.testName);
  return await runtime.cycle(input.testName, {
    sync: input.sync,
    fullReset: input.fullReset,
    changes: input.changes,
    autoEscalate: input.autoEscalate,
    timeoutMs: input.timeoutMs,
    repair: { mode: input.mode, iterations: input.iterations },
  });
}

export async function handleTddReconnect(state: ServerState): Promise<RuntimeSnapshot> {
  const runtime = requireTddRuntime(state);
  return await runtime.reconnect();
}

export async function handleTddSetScenario(
  params: z.infer<typeof TddSetScenarioParamsSchema>,
  state: ServerState,
): Promise<RuntimeSnapshot> {
  const runtime = requireTddRuntime(state) as TddRuntime & TddRuntimeScenarioControl;
  const input = TddSetScenarioParamsSchema.parse(params);
  return await runtime.setScenario(input as Scenario);
}

export async function handleTddReload(state: ServerState): Promise<TddSyncToolResult> {
  const runtime = requireTddRuntime(state) as TddRuntime & TddRuntimeScenarioControl;
  return await runtime.syncApp('reload');
}

export async function handleTddRestart(state: ServerState): Promise<TddSyncToolResult> {
  const runtime = requireTddRuntime(state) as TddRuntime & TddRuntimeScenarioControl;
  return await runtime.syncApp('restart');
}

export async function handleTddStop(
  params: z.infer<typeof TddStopParamsSchema>,
  state: ServerState,
): Promise<RuntimeSnapshot> {
  const runtime = requireTddRuntime(state);
  const input = TddStopParamsSchema.parse(params);
  try {
    await runtime.stop({ keepAppAlive: input.keepAppAlive });
    return runtime.snapshot();
  } finally {
    state.setTddRuntime(null);
  }
}

export async function handleTddPrepare(
  params: z.infer<typeof TddPrepareParamsSchema>,
  state: ServerState,
): Promise<TddPrepareResult> {
  const input = TddPrepareParamsSchema.parse(params);
  const result = await prepareRedFirstGeneratedTest({
    mode: 'red-first',
    spec: input.spec as InteractionSpec,
    flowId: input.flowId,
    allFlows: input.allFlows,
    flowIds: input.flowIds,
    testNamePrefix: input.testNamePrefix,
    snapshot: input.snapshot,
    refs: input.refs,
    testName: input.testName,
    resetToHomeBeforeEach: input.resetToHomeBeforeEach,
    homeRoute: input.homeRoute,
    outputFile: input.outputFile,
  }, state);

  const runtime = state.getTddRuntime();
  if (!input.focus || !runtime || !result.testFile) return result;

  const focusedTestName = result.tests && result.tests.length > 1 ? undefined : result.testName;
  await runtime.focus(result.testFile, focusedTestName);
  return {
    ...result,
    focused: runtime.snapshot(),
  };
}

export function handleTddValidateSpec(
  params: z.infer<typeof TddValidateSpecParamsSchema>,
): TddValidateSpecResult {
  const input = TddValidateSpecParamsSchema.parse(params);
  const validation = validateInteractionSpec(input.spec);
  if (!validation.ok) {
    return {
      valid: false,
      issues: validation.issues,
    };
  }
  return {
    valid: true,
    issues: [],
    coverage: analyzeInteractionSpecCoverage(validation.spec),
  };
}

export function registerTddTools(server: McpServer, state: ServerState): void {
  server.tool(
    'fliwright_tdd_start',
    'Start or attach the persistent Fliwright TDD runtime.',
    TddStartParamsSchema.shape,
    async (params) => ({
      content: [{ type: 'text', text: JSON.stringify(await handleTddStart(params, state), null, 2) }],
    }),
  );

  server.tool(
    'fliwright_tdd_status',
    'Read the current persistent Fliwright TDD runtime status.',
    {},
    async () => ({
      content: [{ type: 'text', text: JSON.stringify(handleTddStatus(state), null, 2) }],
    }),
  );

  server.tool(
    'fliwright_tdd_focus',
    'Focus the persistent TDD runtime on one test file and optional test name.',
    TddFocusParamsSchema.shape,
    async (params) => ({
      content: [{ type: 'text', text: JSON.stringify(await handleTddFocus(params, state), null, 2) }],
    }),
  );

  server.tool(
    'fliwright_tdd_cycle',
    'Reset baseline, sync the app (none/reload/restart/auto), and rerun the focused TDD test. '
      + 'With autoEscalate (default), a reload that fails with a structural-looking error is retried once with a hot restart when the runtime can restart. '
      + 'On timeoutMs expiry the caller gets a red `timeout` result without wedging the loop. '
      + 'Optionally run an inline AI repair closed loop (repair.mode) after a red cycle: suggest emits a diff for approval, safe-apply applies only guardrail-safe repairs and re-cycles until green or the cap.',
    TddCycleParamsSchema.shape,
    async (params) => ({
      content: [{ type: 'text', text: JSON.stringify(await handleTddCycle(params, state), null, 2) }],
    }),
  );

  server.tool(
    'fliwright_tdd_repair',
    'Drive the AI repair closed loop for the focused TDD test (design P3). '
      + 'Runs an initial cycle; if red, proposes a guardrail-bounded minimal repair and (in safe-apply) re-cycles until green or the iteration cap. '
      + 'suggest returns the repair diff/plan for approval and applies nothing; safe-apply applies only safe runtime repairs and loops. '
      + 'Returns the final cycle result plus a repair trace (diffs suggested/applied). Requires a repair planner wired into the runtime.',
    TddRepairParamsSchema.shape,
    async (params) => ({
      content: [{ type: 'text', text: JSON.stringify(await handleTddRepair(params, state), null, 2) }],
    }),
  );

  server.tool(
    'fliwright_tdd_reconnect',
    'Recover after a VM disconnect: relaunch the daemon app (or retry the VM URL in attach mode), rebind the driver, and reboot the executor if the URL changed.',
    {},
    async () => ({
      content: [{ type: 'text', text: JSON.stringify(await handleTddReconnect(state), null, 2) }],
    }),
  );

  server.tool(
    'fliwright_tdd_set_scenario',
    'Update the persistent TDD runtime baseline scenario (home route, reset categories, Riverpod overrides, mock profile, storage seed).',
    TddSetScenarioParamsSchema.shape,
    async (params) => ({
      content: [{ type: 'text', text: JSON.stringify(await handleTddSetScenario(params, state), null, 2) }],
    }),
  );

  server.tool(
    'fliwright_tdd_reload',
    'Manually hot reload the app owned or attached by the persistent TDD runtime.',
    {},
    async () => ({
      content: [{ type: 'text', text: JSON.stringify(await handleTddReload(state), null, 2) }],
    }),
  );

  server.tool(
    'fliwright_tdd_restart',
    'Manually hot restart the daemon-started app owned by the persistent TDD runtime.',
    {},
    async () => ({
      content: [{ type: 'text', text: JSON.stringify(await handleTddRestart(state), null, 2) }],
    }),
  );

  server.tool(
    'fliwright_tdd_validate_spec',
    'Validate an InteractionSpec and return coverage gaps before red-first generation.',
    TddValidateSpecParamsSchema.shape,
    async (params) => ({
      content: [{ type: 'text', text: JSON.stringify(handleTddValidateSpec(params), null, 2) }],
    }),
  );

  server.tool(
    'fliwright_tdd_prepare',
    'Generate a red-first test from an InteractionSpec, persist workflow state, and focus it when possible.',
    TddPrepareParamsSchema.shape,
    async (params) => ({
      content: [{ type: 'text', text: JSON.stringify(await handleTddPrepare(params, state), null, 2) }],
    }),
  );

  server.tool(
    'fliwright_tdd_stop',
    'Stop the persistent Fliwright TDD runtime.',
    TddStopParamsSchema.shape,
    async (params) => ({
      content: [{ type: 'text', text: JSON.stringify(await handleTddStop(params, state), null, 2) }],
    }),
  );
}

function requireTddRuntime(state: ServerState): TddRuntime {
  const runtime = state.getTddRuntime();
  if (!runtime) throw new Error('TDD runtime is not started. Call fliwright_tdd_start first.');
  return runtime;
}

async function focusWorkflowTestIfNeeded(
  runtime: TddRuntime,
  state: ServerState,
  testName: string | undefined,
): Promise<void> {
  if (runtime.snapshot().focusedTest) return;
  const workflowContext = state.getTddWorkflowContext();
  if (!workflowContext?.testFile) return;
  await runtime.focus(workflowContext.testFile, testName ?? workflowContext.testName);
}
