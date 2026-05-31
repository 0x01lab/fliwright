export interface RunResult {
  passed: boolean;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  duration: number;
  results: Array<{
    name: string;
    passed: boolean;
    duration: number;
    error?: string;
  }>;
}

export interface FailureEntry {
  testName: string;
  assertion: {
    matcher: string;
    expected: string;
    actual: string;
    timeout: number;
  };
  widgetTree: object;
  source: {
    file: string;
    line: number;
    snippet: string;
  };
  healingSuggestion?: {
    originalSelector: string;
    suggestedSelector: string;
    confidence: number;
    scores: {
      position: number;
      context: number;
      codeBinding: number;
      text: number;
      weighted: number;
    };
  };
  timestamp: string;
}

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