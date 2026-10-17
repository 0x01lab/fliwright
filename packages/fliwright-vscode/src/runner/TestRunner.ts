import type * as vscode from 'vscode';
import type { RunResult } from '../types.js';

export interface RunParams {
  workspaceRoot: vscode.Uri;
  testFile?: vscode.Uri;
  vmServiceUrl?: string;
  failureContextDir: vscode.Uri;
  testNamePattern?: string;
  runsRoot?: string;
  runId?: string;
  signal?: AbortSignal;
  configPath?: string;
  onOutput?: (chunk: string, stream: 'stdout' | 'stderr') => void;
}

export interface TestRunner {
  run(params: RunParams): Promise<RunResult>;
}
