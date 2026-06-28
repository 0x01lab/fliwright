import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { FLIWRIGHT_RUNS_ROOT_ENV } from '@fliwright/core';
import type * as vscode from 'vscode';
import type { RunResult, ScriptFileEntry } from '../types.js';

export interface ScriptRunParams {
  workspaceRoot: vscode.Uri;
  script: ScriptFileEntry;
  vmServiceUrl?: string;
  runsRoot?: string;
  runId?: string;
  traceDir?: vscode.Uri;
  traceMode?: 'full' | 'on-failure' | 'off';
  onOutput?: (chunk: string, stream: 'stdout' | 'stderr') => void;
}

export class ScriptRunner {
  async run(params: ScriptRunParams): Promise<RunResult> {
    const startedAt = Date.now();
    const relativeScript = path.relative(params.workspaceRoot.fsPath, params.script.uri.fsPath);
    const env: NodeJS.ProcessEnv = {
      ...process.env,
    };
    if (params.vmServiceUrl) {
      env.FLIWRIGHT_VM_SERVICE_URL = params.vmServiceUrl;
      env.FLIWRIGHT_VM_URL = params.vmServiceUrl;
    }
    if (params.runsRoot) env[FLIWRIGHT_RUNS_ROOT_ENV] = params.runsRoot;
    if (params.runId) env.FLIWRIGHT_RUN_ID = params.runId;
    if (params.traceMode && params.traceMode !== 'off' && params.traceDir) {
      env.FLIWRIGHT_TRACE = params.traceMode;
      env.FLIWRIGHT_TRACE_DIR = params.traceDir.fsPath;
      env.FLIWRIGHT_TRACE_LAYOUT = 'run';
    }

    const command = await resolveScriptCommand(params.script.uri.fsPath, relativeScript, params.workspaceRoot.fsPath);
    let execution: CommandResult;
    try {
      execution = await runCommand(command.command, command.args, params.workspaceRoot.fsPath, env, params.onOutput);
    } finally {
      await command.cleanup?.();
    }
    const duration = Date.now() - startedAt;
    const passed = execution.exitCode === 0;
    const output = [execution.stdout, execution.stderr].filter(Boolean).join('\n').trim();

    return {
      passed,
      totalTests: 1,
      passedTests: passed ? 1 : 0,
      failedTests: passed ? 0 : 1,
      duration,
      results: [{
        name: params.script.label,
        passed,
        duration,
        error: passed ? undefined : output || `Script exited with ${execution.exitCode}`,
      }],
      stdout: execution.stdout,
      stderr: execution.stderr,
    };
  }
}

interface ScriptCommand {
  command: string;
  args: string[];
  cleanup?: () => Promise<void>;
}

async function resolveScriptCommand(scriptPath: string, relativeScript: string, workspaceRoot: string): Promise<ScriptCommand> {
  const source = await fs.readFile(scriptPath, 'utf8');
  if (usesFliwrightVitest(source)) {
    const config = await createVitestScriptConfig(relativeScript, workspaceRoot);
    return {
      command: 'pnpm',
      args: [
        'exec',
        'vitest',
        'run',
        relativeScript,
        '--config',
        config.path,
        '--pool',
        'forks',
        '--poolOptions.forks.singleFork',
        '--no-fileParallelism',
      ],
      cleanup: config.cleanup,
    };
  }
  return { command: 'node', args: [relativeScript] };
}

function usesFliwrightVitest(source: string): boolean {
  return /from\s+['"]@fliwright\/vitest['"]/.test(source) ||
    /import\s*\(\s*['"]@fliwright\/vitest['"]\s*\)/.test(source);
}

async function createVitestScriptConfig(relativeScript: string, workspaceRoot: string): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'fliwright-vscode-script-'));
  const configPath = path.join(dir, 'vitest.config.mjs');
  const include = relativeScript.split(path.sep).join('/');
  await fs.writeFile(configPath, [
    'export default {',
    `  root: ${JSON.stringify(workspaceRoot)},`,
    '  test: {',
    `    include: [${JSON.stringify(include)}],`,
    "    environment: 'node',",
    '    testTimeout: 60_000,',
    '    hookTimeout: 30_000,',
    '  },',
    '};',
    '',
  ].join('\n'));
  return {
    path: configPath,
    cleanup: async () => {
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
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
  onOutput?: (chunk: string, stream: 'stdout' | 'stderr') => void,
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, shell: process.platform === 'win32' });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      const text = String(chunk);
      stdout += text;
      onOutput?.(text, 'stdout');
    });
    child.stderr.on('data', (chunk) => {
      const text = String(chunk);
      stderr += text;
      onOutput?.(text, 'stderr');
    });
    child.on('error', reject);
    child.on('close', (exitCode) => resolve({ stdout, stderr, exitCode: exitCode ?? 1 }));
  });
}
