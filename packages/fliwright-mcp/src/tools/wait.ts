import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { waitInteraction } from '@fliwright/cli/capabilities/interaction';
import type { ServerState } from '../state.js';
import { requireDriver } from './screenshot.js';

export const WaitParamsSchema = z.object({
  ref: z.string().optional().describe('Snapshot ref to wait for'),
  key: z.string().optional().describe('Widget key to wait for'),
  text: z.string().optional().describe('Visible text to wait for'),
  type: z.string().optional().describe('Widget type to wait for'),
  timeout: z.number().optional().describe('Timeout in milliseconds (default: 5000)').default(5000),
}).refine(
  (data) => data.ref || data.key || data.text || data.type,
  { message: 'At least one of ref, key, text, or type must be provided' },
);

export async function handleWait(
  params: z.infer<typeof WaitParamsSchema>,
  state: ServerState,
): Promise<{ found: boolean }> {
  const input = WaitParamsSchema.parse(params);
  const driver = requireDriver(state);
  return waitInteraction(driver, input);
}

const WaitInputSchema = z.object({
  ref: z.string().optional().describe('Snapshot ref to wait for'),
  key: z.string().optional().describe('Widget key to wait for'),
  text: z.string().optional().describe('Visible text to wait for'),
  type: z.string().optional().describe('Widget type to wait for'),
  timeout: z.number().optional().describe('Timeout in milliseconds (default: 5000)').default(5000),
});

export function registerWaitTool(server: McpServer, state: ServerState): void {
  server.tool(
    'fliwright_wait',
    'Wait for a widget to appear on the Flutter app screen. Prefer a ref from fliwright_snap, or identify by key, text, or type.',
    WaitInputSchema.shape,
    async (params) => {
      const result = await handleWait(params, state);
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      };
    },
  );
}
