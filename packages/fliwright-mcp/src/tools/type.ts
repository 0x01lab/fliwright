import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { typeInteraction, type SnapshotResult } from '@fliwright/cli/capabilities/interaction';
import type { ServerState } from '../state.js';
import { requireDriver } from './screenshot.js';

export const TypeParamsSchema = z.object({
  ref: z.string().optional().describe('Snapshot ref from fliwright_snap, e.g. "e8"'),
  key: z.string().optional().describe('Widget key, e.g. "usernameField"'),
  text: z.string().optional().describe('Visible text/hint to match the input field'),
  type: z.string().optional().describe('Widget type, e.g. "EditableText"'),
  value: z.string().describe('Text to type into the field'),
  replace: z.boolean().optional().describe('If true, clears existing text first (default: true)').default(true),
  includeSnapshot: z.boolean().optional().describe('Return a post-action snapshot'),
}).refine(
  (data) => data.ref || data.key || data.text || data.type,
  { message: 'At least one of ref, key, text, or type must be provided' },
);

export async function handleType(
  params: z.infer<typeof TypeParamsSchema>,
  state: ServerState,
): Promise<{ success: boolean; filled: string; snapshot?: SnapshotResult }> {
  const input = TypeParamsSchema.parse(params);
  const driver = requireDriver(state);
  return typeInteraction(driver, input);
}

const TypeInputSchema = z.object({
  ref: z.string().optional().describe('Snapshot ref from fliwright_snap, e.g. "e8"'),
  key: z.string().optional().describe('Widget key, e.g. "usernameField"'),
  text: z.string().optional().describe('Visible text/hint to match the input field'),
  type: z.string().optional().describe('Widget type, e.g. "EditableText"'),
  value: z.string().describe('Text to type into the field'),
  replace: z.boolean().optional().describe('If true, clears existing text first (default: true)').default(true),
  includeSnapshot: z.boolean().optional().describe('Return a post-action snapshot'),
});

export function registerTypeTool(server: McpServer, state: ServerState): void {
  server.tool(
    'fliwright_type',
    'Type text into a text field on the Flutter app. Prefer a ref from fliwright_snap, or identify the field by key, text, or type. By default replaces existing content.',
    TypeInputSchema.shape,
    async (params) => {
      const result = await handleType(params, state);
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      };
    },
  );
}
