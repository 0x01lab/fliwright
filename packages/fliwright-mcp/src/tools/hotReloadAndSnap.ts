import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  hotReloadAndSnapInteraction,
  type InteractionDriver,
} from '@fliwright/cli/capabilities/interaction';
import type { FliwrightDriver } from '@fliwright/core';
import type { ServerState } from '../state.js';
import { requireDriver } from './screenshot.js';

interface ToolException {
  kind: 'reload' | 'snapshot' | 'screenshot';
  message: string;
}

export interface HotReloadAndSnapResult {
  reloaded: boolean;
  durationMs: number;
  reloadResult?: unknown;
  snapshot?: unknown;
  screenshot?: string;
  exceptions: ToolException[];
}

export const HotReloadAndSnapParamsSchema = z.object({
  depth: z.number().optional().describe('Max traversal depth for the post-reload snapshot'),
  includeRects: z.boolean().optional().describe('Include widget rects in snapshot refs (default: true)'),
  includeProperties: z.boolean().optional().describe('Include widget properties in snapshot refs (default: false)'),
  includeScreenshot: z.boolean().optional().default(false)
    .describe('Include screenshot bytes as base64 text. Default false to keep agent context compact; prefer fliwright_screenshot for visual inspection.'),
  pixelRatio: z.number().optional().describe('Screenshot pixel ratio when includeScreenshot is true (default: 1.0)').default(1.0),
});

export async function handleHotReloadAndSnap(
  params: z.infer<typeof HotReloadAndSnapParamsSchema>,
  state: ServerState,
): Promise<HotReloadAndSnapResult> {
  const input = HotReloadAndSnapParamsSchema.parse(params);
  const driver = requireDriver(state);
  const interactionDriver = input.includeScreenshot ? driver : withoutScreenshot(driver);
  return hotReloadAndSnapInteraction(interactionDriver, input);
}

function withoutScreenshot(driver: FliwrightDriver): InteractionDriver {
  return {
    sendRequest: async (method, params) => {
      if (!driver.sendRequest) throw new Error('Connected driver does not support VM Service requests');
      return driver.sendRequest(method, params);
    },
    reloadSources: driver.reloadSources?.bind(driver),
    page: {
      snapshot: driver.page.snapshot.bind(driver.page),
      screenshot: undefined,
    },
  };
}

export function registerHotReloadAndSnapTool(
  server: McpServer,
  state: ServerState,
): void {
  server.tool(
    'fliwright_hot_reload_and_snap',
    'Hot reload the connected Flutter app, then return a semantic snapshot. Screenshot bytes are omitted by default to keep agent context compact; use fliwright_screenshot for visual inspection or includeScreenshot only when base64 text is required.',
    HotReloadAndSnapParamsSchema.shape,
    async (params) => {
      const result = await handleHotReloadAndSnap(params, state);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
