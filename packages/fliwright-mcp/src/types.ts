import type { CliFailureEntry, CliRunResult } from '@fliwright/cli/run';

export type RunResult = CliRunResult;

export type FailureEntry = CliFailureEntry;

export interface GetFailureResult {
  failures: FailureEntry[];
}

export interface GenerateTestResult {
  testCode: string;
  testName: string;
}

export interface McpServerState {
  lastRunResult: RunResult | null;
  lastFailureEntries: FailureEntry[];
  vmServiceUrl: string | null;
}
