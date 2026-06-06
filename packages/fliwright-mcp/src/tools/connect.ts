import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerState } from '../state.js';

export const ConnectParamsSchema = z.object({
  vmServiceUrl: z.string().describe(
    'Dart VM Service URL from `flutter run` output, e.g. "http://127.0.0.1:54321/xxxx/"',
  ),
});

export async function handleConnect(
  params: z.infer<typeof ConnectParamsSchema>,
  state: ServerState,
): Promise<{ connected: boolean; message: string }> {
  // Dispose previous driver if any
  const prev = state.getDriver();
  if (prev) {
    try { await prev.dispose(); } catch { /* ignore */ }
    state.setDriver(null);
  }

  const { FliwrightDriver } = await import('@fliwright/core');

  // Convert http:// → ws:// for VM Service WebSocket
  const wsUrl = params.vmServiceUrl
    .replace('http://', 'ws://')
    .replace('https://', 'wss://')
    .replace(/\/?$/, '/ws');

  const driver = new FliwrightDriver();
  await driver.connect(wsUrl);

  state.setDriver(driver);
  state.setVmServiceUrl(params.vmServiceUrl);

  return {
    connected: true,
    message: `Connected to Flutter app at ${params.vmServiceUrl}`,
  };
}

export function registerConnectTool(server: McpServer, state: ServerState): void {
  server.tool(
    'fliwright_connect',
    'Connect to a running Flutter app via Dart VM Service. Must be called before other interaction tools.',
    ConnectParamsSchema.shape,
    async (params) => {
      const result = await handleConnect(params, state);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
