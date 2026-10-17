import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { FLIWRIGHT_RUNS_ROOT_ENV } from '@fliwright/core';
import * as vscode from 'vscode';
import { VitestRunner } from '../runner/VitestRunner.js';
import type { RunResult, ScriptFileEntry } from '../types.js';
import { createVitestScriptConfig, usesVitestScript } from './VitestScriptConfig.js';

export interface ScriptRunParams {
  workspaceRoot: vscode.Uri;
  script: ScriptFileEntry;
  vmServiceUrl?: string;
  runsRoot?: string;
  runId?: string;
  onOutput?: (chunk: string, stream: 'stdout' | 'stderr') => void;
}

export class ScriptRunner {
  async run(params: ScriptRunParams): Promise<RunResult> {
    const startedAt = Date.now();
    const relativeScript = path.relative(params.workspaceRoot.fsPath, params.script.uri.fsPath);
    const source = await fs.readFile(params.script.uri.fsPath, 'utf8');
    if (usesVitestScript(params.script.uri.fsPath, source)) {
      const config = await createVitestScriptConfig(relativeScript, params.workspaceRoot.fsPath);
      try {
        return await new VitestRunner().run({ ...params, testFile: params.script.uri,
          failureContextDir: vscode.Uri.joinPath(params.workspaceRoot, '.fliwright', 'failures'),
          configPath: config.path });
      } finally {
        await config.cleanup();
      }
    }
    const env: NodeJS.ProcessEnv = {
      ...process.env,
    };
    if (params.vmServiceUrl) {
      env.FLIWRIGHT_VM_SERVICE_URL = params.vmServiceUrl;
      env.FLIWRIGHT_VM_URL = params.vmServiceUrl;
    }
    if (params.runsRoot) env[FLIWRIGHT_RUNS_ROOT_ENV] = params.runsRoot;
    if (params.runId) env.FLIWRIGHT_RUN_ID = params.runId;

    const execution = await runCommand('node', [relativeScript], params.workspaceRoot.fsPath, env, params.onOutput);
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
