import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerState } from '../state.js';
import { requireDriver } from './screenshot.js';

export const TapParamsSchema = z.object({
  key: z.string().optional().describe('Widget key, e.g. "avatarButton"'),
  text: z.string().optional().describe('Visible text to match, e.g. "Sign in"'),
  type: z.string().optional().describe('Widget type name, e.g. "ElevatedButton"'),
}).refine(
  (data) => data.key || data.text || data.type,
  { message: 'At least one of key, text, or type must be provided' },
);

export async function handleTap(
  params: z.infer<typeof TapParamsSchema>,
  state: ServerState,
): Promise<{ success: boolean }> {
  const driver = requireDriver(state);
  const page = driver.page;

  if (params.key) {
    await page.getByKey(params.key).click();
  } else if (params.text) {
    await page.getByText(params.text).click();
  } else if (params.type) {
    await page.getByType(params.type).click();
  }

  return { success: true };
}

const TapInputSchema = z.object({
  key: z.string().optional().describe('Widget key, e.g. "avatarButton"'),
  text: z.string().optional().describe('Visible text to match, e.g. "Sign in"'),
  type: z.string().optional().describe('Widget type name, e.g. "ElevatedButton"'),
});

export function registerTapTool(server: McpServer, state: ServerState): void {
  server.tool(
    'fliwright_tap',
    'Tap (click) a widget on the Flutter app screen. Identify the widget by its key, visible text, or type name.',
    TapInputSchema.shape,
    async (params) => {
      const result = await handleTap(params, state);
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      };
    },
  );
}
