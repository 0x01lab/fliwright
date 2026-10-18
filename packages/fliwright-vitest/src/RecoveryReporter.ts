import { restoreRunAttempts } from '@fliwright/core';
import type { RecoverableRunAttempt } from '@fliwright/core';
import type { Reporter } from 'vitest/node';

/** Parent-side persistence fallback for direct Vitest runs using fliwrightPreset. */
export class FliwrightRecoveryReporter implements Reporter {
  async onTestRunEnd(modules: Parameters<NonNullable<Reporter['onTestRunEnd']>>[0]): Promise<void> {
    for (const module of modules) for (const test of module.children.allTests()) {
      const meta = test.meta() as Record<string, unknown>;
      const attempts = meta.fliwrightRecovery as Array<RecoverableRunAttempt & { runsRoot: string }> | undefined;
      for (const attempt of attempts ?? []) {
        await restoreRunAttempts([attempt], attempt.result.runId, attempt.runsRoot);
      }
    }
  }
}

export default FliwrightRecoveryReporter;
