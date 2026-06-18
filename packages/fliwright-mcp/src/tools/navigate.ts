import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { navigateInteraction, type NavigateOptions, type NavigationAction, type SnapshotResult } from '@fliwright/cli/capabilities/interaction';
import type { ServerState } from '../state.js';
import { requireDriver } from './screenshot.js';

const NavigationActionSchema = z.enum(['goto', 'resetRouteStack', 'resetToHome']);
const NavigationWaitUntilSchema = z.enum(['none', 'settled']);

const NavigateBaseParamsSchema = z.object({
  action: NavigationActionSchema.optional().default('goto')
    .describe('Navigation action: goto, resetRouteStack, or resetToHome'),
  path: z.string().optional()
    .describe('Route path. Required for goto/resetRouteStack; defaults to "/" for resetToHome'),
  homeRoute: z.string().optional()
    .describe('Home route used when action is resetToHome (default: "/")'),
  extra: z.record(z.unknown()).optional()
    .describe('JSON-serializable route extra payload for injected routers'),
  waitUntil: NavigationWaitUntilSchema.optional().default('settled')
    .describe('Whether to wait for Flutter rendering to settle after navigation'),
  settleTimeout: z.number().optional()
    .describe('Maximum settle wait in milliseconds (default: 3000)'),
  stableFrames: z.number().optional()
    .describe('Number of consecutive idle frames required by settle'),
  waitForText: z.string().optional()
    .describe('Visible text to wait for before settling'),
  waitForKey: z.string().optional()
    .describe('Widget key to wait for before settling'),
  waitForType: z.string().optional()
    .describe('Widget type to wait for before settling'),
  waitForTimeout: z.number().optional()
    .describe('Timeout for the waitFor selector in milliseconds'),
  throwOnSettleTimeout: z.boolean().optional().default(true)
    .describe('Throw if the settle step reaches its timeout'),
  includeSnapshot: z.boolean().optional()
    .describe('Return a post-navigation snapshot'),
});

export const NavigateParamsSchema = NavigateBaseParamsSchema.refine(
  (data) => data.action === 'resetToHome' || !!data.path,
  { message: 'path is required unless action is resetToHome' },
).refine(
  (data) => [data.waitForText, data.waitForKey, data.waitForType].filter(Boolean).length <= 1,
  { message: 'Only one of waitForText, waitForKey, or waitForType may be provided' },
);

export async function handleNavigate(
  params: z.infer<typeof NavigateParamsSchema>,
  state: ServerState,
): Promise<{ success: boolean; action: NavigationAction; path: string; snapshot?: SnapshotResult }> {
  const input = NavigateParamsSchema.parse(params);
  const driver = requireDriver(state);
  const options: NavigateOptions = {
    action: input.action,
    path: input.path,
    homeRoute: input.homeRoute,
    extra: input.extra,
    waitUntil: input.waitUntil,
    settleTimeout: input.settleTimeout,
    stableFrames: input.stableFrames,
    waitFor: waitForSelector(input),
    waitForTimeout: input.waitForTimeout,
    throwOnSettleTimeout: input.throwOnSettleTimeout,
    includeSnapshot: input.includeSnapshot,
  };
  return navigateInteraction(driver, options);
}

export function registerNavigateTool(server: McpServer, state: ServerState): void {
  server.tool(
    'fliwright_navigate',
    'Navigate to a Flutter route, reset the route stack, or reset to the home route. Defaults to waiting for route transition animations to settle.',
    NavigateBaseParamsSchema.shape,
    async (params) => {
      const result = await handleNavigate(params, state);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}

function waitForSelector(input: z.infer<typeof NavigateParamsSchema>): Record<string, unknown> | undefined {
  if (input.waitForText) return { text: input.waitForText };
  if (input.waitForKey) return { key: input.waitForKey };
  if (input.waitForType) return { type: input.waitForType };
  return undefined;
}
