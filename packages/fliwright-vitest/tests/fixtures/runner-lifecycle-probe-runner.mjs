import { appendFileSync } from 'node:fs';
import { VitestTestRunner } from 'vitest/runners';

export default class RunnerLifecycleProbe extends VitestTestRunner {
  async onBeforeRunTask(task) {
    await super.onBeforeRunTask?.(task);
    record({ name: 'onBeforeRunTask', taskName: task.name });
  }

  async onBeforeTryTask(task, options) {
    await super.onBeforeTryTask?.(task, options);
    record({ name: 'onBeforeTryTask', taskName: task.name, ...options });
  }

  async onTaskFinished(task) {
    await super.onTaskFinished?.(task);
    record({
      name: 'onTaskFinished',
      taskName: task.name,
      state: task.result?.state,
      errors: task.result?.errors?.length ?? 0,
    });
  }

  async onAfterRetryTask(task, options) {
    await super.onAfterRetryTask?.(task, options);
    record({
      name: 'onAfterRetryTask',
      taskName: task.name,
      state: task.result?.state,
      ...options,
    });
  }

  async onAfterRunTask(task) {
    await super.onAfterRunTask?.(task);
    record({
      name: 'onAfterRunTask',
      taskName: task.name,
      state: task.result?.state,
      errors: task.result?.errors?.length ?? 0,
    });
  }

  async onBeforeRunSuite(suite) {
    await super.onBeforeRunSuite?.(suite);
    record({ name: 'onBeforeRunSuite', taskName: suite.name });
  }

  async onAfterRunSuite(suite) {
    await super.onAfterRunSuite?.(suite);
    record({
      name: 'onAfterRunSuite',
      taskName: suite.name,
      state: suite.result?.state,
      errors: suite.result?.errors?.length ?? 0,
    });
  }
}

function record(event) {
  appendFileSync(
    process.env.FLIWRIGHT_RUNNER_PROBE_LOG,
    `${JSON.stringify({ source: 'runner', ...event })}\n`,
  );
}
