import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerState } from '../state.js';
import type { RunResult } from '../types.js';

export const RunTestParamsSchema = z.object({
  testFile: z.string().describe('Path to the .test.ts file to run'),
  vmServiceUrl: z.string().optional().describe('Dart VM Service WebSocket URL'),
  testName: z.string().optional().describe('Run only the test matching this name'),
});

export async function handleRunTest(
  params: z.infer<typeof RunTestParamsSchema>,
  state: ServerState,
): Promise<RunResult> {
  const vmUrl = params.vmServiceUrl ?? process.env.FLIWRIGHT_VM_URL;
  if (!vmUrl) {
    throw new Error('No VM Service URL provided. Pass vmServiceUrl parameter or set FLIWRIGHT_VM_URL env var.');
  }

  state.setVmServiceUrl(vmUrl);

  // For MVP, return a placeholder result. Actual Vitest integration
  // will be added when connecting to a real VM Service.
  const result: RunResult = {
    passed: false,
    totalTests: 0,
    passedTests: 0,
    failedTests: 0,
    duration: 0,
    results: [],
  };

  state.setLastRunResult(result);
  return result;
}

export function registerRunTestTool(server: McpServer, state: ServerState): void {
  server.tool(
    'fliwright_run',
    'Run a Fliwright test file and return pass/fail results',
    RunTestParamsSchema.shape,
    async (params) => {
      const result = await handleRunTest(params, state);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
