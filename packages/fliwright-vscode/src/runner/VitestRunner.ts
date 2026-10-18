import { spawn } from 'node:child_process';
import { createRequire as createNodeRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import * as path from 'node:path';
import { FLIWRIGHT_RUNS_ROOT_ENV, ensureFliwrightRunsRoot } from '@fliwright/core';
import { resolveProjectConfig } from '@fliwright/cli';
import { finalizeRunArtifacts } from '@fliwright/cli/run';
import type { RunResult, TestCaseResult } from '../types.js';
import type { RunParams, TestRunner } from './TestRunner.js';

export class VitestRunner implements TestRunner {
  async run(params: RunParams): Promise<RunResult> {
    const config = await resolveProjectConfig(params.workspaceRoot.fsPath);
    const runsRoot = params.runsRoot ?? await ensureFliwrightRunsRoot({ projectRoot: params.workspaceRoot.fsPath, runsRoot: config.runsRoot });
    const runId = params.runId ?? `run-${randomUUID()}`;
    params = { ...params, runsRoot, runId };
    const vitestCli = resolveVitestCli(params.workspaceRoot.fsPath);
    const outputDir = path.join(runsRoot, runId);
    const vitestReportPath = path.join(outputDir, 'vitest.json');
    const args = [vitestCli, ...buildVitestArgs(params), '--outputFile', vitestReportPath];
    // CLI reporter flags replace the project's reporters, including the preset
    // recovery hook. Keep it alongside JSON output for bounded worker writes.
    const workspaceRequire = createNodeRequire(path.join(params.workspaceRoot.fsPath, 'package.json'));
    args.push('--reporter', workspaceRequire.resolve('@fliwright/vitest/reporter'));
    const env = buildRunEnv(params);

    await rm(vitestReportPath, { force: true });
    const execution = await runCommand(process.execPath, args, params.workspaceRoot.fsPath, env, params.signal, params.onOutput);
    // Vitest 5 writes JSON to disk; stdout contains only the report location.
    const report = await readFile(vitestReportPath, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return '';
      throw error;
    });
    const result = parseVitestJson(report, execution.stderr, execution.exitCode);
    const finalized = await finalizeRunArtifacts({ ...result,
      status: execution.exitCode === 130 ? 'interrupted' : result.passed ? 'passed' : 'failed',
    }, { cwd: params.workspaceRoot.fsPath, outputDir, reportPath: path.join(outputDir, 'report.json'),
      runId, runsRoot, screenshot: config.screenshot, recordingMode: config.recording.mode,
      testPattern: params.testFile?.fsPath ?? `${config.paths.tests}/**/*.test.ts`, testName: params.testNamePattern });
    return { ...finalized, runId };
  }
}

export function buildVitestArgs(params: RunParams): string[] {
  const args = ['run'];
  if (params.testFile) args.push(path.relative(params.workspaceRoot.fsPath, params.testFile.fsPath));
  if (params.testNamePattern) args.push('-t', params.testNamePattern);
  if (params.configPath) args.push('--config', params.configPath);
  args.push('--reporter=json');
  return args;
}

export function buildRunEnv(params: RunParams): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
  };
  if (params.runsRoot) env[FLIWRIGHT_RUNS_ROOT_ENV] = params.runsRoot;
  if (params.runId) env.FLIWRIGHT_RUN_ID = params.runId;
  if (params.vmServiceUrl) {
    env.FLIWRIGHT_VM_URL = params.vmServiceUrl;
    env.FLIWRIGHT_VM_SERVICE_URL = params.vmServiceUrl;
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
  onOutput?: (chunk: string, stream: 'stdout' | 'stderr') => void,
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      resolve({ stdout: '', stderr: 'Fliwright test run stopped by user.', exitCode: 130 });
      return;
    }

    const ownsProcessGroup = process.platform !== 'win32';
    const child = spawn(command, args, { cwd, env, shell: !ownsProcessGroup, detached: ownsProcessGroup });
    let stdout = '';
    let stderr = '';
    let stopped = false;
    let settled = false;
    let killTimer: NodeJS.Timeout | undefined;
    let abortListener: (() => void) | undefined;
    const signalRun = (terminationSignal: NodeJS.Signals): void => {
      if (ownsProcessGroup && child.pid) {
        try { process.kill(-child.pid, terminationSignal); } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH') child.kill(terminationSignal);
        }
      } else child.kill(terminationSignal);
    };
    const cleanup = (): void => {
      if (abortListener) signal?.removeEventListener('abort', abortListener);
      if (killTimer) clearTimeout(killTimer);
    };
    const finish = (result: CommandResult): void => {
      if (settled) return;
      settled = true;
      // Fork workers can outlive the runner and close their inherited stdio.
      if (stopped && ownsProcessGroup) signalRun('SIGKILL');
      cleanup();
      resolve(result);
    };

    abortListener = () => {
      if (stopped || settled) return;
      stopped = true;
      signalRun('SIGTERM');
      killTimer = setTimeout(() => signalRun('SIGKILL'), 2_000);
      killTimer.unref();
    };
    signal?.addEventListener('abort', abortListener, { once: true });

    child.stdout.on('data', (chunk) => { stdout += String(chunk); onOutput?.(String(chunk), 'stdout'); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); onOutput?.(String(chunk), 'stderr'); });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    });
    child.on('close', (exitCode) => finish({
      stdout,
      stderr: stopped && !stderr ? 'Fliwright test run stopped by user.' : stderr,
      exitCode: stopped ? 130 : exitCode ?? 1,
    }));
    if (signal?.aborted) abortListener();
  });
}

export function parseVitestJson(stdout: string, stderr = '', exitCode = 0): RunResult {
  const parsed = extractJson(stdout);
  if (!parsed) {
    return fallbackResult(stdout, stderr, exitCode);
  }

  const testResults = Array.isArray(parsed.testResults) ? parsed.testResults : [];
  const results: TestCaseResult[] = [];
  const runnerErrors: NonNullable<RunResult['runnerErrors']> = [];
  let observedFailures = 0;
  for (const file of testResults) {
    const assertions = Array.isArray(file.assertionResults) ? file.assertionResults : [];
    for (const assertion of assertions) {
      const status = String(assertion.status ?? '');
      const failureMessages = Array.isArray(assertion.failureMessages) ? assertion.failureMessages : [];
      if (status === 'failed') observedFailures++;
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
    if (file.status === 'failed' && assertions.length === 0) {
      observedFailures++;
      results.push({
        filePath: typeof file.name === 'string' ? file.name : undefined,
        name: String(file.name ?? 'Vitest suite'), passed: false, duration: 0,
        error: String(file.message || stderr || 'Vitest suite failed before any tests ran.'),
      });
      runnerErrors.push({ phase: 'suite', message: String(file.message || stderr || 'Vitest suite failed before any tests ran.'),
        ...(typeof file.name === 'string' ? { file: file.name } : {}) });
    }
  }

  const runFailed = exitCode !== 0 || parsed.success === false || Number(parsed.numFailedTestSuites ?? 0) > 0;
  if (runFailed && observedFailures === 0) {
    observedFailures++;
    results.push({ name: 'Vitest run', passed: false, duration: 0,
      error: stderr || `Vitest did not finish successfully (exit ${exitCode}).` });
    runnerErrors.push({ phase: 'process', message: results.at(-1)!.error! });
  }

  const totalTests = Number(parsed.numTotalTests ?? results.length);
  const failedTests = Math.max(Number(parsed.numFailedTests ?? 0), observedFailures);
  const passedTests = Number(parsed.numPassedTests ?? results.filter((test) => test.passed).length);
  return {
    passed: !runFailed && failedTests === 0,
    totalTests,
    passedTests,
    failedTests,
    duration: Number(parsed.startTime && parsed.success !== undefined ? Date.now() - parsed.startTime : 0),
    results,
    ...(runnerErrors.length ? { runnerErrors } : {}),
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
    passed: false,
    totalTests: 0,
    passedTests: exitCode === 0 ? 0 : 0,
    failedTests: 1,
    duration: 0,
    results: [{
      name: 'Vitest run',
      passed: false,
      duration: 0,
      error: stderr || stdout || `Vitest produced no JSON report (exit ${exitCode}).`,
    }],
    stdout,
    stderr,
  };
}
