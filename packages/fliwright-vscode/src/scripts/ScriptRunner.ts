import { spawn } from 'node:child_process';
import * as path from 'node:path';
import type * as vscode from 'vscode';
import type { RunResult, ScriptFileEntry } from '../types.js';

export interface ScriptRunParams {
  workspaceRoot: vscode.Uri;
  script: ScriptFileEntry;
  vmServiceUrl?: string;
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
