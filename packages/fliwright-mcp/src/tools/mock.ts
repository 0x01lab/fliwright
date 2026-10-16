import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerState } from '../state.js';
import {
  handleMockClearCalls,
  handleMockList,
  handleMockStatus,
  handleMockSwitch,
} from './mockTools.js';

export const MockParamsSchema = z.object({
  operation: z.enum(['list', 'status', 'apply', 'clearCalls']).describe('Mock-management operation'),
  mockDir: z.string().optional(),
  endpoint: z.string().optional(),
  method: z.string().optional(),
  ruleName: z.string().optional(),
  includeRoutes: z.boolean().optional(),
  includeCalls: z.boolean().optional(),
  recentCallsLimit: z.number().int().positive().optional(),
});

export async function handleMock(
  params: z.infer<typeof MockParamsSchema>,
  state: ServerState,
): Promise<unknown> {
  const input = MockParamsSchema.parse(params);
  switch (input.operation) {
    case 'list':
      return handleMockList({ mockDir: input.mockDir }, state);
    case 'status':
      return handleMockStatus({
        mockDir: input.mockDir,
        endpoint: input.endpoint,
        method: input.method,
        includeRoutes: input.includeRoutes ?? true,
        includeCalls: input.includeCalls ?? true,
        recentCallsLimit: input.recentCallsLimit ?? 20,
      }, state);
    case 'apply':
      return handleMockSwitch({
        mockDir: input.mockDir,
        endpoint: requireText(input.endpoint, 'mock apply requires endpoint'),
        method: input.method,
        ruleName: requireText(input.ruleName, 'mock apply requires ruleName'),
      }, state);
    case 'clearCalls':
      return handleMockClearCalls({ endpoint: input.endpoint }, state);
  }
}

export function registerMockTool(server: McpServer, state: ServerState): void {
  server.tool(
    'fliwright_mock',
    'List, inspect, apply, or clear deterministic Flutter HTTP mock rules.',
    MockParamsSchema.shape,
    async (params) => ({
      content: [{ type: 'text', text: JSON.stringify(await handleMock(params, state), null, 2) }],
    }),
  );
}

function requireText(value: string | undefined, message: string): string {
  if (!value) throw new Error(message);
  return value;
}
