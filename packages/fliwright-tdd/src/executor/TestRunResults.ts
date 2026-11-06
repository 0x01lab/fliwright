import type { TestModule } from 'vitest/node';

export interface CollectedResult {
  testName: string;
  fullName: string;
  status: 'red' | 'green';
  message?: string;
  runIdentity?: { runId: string; testId: string; attemptId: string };
}

export function collectResultsFromModules(modules: TestModule[]): CollectedResult[] {
  const results: CollectedResult[] = [];
  for (const module of modules) {
    for (const testCase of module.children.allTests()) {
      const result = testCase.result();
      if (result.state !== 'passed' && result.state !== 'failed') continue;
      const identity = (testCase.meta() as Record<string, unknown>).fliwrightRun as CollectedResult['runIdentity'];
      results.push({
        ...(identity ? { runIdentity: identity } : {}),
        testName: testCase.name,
        fullName: testCase.fullName,
        status: result.state === 'passed' ? 'green' : 'red',
        message: result.errors?.map((error) => error.message).join('\n'),
      });
    }
  }
  return results;
}
