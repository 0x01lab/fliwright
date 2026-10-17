import { runCommand } from '@fliwright/cli/run';
import type { RunResult } from '../types.js';
import type { RunParams, TestRunner } from './TestRunner.js';
import { VitestRunner } from './VitestRunner.js';

/** Apply the editor's runner choice without duplicating CLI execution behavior. */
export class ProjectTestRunner implements TestRunner {
  private readonly vitest = new VitestRunner();

  constructor(private readonly selected: () => 'vitest' | 'cli') {}

  async run(params: RunParams): Promise<RunResult> {
    if (this.selected() === 'vitest') return this.vitest.run(params);
    const result = await runCommand({
      cwd: params.workspaceRoot.fsPath,
      testPattern: params.testFile?.fsPath,
      testName: params.testNamePattern,
      vmUrl: params.vmServiceUrl,
      runsRoot: params.runsRoot,
      signal: params.signal,
      print: false,
    });
    const results = [...result.results];
    if (!result.passed && !results.some(test => !test.passed)) {
      results.push({ name: 'Fliwright run', passed: false, duration: 0,
        error: result.runnerErrors?.map(error => error.message).join('\n') || 'Fliwright run failed before tests completed.' });
    }
    return { ...result, runId: result.artifacts?.runId, results,
      failedTests: Math.max(result.failedTests, results.filter(test => !test.passed).length) };
  }
}
