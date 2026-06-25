import type { CliFailureEntry, CliRunResult } from '@fliwright/cli/run';

export type RunResult = CliRunResult;

export type FailureEntry = CliFailureEntry;

export interface GetFailureResult {
  failures: FailureEntry[];
}

export interface GenerateTestResult {
  testCode: string;
  testName: string;
  testFile?: string;
  warnings?: string[];
  selectorDiagnostics?: unknown[];
  workflow?: unknown;
  tests?: unknown[];
  coverage?: unknown;
}

export interface TddWorkflowContext {
  testName?: string;
  flowId?: string;
  testFile?: string;
  selectorDiagnostics?: unknown[];
  tests?: unknown[];
  coverage?: unknown;
  workflow?: unknown;
}

export interface McpServerState {
  lastRunResult: RunResult | null;
  lastFailureEntries: FailureEntry[];
  vmServiceUrl: string | null;
}
