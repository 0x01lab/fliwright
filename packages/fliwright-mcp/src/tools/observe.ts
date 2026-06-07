import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { observeInteraction, type SnapshotRef } from '@fliwright/cli/capabilities/interaction';
import type { ServerState } from '../state.js';
import { requireDriver } from './screenshot.js';

export interface ObserveCandidate extends SnapshotRef {
  diagnostics?: Record<string, unknown>;
}

export const ObserveParamsSchema = z.object({
  intent: z.string().optional().describe('Optional human intent for diagnostics'),
  roles: z.string().optional().describe('Comma-separated roles to include, e.g. button,textbox'),
  limit: z.number().optional().describe('Maximum candidates to return (default: 20)').default(20),
  includeDiagnostics: z.boolean().optional().describe('Include lightweight diagnostics').default(false),
});

export async function handleObserve(
  params: z.infer<typeof ObserveParamsSchema>,
  state: ServerState,
): Promise<{ candidates: ObserveCandidate[]; count: number }> {
  const input = ObserveParamsSchema.parse(params);
  const driver = requireDriver(state);
  return observeInteraction(driver, input);
}

export function registerObserveTool(server: McpServer, state: ServerState): void {
  server.tool(
    'fliwright_observe',
    'Return concise actionable Flutter candidates from the current screen snapshot.',
    ObserveParamsSchema.shape,
    async (params) => {
      const result = await handleObserve(params, state);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
