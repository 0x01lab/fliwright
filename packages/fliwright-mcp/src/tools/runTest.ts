import { z } from 'zod';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerState } from '../state.js';
import type { FailureEntry, RunResult } from '../types.js';

const require = createRequire(import.meta.url);

export const RunTestParamsSchema = z.object({
  testFile: z.string().describe('Path to the .test.ts file to run'),
  vmServiceUrl: z.string().optional().describe('Dart VM Service WebSocket URL'),
  testName: z.string().optional().describe('Run only the test matching this name'),
  cwd: z.string().optional().describe('Working directory to run Vitest from; defaults to the MCP server process cwd'),
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
  });
  const { failures, ...result } = runnerResult;

  state.setLastRunResult(result);
  state.setLastFailures(failures ?? createFailureEntries(result));
  return result;
}

export interface TestRunnerParams {
  testFile: string;
  testName?: string;
  vmServiceUrl: string;
  cwd?: string;
}

export interface TestRunnerResult extends RunResult {
  failures?: FailureEntry[];
}

export type TestRunner = (params: TestRunnerParams) => Promise<TestRunnerResult>;

interface VitestJsonReport {
  success?: boolean;
  numTotalTests?: number;
  numPassedTests?: number;
  numFailedTests?: number;
  startTime?: number;
  testResults?: Array<{
    assertionResults?: Array<{
      fullName?: string;
      title?: string;
      status?: string;
      duration?: number | null;
      failureMessages?: string[];
    }>;
  }>;
}

export async function runVitest(params: TestRunnerParams): Promise<TestRunnerResult> {
  const vitestCli = require.resolve('vitest/vitest.mjs');
  const failureContextPath = await createFailureContextPath();
  const args = [vitestCli, 'run', params.testFile, '--reporter=json'];
  if (params.testName) {
    args.push('--testNamePattern', params.testName);
  }

  try {
    const { stdout, stderr } = await runNode(args, {
      ...process.env,
      FLIWRIGHT_VM_URL: params.vmServiceUrl,
      FLIWRIGHT_MCP_FAILURE_CONTEXT_PATH: failureContextPath,
    }, params.cwd ?? process.cwd());

    const report = parseVitestJson(stdout);
    if (!report) {
      throw new Error(`Unable to parse Vitest JSON output: ${stderr || stdout}`);
    }

    const failures = await readFailureContext(failureContextPath);
    return {
      ...mapVitestReport(report),
      ...(failures.length > 0 ? { failures } : {}),
    };
  } finally {
    await rm(dirname(failureContextPath), { recursive: true, force: true });
  }
}

async function createFailureContextPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'fliwright-mcp-failures-'));
  return join(dir, 'failures.json');
}

async function readFailureContext(path: string): Promise<FailureEntry[]> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as FailureEntry[];
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
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

function runNode(args: string[], env: NodeJS.ProcessEnv, cwd: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', () => resolvePromise({ stdout, stderr }));
  });
}

function parseVitestJson(output: string): VitestJsonReport | null {
  const trimmed = output.trim();
  if (!trimmed) return null;
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(trimmed.slice(start, end + 1)) as VitestJsonReport;
  } catch {
    return null;
  }
}

function mapVitestReport(report: VitestJsonReport): RunResult {
  const results = (report.testResults ?? []).flatMap((fileResult) =>
    (fileResult.assertionResults ?? []).map((assertion) => {
      const passed = assertion.status === 'passed';
      return {
        name: assertion.fullName ?? assertion.title ?? '<unknown>',
        passed,
        duration: assertion.duration ?? 0,
        ...(passed ? {} : { error: (assertion.failureMessages ?? []).join('\n') }),
      };
    }),
  );

  const duration = report.startTime ? Math.max(0, Date.now() - report.startTime) : 0;
  return {
    passed: report.success === true,
    totalTests: report.numTotalTests ?? results.length,
    passedTests: report.numPassedTests ?? results.filter((result) => result.passed).length,
    failedTests: report.numFailedTests ?? results.filter((result) => !result.passed).length,
    duration,
    results,
  };
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
