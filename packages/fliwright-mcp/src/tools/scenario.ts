import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ScenarioCoordinator, ScenarioResolver } from '@fliwright/core';
import { loadConfig } from '@fliwright/cli';
import type { ServerState } from '../state.js';
import { requireDriver } from './screenshot.js';

export const ScenarioParamsSchema = z.object({
  operation: z.enum(['list', 'resolve', 'apply']).describe('Scenario operation'),
  name: z.string().optional().describe('Named scenario from fliwright.config.ts'),
  cwd: z.string().optional().describe('Workspace containing fliwright.config.ts'),
  mode: z.enum(['managed-start', 'attach']).optional(),
});

export async function handleScenario(
  params: z.infer<typeof ScenarioParamsSchema>,
  state: ServerState,
): Promise<unknown> {
  const input = ScenarioParamsSchema.parse(params);
  const config = await loadConfig(input.cwd ?? process.cwd());
  const scenarios = config.scenarios ?? {};
  if (input.operation === 'list') {
    return {
      scenarios: Object.keys(scenarios).sort().map((name) => ({
        name,
        startupIsolation: scenarios[name]?.startupIsolation ?? 'optional',
        layers: scenarios[name]?.layers.map((layer) => layer.kind) ?? [],
      })),
    };
  }

  const name = requireName(input.name);
  const resolved = new ScenarioResolver(scenarios).resolve(name);
  if (input.operation === 'resolve') return resolved;
  const driver = requireDriver(state);
  return new ScenarioCoordinator(driver).apply(resolved, {
    mode: input.mode ?? config.scenarioMode ?? 'attach',
  });
}

export function registerScenarioTool(server: McpServer, state: ServerState): void {
  server.tool(
    'fliwright_scenario',
    'List, resolve, or apply a named deterministic TestScenario from fliwright.config.ts.',
    ScenarioParamsSchema.shape,
    async (params) => ({
      content: [{ type: 'text', text: JSON.stringify(await handleScenario(params, state), null, 2) }],
    }),
  );
}

function requireName(name: string | undefined): string {
  if (!name) throw new Error('scenario resolve/apply requires name');
  return name;
}
