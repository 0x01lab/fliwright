import type { Reporter } from 'vitest/reporters';

export interface CollectedResult {
  testName: string;
  status: 'red' | 'green';
  message?: string;
}

interface TaskLike {
  type?: string;
  name: string;
  result?: {
    state?: string;
    errors?: Array<{ message?: string }>;
  };
  tasks?: TaskLike[];
}

type FileLike = TaskLike;

export class ResultReporter implements Reporter {
  private readonly finishedRuns: FileLike[][] = [];
  private waiters: Array<(files: FileLike[]) => void> = [];

  onFinished(files: unknown[]): void {
    const typedFiles = files as FileLike[];
    this.finishedRuns.push(typedFiles);
    const waiters = this.waiters;
    this.waiters = [];
    for (const waiter of waiters) waiter(typedFiles);
  }

  waitForNextRun(): Promise<FileLike[]> {
    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }

  collectLatest(): CollectedResult[] {
    const files = this.finishedRuns.at(-1) ?? [];
    return collectResultsFromFiles(files);
  }

  drain(): void {
    this.finishedRuns.length = 0;
  }
}

export function collectResultsFromFiles(files: FileLike[]): CollectedResult[] {
  const results: CollectedResult[] = [];
  for (const file of files) collectTaskResults(file, results);
  return results;
}

function collectTaskResults(task: TaskLike, out: CollectedResult[]): void {
  if (task.type === 'test') {
    const state = task.result?.state;
    if (state === 'pass' || state === 'fail') {
      out.push({
        testName: task.name,
        status: state === 'pass' ? 'green' : 'red',
        message: task.result?.errors?.map((error: { message?: string }) => error.message).join('\n'),
      });
    }
    return;
  }

  for (const child of task.tasks ?? []) collectTaskResults(child, out);
}
