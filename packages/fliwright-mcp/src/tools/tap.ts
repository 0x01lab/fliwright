import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { tapInteraction, type SnapshotResult } from '@fliwright/cli/capabilities/interaction';
import type { ServerState } from '../state.js';
import { requireDriver } from './screenshot.js';

export const TapParamsSchema = z.object({
  ref: z.string().optional().describe('Snapshot ref from fliwright_snap, e.g. "e7"'),
  key: z.string().optional().describe('Widget key, e.g. "avatarButton"'),
  text: z.string().optional().describe('Visible text to match, e.g. "Sign in"'),
  type: z.string().optional().describe('Widget type name, e.g. "ElevatedButton"'),
  includeSnapshot: z.boolean().optional().describe('Return a post-action snapshot'),
}).refine(
  (data) => data.ref || data.key || data.text || data.type,
  { message: 'At least one of ref, key, text, or type must be provided' },
);

export async function handleTap(
  params: z.infer<typeof TapParamsSchema>,
  state: ServerState,
): Promise<{ success: boolean; snapshot?: SnapshotResult }> {
  const input = TapParamsSchema.parse(params);
  const driver = requireDriver(state);
  return tapInteraction(driver, input);
}

const TapInputSchema = z.object({
  ref: z.string().optional().describe('Snapshot ref from fliwright_snap, e.g. "e7"'),
  key: z.string().optional().describe('Widget key, e.g. "avatarButton"'),
  text: z.string().optional().describe('Visible text to match, e.g. "Sign in"'),
  type: z.string().optional().describe('Widget type name, e.g. "ElevatedButton"'),
  includeSnapshot: z.boolean().optional().describe('Return a post-action snapshot'),
});

export function registerTapTool(server: McpServer, state: ServerState): void {
  server.tool(
    'fliwright_tap',
    'Tap (click) a widget on the Flutter app screen. Prefer a ref from fliwright_snap, or identify by key, visible text, or type name.',
    TapInputSchema.shape,
    async (params) => {
      const result = await handleTap(params, state);
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      };
    },
  );
}
