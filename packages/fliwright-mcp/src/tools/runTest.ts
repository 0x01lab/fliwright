import { z } from 'zod';
import { runCommand } from '@fliwright/cli/run';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerState } from '../state.js';
import type { FailureEntry, RunResult } from '../types.js';

export const RunTestParamsSchema = z.object({
  testFile: z.string().describe('Path to the .test.ts file to run'),
  vmServiceUrl: z.string().optional().describe('Dart VM Service WebSocket URL'),
  testName: z.string().optional().describe('Run only the test matching this name'),
  cwd: z.string().optional().describe('Working directory to run Vitest from; defaults to the MCP server process cwd'),
  timeout: z.number().optional().describe('Per-test timeout in milliseconds'),
  screenshot: z.enum(['file', 'base64', 'off']).optional().describe('Screenshot mode for failure artifacts'),
  output: z.string().optional().describe('Optional JSON report output path'),
});

export async function handleRunTest(
  params: z.infer<typeof RunTestParamsSchema>,
  state: ServerState,
  runner: TestRunner = runVitest,
): Promise<RunResult> {
  const vmUrl = params.vmServiceUrl ?? process.env.FLIWRIGHT_VM_URL;
  if (!vmUrl) {
    throw new Error('No VM Service URL provided. Pass vmServiceUrl parameter or set FLIWRIGHT_VM_URL env var.');
  }

  state.setVmServiceUrl(vmUrl);

  const runnerResult = await runner({
    testFile: params.testFile,
    testName: params.testName,
    vmServiceUrl: vmUrl,
    cwd: params.cwd,
    timeout: params.timeout,
    screenshot: params.screenshot,
    output: params.output,
  });

  state.setLastRunResult(runnerResult);
  state.setLastFailures(runnerResult.failures ?? createFailureEntries(runnerResult));
  return runnerResult;
}

export interface TestRunnerParams {
  testFile: string;
  testName?: string;
  vmServiceUrl: string;
  cwd?: string;
  timeout?: number;
  screenshot?: 'file' | 'base64' | 'off';
  output?: string;
}

export type TestRunnerResult = RunResult;

export type TestRunner = (params: TestRunnerParams) => Promise<TestRunnerResult>;

export async function runVitest(params: TestRunnerParams): Promise<TestRunnerResult> {
  return runCommand({
    testPattern: params.testFile,
    testName: params.testName,
    vmUrl: params.vmServiceUrl,
    cwd: params.cwd,
    timeout: params.timeout,
    screenshot: params.screenshot,
    output: params.output,
    reporter: 'ai-json',
    print: false,
  }, {
    resolveVmUrl: async () => params.vmServiceUrl,
  });
}

function createFailureEntries(result: RunResult): FailureEntry[] {
  return result.results
    .filter((testResult) => !testResult.passed)
    .map((testResult) => ({
      testName: testResult.name,
      assertion: parseAssertion(testResult.error),
      widgetTree: {},
      source: parseSource(testResult.error),
      timestamp: new Date().toISOString(),
    }));
}

function parseAssertion(error: string | undefined): FailureEntry['assertion'] {
  const message = error ?? '';
  const assertionMatch = message.match(/AssertionError:\s+(\w+)\s+failed[^:]*:\s+expected\s+([^,]+),\s+got\s+([^\n]+)/);
  if (assertionMatch) {
    return {
      matcher: assertionMatch[1],
      expected: assertionMatch[2],
      actual: assertionMatch[3],
      timeout: 5000,
    };
  }

  return {
    matcher: 'unknown',
    expected: 'pass',
    actual: message || 'failed',
    timeout: 5000,
  };
}

function parseSource(error: string | undefined): FailureEntry['source'] {
  const message = error ?? '';
  const stackMatch = message.match(/\(([^)]+):(\d+):\d+\)/) ?? message.match(/\s+at\s+([^()\s]+):(\d+):\d+/);
  if (stackMatch) {
    return {
      file: stackMatch[1],
      line: Number.parseInt(stackMatch[2], 10),
      snippet: firstLine(message),
    };
  }

  return {
    file: '<unknown>',
    line: 0,
    snippet: firstLine(message),
  };
}

function firstLine(value: string): string {
  return value.split('\n').find((line) => line.trim().length > 0)?.trim() ?? '';
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
