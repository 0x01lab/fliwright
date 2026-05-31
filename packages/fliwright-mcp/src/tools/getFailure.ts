import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerState } from '../state.js';
import type { GetFailureResult } from '../types.js';

const GetFailureParamsSchema = z.object({
  testName: z.string().optional().describe('Filter to a specific test name'),
});

export function handleGetFailure(
  params: { testName?: string },
  state: ServerState,
): GetFailureResult {
  const failures = state.getFailuresByTestName(params.testName);
  return { failures };
}

export function registerGetFailureTool(server: McpServer, state: ServerState): void {
  server.tool(
    'fliwright_get_failure',
    'Get detailed failure context from the most recent test run, including Widget tree, source location, and self-healing suggestions',
    GetFailureParamsSchema.shape,
    async (params) => {
      const result = handleGetFailure(params, state);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
