import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { findInteraction, type SnapshotRef } from '@fliwright/cli/capabilities/interaction';
import type { ServerState } from '../state.js';
import { requireDriver } from './screenshot.js';

const FindInputSchema = z.object({
  text: z.string().optional().describe('Exact visible label/text to match'),
  containsText: z.string().optional().describe('Substring of visible label/text to match'),
  key: z.string().optional().describe('Widget key to match'),
  semanticsLabel: z.string().optional().describe('Exact semantics label to match'),
  role: z.string().optional().describe('Role to match, e.g. button or textbox'),
  type: z.string().optional().describe('Flutter widget type to match'),
});

export const FindParamsSchema = FindInputSchema.refine(
  (data) => data.text || data.containsText || data.key || data.semanticsLabel || data.role || data.type,
  { message: 'At least one find predicate must be provided' },
);

export async function handleFind(
  params: z.infer<typeof FindParamsSchema>,
  state: ServerState,
): Promise<{ matches: SnapshotRef[]; count: number }> {
  const input = FindParamsSchema.parse(params);
  const driver = requireDriver(state);
  return findInteraction(driver, input);
}

export function registerFindTool(server: McpServer, state: ServerState): void {
  server.tool(
    'fliwright_find',
    'Find actionable Flutter snapshot refs by text, key, role, semantics label, or widget type.',
    FindInputSchema.shape,
    async (params: z.infer<typeof FindInputSchema>) => {
      const result = await handleFind(params, state);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
