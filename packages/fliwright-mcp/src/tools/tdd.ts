import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { TddRuntime } from '@fliwright/tdd';
import type { RuntimeSnapshot, Scenario, TddCycleResult } from '@fliwright/tdd';
import type { ServerState } from '../state.js';

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
});

export const TddStartParamsSchema = z.object({
  configRoot: z.string().describe('Path to the Vitest config file or project root for the persistent executor'),
  vmServiceUrl: z.string().optional().describe('Attach to an already-running Flutter VM service URL'),
  deviceId: z.string().optional().describe('Flutter daemon device id to launch'),
  target: z.string().optional().describe('Flutter target file, usually lib/main.dart'),
  projectId: z.string().optional().describe('Flutter project directory/id for app.start'),
  scenario: ScenarioSchema.optional(),
});

export const TddFocusParamsSchema = z.object({
  file: z.string().describe('Absolute or project-relative test file path'),
  testName: z.string().optional().describe('Focused test name or regex text'),
});

export const TddCycleParamsSchema = z.object({
  testName: z.string().optional().describe('Override focused test name for this cycle'),
  sync: z.enum(['none', 'reload', 'restart']).optional().default('none'),
  fullReset: z.boolean().optional(),
});

export const TddStopParamsSchema = z.object({
  keepAppAlive: z.boolean().optional().default(false),
});

export async function handleTddStart(
  params: z.infer<typeof TddStartParamsSchema>,
  state: ServerState,
  runtimeFactory: () => TddRuntime = () => new TddRuntime(),
): Promise<RuntimeSnapshot> {
  const input = TddStartParamsSchema.parse(params);
  if (!input.vmServiceUrl && !input.deviceId) {
    throw new Error('fliwright_tdd_start requires either vmServiceUrl or deviceId.');
  }

  const runtime = state.getTddRuntime() ?? runtimeFactory();
  state.setTddRuntime(runtime);

  return await runtime.start({
    configRoot: input.configRoot,
    vmServiceUrl: input.vmServiceUrl,
    app: input.deviceId
      ? {
        deviceId: input.deviceId,
        target: input.target,
        projectId: input.projectId,
      }
      : undefined,
    launchMode: input.vmServiceUrl ? 'attach' : 'start',
    scenario: input.scenario as Scenario | undefined,
  });
}

export async function handleTddFocus(
  params: z.infer<typeof TddFocusParamsSchema>,
  state: ServerState,
): Promise<RuntimeSnapshot> {
  const runtime = requireTddRuntime(state);
  const input = TddFocusParamsSchema.parse(params);
  await runtime.focus(input.file, input.testName);
  return runtime.snapshot();
}

export async function handleTddCycle(
  params: z.infer<typeof TddCycleParamsSchema>,
  state: ServerState,
): Promise<TddCycleResult> {
  const runtime = requireTddRuntime(state);
  const input = TddCycleParamsSchema.parse(params);
  return await runtime.cycle(input.testName, {
    sync: input.sync,
    fullReset: input.fullReset,
  });
}

export async function handleTddStop(
  params: z.infer<typeof TddStopParamsSchema>,
  state: ServerState,
): Promise<RuntimeSnapshot> {
  const runtime = requireTddRuntime(state);
  const input = TddStopParamsSchema.parse(params);
  await runtime.stop({ keepAppAlive: input.keepAppAlive });
  const snapshot = runtime.snapshot();
  state.setTddRuntime(null);
  return snapshot;
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
    'fliwright_tdd_focus',
    'Focus the persistent TDD runtime on one test file and optional test name.',
    TddFocusParamsSchema.shape,
    async (params) => ({
      content: [{ type: 'text', text: JSON.stringify(await handleTddFocus(params, state), null, 2) }],
    }),
  );

  server.tool(
    'fliwright_tdd_cycle',
    'Reset baseline, optionally sync the app, and rerun the focused TDD test.',
    TddCycleParamsSchema.shape,
    async (params) => ({
      content: [{ type: 'text', text: JSON.stringify(await handleTddCycle(params, state), null, 2) }],
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
