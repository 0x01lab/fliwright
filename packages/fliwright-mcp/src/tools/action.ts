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
  'drag',
  'dismissModal',
  'dismissKeyboard',
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
  deltaX: z.number().optional().describe('Horizontal drag distance for drag (positive = right)'),
  deltaY: z.number().optional().describe('Vertical drag distance for drag (positive = down)'),
  steps: z.number().optional().describe('Number of interpolation steps for drag'),
  x: z.number().optional().describe('Start X coordinate for raw coordinate drag'),
  y: z.number().optional().describe('Start Y coordinate for raw coordinate drag'),
  quietMs: z.number().optional().describe('Quiet period for waitForNetworkIdle'),
  timeout: z.number().optional().describe('Timeout in milliseconds'),
  includeSnapshot: z.boolean().optional().describe('Return a post-action snapshot'),
}).refine(
  (data) => (
    data.action === 'dismissModal' ||
    data.action === 'dismissKeyboard' ||
    data.action === 'waitForNetworkIdle' ||
    (data.action === 'drag' && data.x != null && data.y != null) ||
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
).refine(
  (data) => data.action !== 'drag' || data.deltaX != null,
  { message: 'drag requires deltaX' },
).refine(
  (data) => data.action !== 'drag' || data.deltaY != null,
  { message: 'drag requires deltaY' },
).refine(
  (data) => data.action !== 'drag' || (data.x == null && data.y == null) || (data.x != null && data.y != null),
  { message: 'Raw coordinate drags require both x and y' },
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
  deltaX: z.number().optional().describe('Horizontal drag distance for drag (positive = right)'),
  deltaY: z.number().optional().describe('Vertical drag distance for drag (positive = down)'),
  steps: z.number().optional().describe('Number of interpolation steps for drag'),
  x: z.number().optional().describe('Start X coordinate for raw coordinate drag'),
  y: z.number().optional().describe('Start Y coordinate for raw coordinate drag'),
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
