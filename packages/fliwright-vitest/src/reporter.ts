import type { Reporter, RunnerTestFile } from 'vitest/node';

export class FliwrightReporter implements Reporter {
  onInit() {}

  onFinished(files: RunnerTestFile[]) {
    for (const file of files) {
      for (const task of file.tasks) {
        if (task.type === 'test' && task.result?.state === 'fail') {
          const errors = task.result.errors ?? [];
          for (const err of errors) {
            if (err.stack) {
              const failureMatch = err.stack.match(/\.fliwright\/failures\/[^\s]+\.png/);
              if (failureMatch) {
                console.log(`  Screenshot: ${failureMatch[0]}`);
              }
            }
          }
        }
      }
    }
  }
}
