import type * as vscode from 'vscode';
import type { RunResult } from '../types.js';

export interface RunParams {
  workspaceRoot: vscode.Uri;
  testFile?: vscode.Uri;
  vmServiceUrl?: string;
  failureContextDir: vscode.Uri;
}

export interface TestRunner {
  run(params: RunParams): Promise<RunResult>;
}
