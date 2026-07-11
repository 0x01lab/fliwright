import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { MockCall } from '@fliwright/core';
import type { ServerState } from '../state.js';

export const MockListParamsSchema = z.object({
  mockDir: z.string().optional().describe('Path to .fliwright/mocks directory to load before listing.'),
});

export const MockSwitchParamsSchema = z.object({
  mockDir: z.string().optional().describe('Path to .fliwright/mocks directory. Defaults to .fliwright/mocks.'),
  endpoint: z.string().describe('API endpoint path, e.g. "/v1/public/token"'),
  method: z.string().optional().describe('HTTP method for endpoints that share the same path, e.g. "GET"'),
  ruleName: z.string().describe('Name of the rule to activate, e.g. "success", "empty", "server_error"'),
});

export const MockStatusParamsSchema = z.object({
  mockDir: z.string().optional().describe('Path to .fliwright/mocks directory to load before reading status.'),
  endpoint: z.string().optional().describe('Filter recent calls to one API endpoint path.'),
  method: z.string().optional().describe('Filter rules/routes/calls to one HTTP method.'),
  includeRoutes: z.boolean().optional().default(true).describe('Include active routes visible to the connected driver mock manager.'),
  includeCalls: z.boolean().optional().default(true).describe('Include recent mock calls visible to the connected driver mock manager.'),
  recentCallsLimit: z.number().int().positive().optional().default(20).describe('Maximum recent calls to return.'),
});

export const MockClearCallsParamsSchema = z.object({
  endpoint: z.string().optional().describe('Reserved for future endpoint-scoped clearing; current Flutter bridge clears all calls.'),
});

export interface MockRuleSummary {
  endpoint: string;
  method: string;
  rules: string[];
  activeRule: string;
}

export interface MockStatusResult {
  loaded: boolean;
  connected: boolean;
  rules: MockRuleSummary[];
  routes?: Array<{ id: string; method?: string; path: string }>;
  recentCalls?: MockCall[];
  errors?: Array<{ section: string; message: string }>;
}

export interface MockSwitchResult {
  switched: boolean;
  appliedToDriver: boolean;
  active?: MockRuleSummary;
  rules: MockRuleSummary[];
  errors?: Array<{ section: string; message: string }>;
}

export async function handleMockList(
  params: z.infer<typeof MockListParamsSchema>,
  state: ServerState,
): Promise<{ loaded: boolean; rules: MockRuleSummary[] }> {
  const input = MockListParamsSchema.parse(params);
  if (input.mockDir) {
    await state.getRuleStore().loadFromDirectory(input.mockDir);
  }
  const rules = state.getRuleStore().listEndpoints();
  return {
    loaded: rules.length > 0,
    rules,
  };
}

export async function handleMockStatus(
  params: z.infer<typeof MockStatusParamsSchema>,
  state: ServerState,
): Promise<MockStatusResult> {
  const input = MockStatusParamsSchema.parse(params);
  const errors: NonNullable<MockStatusResult['errors']> = [];
  const driver = state.getDriver();
  const mock = driver?.mock as DriverMockManager | undefined;

  if (input.mockDir) {
    await state.getRuleStore().loadFromDirectory(input.mockDir);
    if (mock?.loadRules) {
      try {
        await mock.loadRules(input.mockDir);
      } catch (error) {
        errors.push({ section: 'mock.loadRules', message: errorMessage(error) });
      }
    }
  }

  const rules = filterRules(readRules(state, mock), input);
  const result: MockStatusResult = {
    loaded: rules.length > 0,
    connected: Boolean(driver),
    rules,
    ...(errors.length > 0 ? { errors } : {}),
  };

  if (input.includeRoutes && mock?.listRoutes) {
    try {
      result.routes = filterRoutes(await mock.listRoutes(), input);
    } catch (error) {
      errors.push({ section: 'mock.routes', message: errorMessage(error) });
    }
  }

  if (input.includeCalls && mock?.getCalls) {
    try {
      const calls = await mock.getCalls(input.endpoint);
      result.recentCalls = filterCalls(calls, input).slice(-input.recentCallsLimit);
    } catch (error) {
      errors.push({ section: 'mock.calls', message: errorMessage(error) });
    }
  }

  if (errors.length > 0) result.errors = errors;
  return result;
}

export async function handleMockSwitch(
  params: z.infer<typeof MockSwitchParamsSchema>,
  state: ServerState,
): Promise<MockSwitchResult> {
  const input = MockSwitchParamsSchema.parse(params);
  const mockDir = input.mockDir ?? '.fliwright/mocks';
  const errors: NonNullable<MockSwitchResult['errors']> = [];
  const driver = state.getDriver();
  const mock = driver?.mock as DriverMockManager | undefined;

  if (input.mockDir || !state.getRuleStore().isLoaded) {
    await state.getRuleStore().loadFromDirectory(mockDir);
  }
  state.getRuleStore().switchRule(input.endpoint, input.ruleName, input.method);

  let appliedToDriver = false;
  if (mock?.loadRules && mock.switchRule) {
    try {
      await mock.loadRules(mockDir);
      await mock.switchRule(input.endpoint, input.ruleName, input.method);
      appliedToDriver = true;
    } catch (error) {
      errors.push({ section: 'mock.apply', message: errorMessage(error) });
    }
  }

  const rules = readRules(state, mock);
  return {
    switched: true,
    appliedToDriver,
    active: findRule(rules, input.endpoint, input.method),
    rules,
    ...(errors.length > 0 ? { errors } : {}),
  };
}

export async function handleMockClearCalls(
  _params: z.infer<typeof MockClearCallsParamsSchema>,
  state: ServerState,
): Promise<{ connected: boolean; cleared: boolean }> {
  const mock = state.getDriver()?.mock as DriverMockManager | undefined;
  if (!mock?.clearCalls) return { connected: Boolean(state.getDriver()), cleared: false };
  await mock.clearCalls();
  return { connected: true, cleared: true };
}

export function registerMockListTool(server: McpServer, state: ServerState): void {
  server.tool(
    'fliwright_mock_list',
    'List all mock API endpoints, their available rules, and currently active rule',
    MockListParamsSchema.shape,
    async (params) => {
      const result = await handleMockList(params, state);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}

export function registerMockSwitchTool(server: McpServer, state: ServerState): void {
  server.tool(
    'fliwright_mock_switch',
    'Switch the active mock rule for a specific API endpoint. The endpoint must have been loaded from .fliwright/mocks/ config files.',
    MockSwitchParamsSchema.shape,
    async (params) => {
      try {
        const result = await handleMockSwitch(params, state);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text' as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    },
  );
}

export function registerMockStatusTool(server: McpServer, state: ServerState): void {
  server.tool(
    'fliwright_mock_status',
    'Return active mock rules, applied routes, and recent mock calls for the connected Flutter app.',
    MockStatusParamsSchema.shape,
    async (params) => ({
      content: [{ type: 'text' as const, text: JSON.stringify(await handleMockStatus(params, state), null, 2) }],
    }),
  );
}

export function registerMockClearCallsTool(server: McpServer, state: ServerState): void {
  server.tool(
    'fliwright_mock_clear_calls',
    'Clear buffered mock request call history in the connected Flutter app.',
    MockClearCallsParamsSchema.shape,
    async (params) => ({
      content: [{ type: 'text' as const, text: JSON.stringify(await handleMockClearCalls(params, state), null, 2) }],
    }),
  );
}

interface DriverMockManager {
  loadRules?(mockDir?: string): Promise<void>;
  switchRule?(endpoint: string, ruleName: string, method?: string): Promise<void>;
  listRules?(): MockRuleSummary[];
  listRoutes?(): Promise<Array<{ id: string; method?: string; path: string }>>;
  getCalls?(path?: string): Promise<MockCall[]>;
  clearCalls?(): Promise<void>;
}

function readRules(state: ServerState, mock: DriverMockManager | undefined): MockRuleSummary[] {
  const driverRules = mock?.listRules?.() ?? [];
  if (driverRules.length > 0) return driverRules;
  return state.getRuleStore().listEndpoints();
}

function filterRules(
  rules: MockRuleSummary[],
  input: { endpoint?: string; method?: string },
): MockRuleSummary[] {
  return rules.filter((rule) => (
    (!input.endpoint || rule.endpoint === input.endpoint) &&
    (!input.method || rule.method.toUpperCase() === input.method.toUpperCase())
  ));
}

function filterRoutes(
  routes: Array<{ id: string; method?: string; path: string }>,
  input: { endpoint?: string; method?: string },
): Array<{ id: string; method?: string; path: string }> {
  return routes.filter((route) => (
    (!input.endpoint || route.path === input.endpoint) &&
    (!input.method || route.method?.toUpperCase() === input.method.toUpperCase())
  ));
}

function filterCalls(
  calls: MockCall[],
  input: { method?: string },
): MockCall[] {
  return calls.filter((call) => (
    !input.method || call.method.toUpperCase() === input.method.toUpperCase()
  ));
}

function findRule(
  rules: MockRuleSummary[],
  endpoint: string,
  method: string | undefined,
): MockRuleSummary | undefined {
  return rules.find((rule) => (
    rule.endpoint === endpoint &&
    (!method || rule.method.toUpperCase() === method.toUpperCase())
  ));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
