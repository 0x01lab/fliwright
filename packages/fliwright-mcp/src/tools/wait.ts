import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerState } from '../state.js';
import { requireDriver } from './screenshot.js';

export const WaitParamsSchema = z.object({
  key: z.string().optional().describe('Widget key to wait for'),
  text: z.string().optional().describe('Visible text to wait for'),
  type: z.string().optional().describe('Widget type to wait for'),
  timeout: z.number().optional().describe('Timeout in milliseconds (default: 5000)').default(5000),
}).refine(
  (data) => data.key || data.text || data.type,
  { message: 'At least one of key, text, or type must be provided' },
);

export async function handleWait(
  params: z.infer<typeof WaitParamsSchema>,
  state: ServerState,
): Promise<{ found: boolean }> {
  const driver = requireDriver(state);
  const page = driver.page;

  let selector: Record<string, unknown>;
  if (params.key) {
    selector = { key: params.key };
  } else if (params.text) {
    selector = { text: params.text };
  } else if (params.type) {
    selector = { type: params.type };
  } else {
    throw new Error('At least one of key, text, or type must be provided');
  }

  await page.waitFor(selector, params.timeout);
  return { found: true };
}

const WaitInputSchema = z.object({
  key: z.string().optional().describe('Widget key to wait for'),
  text: z.string().optional().describe('Visible text to wait for'),
  type: z.string().optional().describe('Widget type to wait for'),
  timeout: z.number().optional().describe('Timeout in milliseconds (default: 5000)').default(5000),
});

export function registerWaitTool(server: McpServer, state: ServerState): void {
  server.tool(
    'fliwright_wait',
    'Wait for a widget to appear on the Flutter app screen. Polls until the widget is found or timeout expires.',
    WaitInputSchema.shape,
    async (params) => {
      const result = await handleWait(params, state);
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      };
    },
  );
}
