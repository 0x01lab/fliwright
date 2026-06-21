import { spawn } from 'node:child_process';
import * as path from 'node:path';
import type { RunResult, TestCaseResult } from '../types.js';
import type { RunParams, TestRunner } from './TestRunner.js';

export class VitestRunner implements TestRunner {
  async run(params: RunParams): Promise<RunResult> {
    const args = buildVitestArgs(params);
    const env = buildRunEnv(params);

    const execution = await runCommand('pnpm', args, params.workspaceRoot.fsPath, env);
    return parseVitestJson(execution.stdout, execution.stderr, execution.exitCode);
  }
}

export function buildVitestArgs(params: RunParams): string[] {
  const args = ['vitest', 'run'];
  if (params.testFile) args.push(path.relative(params.workspaceRoot.fsPath, params.testFile.fsPath));
  if (params.testNamePattern) args.push('-t', params.testNamePattern);
  args.push('--reporter=json');
  return args;
}

export function buildRunEnv(params: RunParams): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    FLIWRIGHT_MCP_FAILURE_CONTEXT_PATH: params.failureContextDir.fsPath,
  };
  if (params.runsRoot) env.FLIWRIGHT_RUNS_ROOT = params.runsRoot;
  if (params.vmServiceUrl) env.FLIWRIGHT_VM_URL = params.vmServiceUrl;
  if (params.traceMode && params.traceMode !== 'off' && params.traceDir) {
    env.FLIWRIGHT_TRACE = params.traceMode;
    env.FLIWRIGHT_TRACE_DIR = params.traceDir.fsPath;
  }
  return env;
}

interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function runCommand(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, shell: process.platform === 'win32' });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', reject);
    child.on('close', (exitCode) => resolve({ stdout, stderr, exitCode: exitCode ?? 1 }));
  });
}

export function parseVitestJson(stdout: string, stderr = '', exitCode = 0): RunResult {
  const parsed = extractJson(stdout);
  if (!parsed) {
    return fallbackResult(stdout, stderr, exitCode);
  }

  const testResults = Array.isArray(parsed.testResults) ? parsed.testResults : [];
  const results: TestCaseResult[] = [];
  for (const file of testResults) {
    const assertions = Array.isArray(file.assertionResults) ? file.assertionResults : [];
    for (const assertion of assertions) {
      const status = String(assertion.status ?? '');
      const failureMessages = Array.isArray(assertion.failureMessages) ? assertion.failureMessages : [];
      results.push({
        name: Array.isArray(assertion.ancestorTitles)
          ? [...assertion.ancestorTitles, assertion.title].filter(Boolean).join(' > ')
          : String(assertion.title ?? file.name ?? 'Unnamed test'),
        passed: status === 'passed',
        duration: Number(assertion.duration ?? 0),
        error: failureMessages.length > 0 ? failureMessages.join('\n') : undefined,
      });
    }
  }

  const totalTests = Number(parsed.numTotalTests ?? results.length);
  const failedTests = Number(parsed.numFailedTests ?? results.filter((test) => !test.passed).length);
  const passedTests = Number(parsed.numPassedTests ?? results.filter((test) => test.passed).length);
  return {
    passed: exitCode === 0 && failedTests === 0,
    totalTests,
    passedTests,
    failedTests,
    duration: Number(parsed.startTime && parsed.success !== undefined ? Date.now() - parsed.startTime : 0),
    results,
    stdout,
    stderr,
  };
}

function extractJson(stdout: string): any | undefined {
  const trimmed = stdout.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start < 0 || end <= start) return undefined;
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return undefined;
    }
  }
}

function fallbackResult(stdout: string, stderr: string, exitCode: number): RunResult {
  return {
    passed: exitCode === 0,
    totalTests: 0,
    passedTests: exitCode === 0 ? 0 : 0,
    failedTests: exitCode === 0 ? 0 : 1,
    duration: 0,
    results: exitCode === 0 ? [] : [{
      name: 'Vitest run',
      passed: false,
      duration: 0,
      error: stderr || stdout || `Vitest exited with ${exitCode}`,
    }],
    stdout,
    stderr,
  };
}
