import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerState } from '../state.js';
import { ensureConnected, type ConnectOptions } from './connect.js';

export const ScreenshotParamsSchema = z.object({
  pixelRatio: z.number().optional().describe('Device pixel ratio (default: 1.0)').default(1.0),
});

function requireDriver(state: ServerState) {
  const driver = state.getDriver();
  if (!driver) {
    throw new Error('Not connected. Call fliwright_connect first.');
  }
  return driver;
}

export async function handleScreenshot(
  params: z.infer<typeof ScreenshotParamsSchema>,
  state: ServerState,
  options: ConnectOptions = {},
): Promise<{ success: boolean; base64: string; width?: number; height?: number }> {
  const input = ScreenshotParamsSchema.parse(params);
  const driver = await ensureConnected(state, options);
  const buffer = await driver.page.screenshot({ pixelRatio: input.pixelRatio });
  const base64 = buffer.toString('base64');
  return { success: true, base64 };
}

export function registerScreenshotTool(server: McpServer, state: ServerState): void {
  server.tool(
    'fliwright_screenshot',
    'Take a screenshot of the current running Flutter app for visual inspection. Call this directly: it uses the current MCP connection or auto-connects from MCP VM Service state, FLIWRIGHT_VM_URL/FLIWRIGHT_VM_SERVICE_URL, or .fliwright/config.json. It returns MCP image content only and never chooses or writes an output file; if persistence is needed, the host coding agent decides where to save it.',
    ScreenshotParamsSchema.shape,
    async (params) => {
      const result = await handleScreenshot(params, state);
      return {
        content: [
          {
            type: 'image' as const,
            data: result.base64,
            mimeType: 'image/png',
          },
        ],
      };
    },
  );
}

// Export for reuse by other tools
export { requireDriver };
