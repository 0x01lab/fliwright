import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { actionInteraction, type ActionName, type SnapshotResult } from '@fliwright/cli/capabilities/interaction';
import type { ServerState } from '../state.js';
import { requireDriver } from './screenshot.js';

const ActionNameSchema = z.enum([
  'doubleClick',
  'tripleClick',
  'rightClick',
  'hover',
  'focus',
  'blur',
  'clear',
  'pressKey',
  'setCheckbox',
  'selectOption',
  'dismissModal',
  'waitForNetworkIdle',
]);

export const ActionParamsSchema = z.object({
  action: ActionNameSchema.describe('Action to perform'),
  ref: z.string().optional().describe('Snapshot ref from fliwright_snap, e.g. "e7"'),
  key: z.string().optional().describe('Widget key fallback'),
  text: z.string().optional().describe('Visible text fallback'),
  type: z.string().optional().describe('Widget type fallback'),
  keyboardKey: z.string().optional().describe('Keyboard key for pressKey, e.g. "Backspace"'),
  checked: z.boolean().optional().describe('Expected state for setCheckbox'),
  value: z.union([z.string(), z.number()]).optional().describe('Value/label for selectOption'),
  quietMs: z.number().optional().describe('Quiet period for waitForNetworkIdle'),
  timeout: z.number().optional().describe('Timeout in milliseconds'),
  includeSnapshot: z.boolean().optional().describe('Return a post-action snapshot'),
}).refine(
  (data) => (
    data.action === 'dismissModal' ||
    data.action === 'waitForNetworkIdle' ||
    data.ref ||
    data.key ||
    data.text ||
    data.type
  ),
  { message: 'At least one of ref, key, text, or type must be provided' },
).refine(
  (data) => data.action !== 'pressKey' || !!data.keyboardKey,
  { message: 'pressKey requires keyboardKey' },
).refine(
  (data) => data.action !== 'setCheckbox' || data.checked != null,
  { message: 'setCheckbox requires checked' },
).refine(
  (data) => data.action !== 'selectOption' || data.value != null,
  { message: 'selectOption requires value' },
);

const ActionInputSchema = z.object({
  action: ActionNameSchema.describe('Action to perform'),
  ref: z.string().optional().describe('Snapshot ref from fliwright_snap, e.g. "e7"'),
  key: z.string().optional().describe('Widget key fallback'),
  text: z.string().optional().describe('Visible text fallback'),
  type: z.string().optional().describe('Widget type fallback'),
  keyboardKey: z.string().optional().describe('Keyboard key for pressKey, e.g. "Backspace"'),
  checked: z.boolean().optional().describe('Expected state for setCheckbox'),
  value: z.union([z.string(), z.number()]).optional().describe('Value/label for selectOption'),
  quietMs: z.number().optional().describe('Quiet period for waitForNetworkIdle'),
  timeout: z.number().optional().describe('Timeout in milliseconds'),
  includeSnapshot: z.boolean().optional().describe('Return a post-action snapshot'),
});

export async function handleAction(
  params: z.infer<typeof ActionParamsSchema>,
  state: ServerState,
): Promise<{ success: boolean; action: ActionName; snapshot?: SnapshotResult }> {
  const input = ActionParamsSchema.parse(params);
  const driver = requireDriver(state);
  return actionInteraction(driver, input);
}

export function registerActionTool(server: McpServer, state: ServerState): void {
  server.tool(
    'fliwright_action',
    'Perform an extended Flutter action. Prefer ref targets from fliwright_snap.',
    ActionInputSchema.shape,
    async (params: z.infer<typeof ActionInputSchema>) => {
      const result = await handleAction(params, state);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
