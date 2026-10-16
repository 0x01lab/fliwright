import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerState } from '../state.js';
import { handleAction } from './action.js';
import { handleDrag } from './drag.js';
import { handleNavigate } from './navigate.js';
import { handleTap } from './tap.js';
import { handleType } from './type.js';
import { handleWait } from './wait.js';

const InteractOperationSchema = z.enum(['tap', 'type', 'navigate', 'wait', 'drag', 'action']);

export const InteractParamsSchema = z.object({
  operation: InteractOperationSchema.describe('Interaction intent to execute'),
  ref: z.string().optional().describe('Snapshot ref returned by fliwright_observe or a legacy snapshot tool'),
  key: z.string().optional().describe('Widget key fallback'),
  text: z.string().optional().describe('Visible text fallback'),
  type: z.string().optional().describe('Widget type fallback'),
  value: z.union([z.string(), z.number()]).optional().describe('Text or option value'),
  replace: z.boolean().optional().describe('Replace existing text for the type operation'),
  path: z.string().optional().describe('Route path for navigate'),
  homeRoute: z.string().optional().describe('Home route for resetToHome navigation'),
  navigationAction: z.enum(['goto', 'resetRouteStack', 'resetToHome']).optional(),
  extra: z.record(z.unknown()).optional(),
  waitUntil: z.enum(['none', 'settled']).optional(),
  waitForText: z.string().optional(),
  waitForKey: z.string().optional(),
  waitForType: z.string().optional(),
  waitForTimeout: z.number().optional(),
  settleTimeout: z.number().optional(),
  stableFrames: z.number().optional(),
  throwOnSettleTimeout: z.boolean().optional(),
  timeout: z.number().optional(),
  deltaX: z.number().optional(),
  deltaY: z.number().optional(),
  steps: z.number().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  action: z.enum([
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
  ]).optional(),
  keyboardKey: z.string().optional(),
  checked: z.boolean().optional(),
  quietMs: z.number().optional(),
  includeSnapshot: z.boolean().optional(),
});

export type InteractParams = z.infer<typeof InteractParamsSchema>;

export async function handleInteract(params: InteractParams, state: ServerState): Promise<unknown> {
  const input = InteractParamsSchema.parse(params);
  switch (input.operation) {
    case 'tap':
      return handleTap(pickTarget(input), state);
    case 'type':
      return handleType({
        ...pickTarget(input),
        value: requireString(input.value, 'type requires a string value'),
        replace: input.replace ?? true,
      }, state);
    case 'navigate':
      return handleNavigate({
        action: input.navigationAction ?? 'goto',
        path: input.path,
        homeRoute: input.homeRoute,
        extra: input.extra,
        waitUntil: input.waitUntil ?? 'settled',
        waitForText: input.waitForText,
        waitForKey: input.waitForKey,
        waitForType: input.waitForType,
        waitForTimeout: input.waitForTimeout,
        settleTimeout: input.settleTimeout,
        stableFrames: input.stableFrames,
        throwOnSettleTimeout: input.throwOnSettleTimeout ?? true,
        includeSnapshot: input.includeSnapshot,
      }, state);
    case 'wait':
      return handleWait({ ...pickTarget(input), timeout: input.timeout ?? 5000 }, state);
    case 'drag':
      return handleDrag({
        ...pickTarget(input),
        x: input.x,
        y: input.y,
        deltaX: requireNumber(input.deltaX, 'drag requires deltaX'),
        deltaY: requireNumber(input.deltaY, 'drag requires deltaY'),
        steps: input.steps ?? 20,
      }, state);
    case 'action':
      return handleAction({
        ...pickTarget(input),
        action: requireValue(input.action, 'action requires an action name'),
        keyboardKey: input.keyboardKey,
        checked: input.checked,
        value: input.value,
        deltaX: input.deltaX,
        deltaY: input.deltaY,
        steps: input.steps,
        x: input.x,
        y: input.y,
        quietMs: input.quietMs,
        timeout: input.timeout,
      }, state);
  }
}

export function registerInteractTool(server: McpServer, state: ServerState): void {
  server.tool(
    'fliwright_interact',
    'Perform one Flutter interaction through an intent-level operation: tap, type, navigate, wait, drag, or action.',
    InteractParamsSchema.shape,
    async (params) => ({
      content: [{ type: 'text', text: JSON.stringify(await handleInteract(params, state), null, 2) }],
    }),
  );
}

function pickTarget(input: InteractParams) {
  return {
    ref: input.ref,
    key: input.key,
    text: input.text,
    type: input.type,
    includeSnapshot: input.includeSnapshot,
  };
}

function requireString(value: string | number | undefined, message: string): string {
  if (typeof value !== 'string') throw new Error(message);
  return value;
}

function requireNumber(value: number | undefined, message: string): number {
  if (value === undefined) throw new Error(message);
  return value;
}

function requireValue<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}
