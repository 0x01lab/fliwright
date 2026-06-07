import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  diagnosticsInteraction,
  type DiagnosticEvent,
} from '@fliwright/cli/capabilities/interaction';
import type { ServerState } from '../state.js';
import { requireDriver } from './screenshot.js';

export const DiagnosticsParamsSchema = z.object({
  listen: z.boolean().optional().describe('Subscribe to VM Service diagnostic streams before reading events'),
  clear: z.boolean().optional().describe('Clear buffered diagnostic events before reading'),
  limit: z.number().optional().describe('Maximum buffered events to return'),
  kinds: z.array(z.string()).optional().describe('Event kinds to include, e.g. Flutter.Error'),
  streams: z.array(z.string()).optional().describe('VM Service streams to listen to or filter, e.g. Logging'),
});

export interface DiagnosticsResult {
  listening: boolean;
  cleared: boolean;
  events: DiagnosticEvent[];
  count: number;
}

export async function handleDiagnostics(
  params: z.infer<typeof DiagnosticsParamsSchema>,
  state: ServerState,
): Promise<DiagnosticsResult> {
  const input = DiagnosticsParamsSchema.parse(params);
  const driver = requireDriver(state);
  return diagnosticsInteraction(driver, input);
}

export function registerDiagnosticsTool(server: McpServer, state: ServerState): void {
  server.tool(
    'fliwright_diagnostics',
    'Read buffered Flutter VM Service diagnostics, optionally subscribing to streams or clearing the buffer.',
    DiagnosticsParamsSchema.shape,
    async (params) => {
      const result = await handleDiagnostics(params, state);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
