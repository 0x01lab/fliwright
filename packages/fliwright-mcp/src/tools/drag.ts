import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerState } from '../state.js';
import { requireDriver } from './screenshot.js';

export const DragParamsSchema = z.object({
  x: z.number().describe('Start X coordinate (logical pixels)'),
  y: z.number().describe('Start Y coordinate (logical pixels)'),
  deltaX: z.number().describe('Horizontal drag distance in pixels (positive = right)'),
  deltaY: z.number().describe('Vertical drag distance in pixels (positive = down)'),
  steps: z.number().optional().describe('Number of interpolation steps for smooth motion (default: 20)').default(20),
});

export async function handleDrag(
  params: z.infer<typeof DragParamsSchema>,
  state: ServerState,
): Promise<{ success: boolean }> {
  const input = DragParamsSchema.parse(params);
  const driver = requireDriver(state);
  await driver.page.dragFrom(input.x, input.y, input.deltaX, input.deltaY, { steps: input.steps });
  return { success: true };
}

export function registerDragTool(server: McpServer, state: ServerState): void {
  server.tool(
    'fliwright_drag',
    'Perform a drag gesture from an arbitrary screen coordinate. Use this for captcha sliders, pull-to-refresh, or other coordinate-based drag operations.',
    DragParamsSchema.shape,
    async (params) => {
      const result = await handleDrag(params, state);
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      };
    },
  );
}
