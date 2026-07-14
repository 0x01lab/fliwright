import { spawn } from 'node:child_process';
import { createRequire as createNodeRequire } from 'node:module';
import * as path from 'node:path';
import { FLIWRIGHT_RUNS_ROOT_ENV } from '@fliwright/core';
import type { RunResult, TestCaseResult } from '../types.js';
import type { RunParams, TestRunner } from './TestRunner.js';
import { applyE2eAutomationEnv } from '../automation/E2eAutomation.js';

export class VitestRunner implements TestRunner {
  async run(params: RunParams): Promise<RunResult> {
    const vitestCli = resolveVitestCli(params.workspaceRoot.fsPath);
    const args = [vitestCli, ...buildVitestArgs(params)];
    const env = buildRunEnv(params);

    const execution = await runCommand(process.execPath, args, params.workspaceRoot.fsPath, env, params.signal);
    return parseVitestJson(execution.stdout, execution.stderr, execution.exitCode);
  }
}

export function buildVitestArgs(params: RunParams): string[] {
  const args = ['run'];
  if (params.testFile) args.push(path.relative(params.workspaceRoot.fsPath, params.testFile.fsPath));
  if (params.testNamePattern) args.push('-t', params.testNamePattern);
  args.push('--reporter=json');
  return args;
}

export function buildRunEnv(params: RunParams): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = applyE2eAutomationEnv({
    ...process.env,
    FLIWRIGHT_MCP_FAILURE_CONTEXT_PATH: params.failureContextDir.fsPath,
  }, params.e2eAutomationEnabled);
  if (params.runsRoot) env[FLIWRIGHT_RUNS_ROOT_ENV] = params.runsRoot;
  if (params.runId) env.FLIWRIGHT_RUN_ID = params.runId;
  if (params.vmServiceUrl) env.FLIWRIGHT_VM_URL = params.vmServiceUrl;
  if (params.traceMode && params.traceMode !== 'off' && params.traceDir) {
    env.FLIWRIGHT_TRACE = params.traceMode;
    env.FLIWRIGHT_TRACE_DIR = params.traceDir.fsPath;
    env.FLIWRIGHT_TRACE_LAYOUT = 'run';
  }
  return env;
}

export function resolveVitestCli(workspaceRoot: string): string {
  const workspaceRequire = createNodeRequire(path.join(workspaceRoot, 'package.json'));
  const packageJson = workspaceRequire.resolve('vitest/package.json');
  return path.join(path.dirname(packageJson), 'vitest.mjs');
}

interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function runCommand(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  signal?: AbortSignal,
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      resolve({ stdout: '', stderr: 'Fliwright test run stopped by user.', exitCode: 130 });
      return;
    }

    const child = spawn(command, args, { cwd, env, shell: process.platform === 'win32' });
    let stdout = '';
    let stderr = '';
    let stopped = false;
    let settled = false;
    let abortListener: (() => void) | undefined;
    const finish = (result: CommandResult): void => {
      if (settled) return;
      settled = true;
      if (abortListener) signal?.removeEventListener('abort', abortListener);
      resolve(result);
    };

    abortListener = () => {
      stopped = true;
      if (child.exitCode == null) {
        child.kill(process.platform === 'win32' ? undefined : 'SIGTERM');
        setTimeout(() => {
          if (!settled && child.exitCode == null) {
            child.kill(process.platform === 'win32' ? undefined : 'SIGKILL');
          }
        }, 2_000).unref();
      }
    };
    signal?.addEventListener('abort', abortListener, { once: true });

    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', (error) => {
      if (settled) return;
      if (abortListener) signal?.removeEventListener('abort', abortListener);
      reject(error);
    });
    child.on('close', (exitCode) => finish({
      stdout,
      stderr: stopped && !stderr ? 'Fliwright test run stopped by user.' : stderr,
      exitCode: stopped ? 130 : exitCode ?? 1,
    }));
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
        filePath: typeof file.name === 'string' ? file.name : undefined,
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
  if (exitCode === 130) {
    return {
      passed: false,
      totalTests: 0,
      passedTests: 0,
      failedTests: 1,
      duration: 0,
      results: [{
        name: 'Vitest run',
        passed: false,
        duration: 0,
        error: stderr || stdout || 'Fliwright test run stopped by user.',
      }],
      stdout,
      stderr,
    };
  }

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
