import type * as vscode from 'vscode';
import type { RunResult } from '../types.js';
import type { TraceMode } from '@fliwright/core';

export interface RunParams {
  workspaceRoot: vscode.Uri;
  testFile?: vscode.Uri;
  vmServiceUrl?: string;
  failureContextDir: vscode.Uri;
  traceMode?: TraceMode;
  traceDir?: vscode.Uri;
  testNamePattern?: string;
  runsRoot?: string;
  runId?: string;
  e2eAutomationEnabled?: boolean;
  signal?: AbortSignal;
}

export interface TestRunner {
  run(params: RunParams): Promise<RunResult>;
}
