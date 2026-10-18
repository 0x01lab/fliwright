/** Durable generation metadata; active driver/executor objects never belong here. */
export interface TddWorkflowContext {
  testName?: string; flowId?: string; testFile?: string; selectorDiagnostics?: unknown[];
  tests?: unknown[]; coverage?: unknown; workflow?: unknown;
}
export interface GenerateTestResult {
  testCode: string; testName: string; testFile?: string; warnings?: string[];
  selectorDiagnostics?: unknown[]; workflow?: unknown; tests?: unknown[]; coverage?: unknown;
}
