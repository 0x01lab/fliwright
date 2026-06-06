import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerState } from '../state.js';
import { requireDriver } from './screenshot.js';

export const TypeParamsSchema = z.object({
  key: z.string().optional().describe('Widget key, e.g. "usernameField"'),
  text: z.string().optional().describe('Visible text/hint to match the input field'),
  type: z.string().optional().describe('Widget type, e.g. "EditableText"'),
  value: z.string().describe('Text to type into the field'),
  replace: z.boolean().optional().describe('If true, clears existing text first (default: true)').default(true),
}).refine(
  (data) => data.key || data.text || data.type,
  { message: 'At least one of key, text, or type must be provided' },
);

export async function handleType(
  params: z.infer<typeof TypeParamsSchema>,
  state: ServerState,
): Promise<{ success: boolean; filled: string }> {
  const driver = requireDriver(state);
  const page = driver.page;

  let locator;
  if (params.key) {
    locator = page.getByKey(params.key);
  } else if (params.text) {
    locator = page.getByText(params.text);
  } else if (params.type) {
    locator = page.getByType(params.type);
  } else {
    throw new Error('At least one of key, text, or type must be provided');
  }

  if (params.replace) {
    await locator.fill(params.value);
  } else {
    await locator.type(params.value);
  }

  return { success: true, filled: params.value };
}

const TypeInputSchema = z.object({
  key: z.string().optional().describe('Widget key, e.g. "usernameField"'),
  text: z.string().optional().describe('Visible text/hint to match the input field'),
  type: z.string().optional().describe('Widget type, e.g. "EditableText"'),
  value: z.string().describe('Text to type into the field'),
  replace: z.boolean().optional().describe('If true, clears existing text first (default: true)').default(true),
});

export function registerTypeTool(server: McpServer, state: ServerState): void {
  server.tool(
    'fliwright_type',
    'Type text into a text field on the Flutter app. Identify the field by key, text, or type. By default replaces existing content.',
    TypeInputSchema.shape,
    async (params) => {
      const result = await handleType(params, state);
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      };
    },
  );
}
