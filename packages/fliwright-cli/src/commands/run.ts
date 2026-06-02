import { ToolMockServer } from '@fliwright/core';
import { resolveVmUrl } from '../vm-discovery.js';
import { loadConfig } from '../config.js';
import { formatPretty, formatJson, formatJunit, type CliRunResult } from '../reporter.js';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);

export interface RunOptions {
  testPattern?: string;
  vmUrl?: string;
  reporter?: 'pretty' | 'json' | 'junit';
  timeout?: number;
  screenshot?: 'file' | 'base64' | 'off';
  cwd?: string;
}

export interface RunDeps {
  resolveVmUrl?: (options: { cliFlag?: string; configUrl?: string }) => Promise<string | null>;
  onVmResolved?: (url: string) => void;
}

export async function runCommand(options: RunOptions, deps: RunDeps = {}): Promise<CliRunResult> {
  const cwd = options.cwd ?? process.cwd();
  const config = await loadConfig(cwd);

  const reporter = options.reporter ?? config.reporter;
  const testPattern = options.testPattern ?? `${config.testDir}/**/*.test.ts`;

  const resolver = deps.resolveVmUrl ?? resolveVmUrl;
  const vmUrl = await resolver({
    cliFlag: options.vmUrl,
    configUrl: config.vmServiceUrl,
  });

  if (!vmUrl) {
    throw new Error(
      'Could not find a running Flutter VM Service.\n\n' +
      '   Start your Flutter app first: flutter run\n' +
      '   Then re-run: fliwright run\n' +
      '   Or specify: fliwright run --vm-url ws://127.0.0.1:8181/ws',
    );
  }

  deps.onVmResolved?.(vmUrl);

  const mockServer = new ToolMockServer();
  const mockControllerUrl = await mockServer.start();
  await mockServer.loadRules(join(cwd, '.fliwright/mocks'));

  try {
    const vitestResult = await runVitest(testPattern, vmUrl, cwd, mockControllerUrl);
    const formatted = formatOutput(vitestResult, reporter);

    console.log(formatted);
    return vitestResult;
  } finally {
    await mockServer.stop();
  }
}

async function runVitest(
  testPattern: string,
  vmUrl: string,
  cwd: string,
  mockControllerUrl: string,
): Promise<CliRunResult> {
  const vitestCli = require.resolve('vitest/vitest.mjs');
  const failureContextDir = await mkdtemp(join(tmpdir(), 'fliwright-cli-failures-'));
  const failureContextPath = join(failureContextDir, 'failures.json');

  try {
    const { stdout } = await execNode(
      [vitestCli, 'run', testPattern, '--reporter=json'],
      {
        ...process.env,
        FLIWRIGHT_VM_URL: vmUrl,
        FLIWRIGHT_MOCK_CONTROLLER_URL: mockControllerUrl,
        FLIWRIGHT_MCP_FAILURE_CONTEXT_PATH: failureContextPath,
      },
      cwd,
    );

    return parseVitestOutput(stdout);
  } finally {
    await rm(failureContextDir, { recursive: true, force: true });
  }
}

function execNode(
  args: string[],
  env: NodeJS.ProcessEnv,
  cwd: string,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', () => resolve({ stdout, stderr }));
  });
}

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

export function parseVitestOutput(raw: string): CliRunResult {
  const trimmed = raw.trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    return { passed: false, totalTests: 0, passedTests: 0, failedTests: 0, duration: 0, results: [] };
  }

  let report: VitestJsonReport;
  try {
    report = JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    return { passed: false, totalTests: 0, passedTests: 0, failedTests: 0, duration: 0, results: [] };
  }

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
    passedTests: report.numPassedTests ?? results.filter((r) => r.passed).length,
    failedTests: report.numFailedTests ?? results.filter((r) => !r.passed).length,
    duration,
    results,
  };
}

function formatOutput(result: CliRunResult, reporter: string): string {
  switch (reporter) {
    case 'json':
      return formatJson(result);
    case 'junit':
      return formatJunit(result);
    case 'pretty':
    default:
      return formatPretty(result);
  }
}
