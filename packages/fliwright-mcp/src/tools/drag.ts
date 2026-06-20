import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { dragInteraction, type SnapshotResult } from '@fliwright/cli/capabilities/interaction';
import type { ServerState } from '../state.js';
import { requireDriver } from './screenshot.js';

const DragInputSchema = z.object({
  ref: z.string().optional().describe('Snapshot ref from fliwright_snap, e.g. "e7"'),
  key: z.string().optional().describe('Widget key fallback'),
  text: z.string().optional().describe('Visible text fallback'),
  type: z.string().optional().describe('Widget type fallback'),
  x: z.number().optional().describe('Start X coordinate for raw coordinate drags (logical pixels)'),
  y: z.number().optional().describe('Start Y coordinate for raw coordinate drags (logical pixels)'),
  deltaX: z.number().describe('Horizontal drag distance in pixels (positive = right)'),
  deltaY: z.number().describe('Vertical drag distance in pixels (positive = down)'),
  steps: z.number().optional().describe('Number of interpolation steps for smooth motion (default: 20)').default(20),
  includeSnapshot: z.boolean().optional().describe('Return a post-action snapshot'),
});

export const DragParamsSchema = DragInputSchema.refine(
  (data) => data.ref || data.key || data.text || data.type || (data.x != null && data.y != null),
  { message: 'Provide ref, key, text, type, or both x and y' },
).refine(
  (data) => (data.x == null && data.y == null) || (data.x != null && data.y != null),
  { message: 'Raw coordinate drags require both x and y' },
);

export async function handleDrag(
  params: z.infer<typeof DragParamsSchema>,
  state: ServerState,
): Promise<{ success: boolean; action: 'drag'; snapshot?: SnapshotResult }> {
  const input = DragParamsSchema.parse(params);
  const driver = requireDriver(state);
  return dragInteraction(driver, input);
}

export function registerDragTool(server: McpServer, state: ServerState): void {
  server.tool(
    'fliwright_drag',
    'Perform a drag gesture from an arbitrary screen coordinate. Use this for captcha sliders, pull-to-refresh, or other coordinate-based drag operations.',
    DragInputSchema.shape,
    async (params: z.infer<typeof DragInputSchema>) => {
      const result = await handleDrag(params, state);
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      };
    },
  );
}
