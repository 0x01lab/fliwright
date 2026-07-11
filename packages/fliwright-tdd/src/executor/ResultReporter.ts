import type { Reporter, TestModule } from 'vitest/node';

export interface CollectedResult {
  testName: string;
  status: 'red' | 'green';
  message?: string;
}

export class ResultReporter implements Reporter {
  private readonly finishedRuns: TestModule[][] = [];
  private waiters: Array<(modules: TestModule[]) => void> = [];

  /** Vitest 5 reports finished runs via onTestRunEnd instead of onFinished. */
  onTestRunEnd(testModules: ReadonlyArray<TestModule>): void {
    const modules = [...testModules];
    this.finishedRuns.push(modules);
    const waiters = this.waiters;
    this.waiters = [];
    for (const waiter of waiters) waiter(modules);
  }

  waitForNextRun(): Promise<TestModule[]> {
    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }

  collectLatest(): CollectedResult[] {
    const modules = this.finishedRuns.at(-1) ?? [];
    return collectResultsFromModules(modules);
  }

  drain(): void {
    this.finishedRuns.length = 0;
  }
}

export function collectResultsFromModules(modules: TestModule[]): CollectedResult[] {
  const results: CollectedResult[] = [];
  for (const module of modules) {
    for (const testCase of module.children.allTests()) {
      const result = testCase.result();
      if (result.state !== 'passed' && result.state !== 'failed') continue;
      results.push({
        testName: testCase.name,
        status: result.state === 'passed' ? 'green' : 'red',
        message: result.errors?.map((error) => error.message).join('\n'),
      });
    }
  }
  return results;
}

/** @deprecated Use {@link collectResultsFromModules}; kept for existing imports. */
export const collectResultsFromFiles = collectResultsFromModules;
