import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerState } from '../state.js';

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
): Promise<{ success: boolean; base64: string; width?: number; height?: number }> {
  const driver = requireDriver(state);
  const buffer = await driver.page.screenshot({ pixelRatio: params.pixelRatio });
  const base64 = buffer.toString('base64');
  return { success: true, base64 };
}

export function registerScreenshotTool(server: McpServer, state: ServerState): void {
  server.tool(
    'fliwright_screenshot',
    'Take a screenshot of the connected Flutter app. Returns the screenshot as an image that you can see and analyze.',
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
