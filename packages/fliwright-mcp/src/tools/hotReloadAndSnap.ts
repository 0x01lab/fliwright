import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { hotReloadAndSnapInteraction } from '@fliwright/cli/capabilities/interaction';
import type { ServerState } from '../state.js';
import { requireDriver } from './screenshot.js';

interface ToolException {
  kind: 'reload' | 'snapshot' | 'screenshot';
  message: string;
}

export interface HotReloadAndSnapResult {
  reloaded: boolean;
  durationMs: number;
  reloadResult?: unknown;
  snapshot?: unknown;
  screenshot?: string;
  exceptions: ToolException[];
}

export const HotReloadAndSnapParamsSchema = z.object({
  depth: z.number().optional().describe('Max traversal depth for the post-reload snapshot'),
  includeRects: z.boolean().optional().describe('Include widget rects in snapshot refs (default: true)'),
  includeProperties: z.boolean().optional().describe('Include widget properties in snapshot refs (default: false)'),
  pixelRatio: z.number().optional().describe('Screenshot pixel ratio (default: 1.0)').default(1.0),
});

export async function handleHotReloadAndSnap(
  params: z.infer<typeof HotReloadAndSnapParamsSchema>,
  state: ServerState,
): Promise<HotReloadAndSnapResult> {
  const input = HotReloadAndSnapParamsSchema.parse(params);
  const driver = requireDriver(state);
  return hotReloadAndSnapInteraction(driver, input);
}

export function registerHotReloadAndSnapTool(
  server: McpServer,
  state: ServerState,
): void {
  server.tool(
    'fliwright_hot_reload_and_snap',
    'Hot reload the connected Flutter app, then return a semantic snapshot and screenshot for verification.',
    HotReloadAndSnapParamsSchema.shape,
    async (params) => {
      const result = await handleHotReloadAndSnap(params, state);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
