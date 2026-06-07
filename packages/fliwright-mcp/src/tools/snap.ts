import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { snapInteraction, type SnapshotResult } from '@fliwright/cli/capabilities/interaction';
import type { ServerState } from '../state.js';
import { requireDriver } from './screenshot.js';

export const SnapParamsSchema = z.object({
  depth: z.number().optional().describe('Max traversal depth for the agent snapshot'),
  includeRects: z.boolean().optional().describe('Include widget rects in refs (default: true)'),
  includeProperties: z.boolean().optional().describe('Include widget properties in refs (default: false)'),
});

export async function handleSnap(
  params: z.infer<typeof SnapParamsSchema>,
  state: ServerState,
): Promise<SnapshotResult> {
  const input = SnapParamsSchema.parse(params);
  const driver = requireDriver(state);
  return snapInteraction(driver, {
    depth: input.depth,
    includeRects: input.includeRects,
    includeProperties: input.includeProperties,
  });
}

export function registerSnapTool(server: McpServer, state: ServerState): void {
  server.tool(
    'fliwright_snap',
    'Capture an agent-readable Flutter snapshot with stable ref tokens for follow-up actions.',
    SnapParamsSchema.shape,
    async (params) => {
      const result = await handleSnap(params, state);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
