import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { RunArtifactStore } from './RunArtifactStore.js';
import { projectRunTrace } from './RunTraceProjection.js';
import { parseTimelineData } from './timeline/TimelineReader.js';
import type { RunSessionResult } from './RunSession.js';

export interface RecoverableRunAttempt {
  result: RunSessionResult;
  timeline?: unknown;
}

/** Persist terminal worker facts in the parent when the worker exhausted its write budget. */
export async function restoreRunAttempts(attempts: RecoverableRunAttempt[], runId: string, runsRoot: string): Promise<void> {
  const store = new RunArtifactStore({ runId, runsRoot });
  for (const entry of attempts) {
    const result = entry.result;
    if (result.runId !== runId || !result.testId || !result.attemptId || result.finalized !== true
      || !['passed', 'failed', 'skipped', 'interrupted'].includes(result.testOutcome)) continue;
    const dir = store.attemptDir(result.testId, result.attemptId);
    if (result.evidenceStatus !== 'disabled') result.evidenceStatus = 'partial';
    result.evidenceIssues = [...new Set([...(result.evidenceIssues ?? []),
      'Worker persistence incomplete; terminal facts recovered through the Vitest reporter.'])];
    const timeline = entry.timeline ? parseTimelineData(JSON.stringify(entry.timeline)) : undefined;
    if (timeline && timeline.runId === runId && timeline.testName === result.testName) {
      await mkdir(join(dir, 'trace'), { recursive: true });
      await writeFile(join(dir, 'timeline.json'), JSON.stringify(timeline, null, 2));
      await writeFile(join(dir, 'trace', 'trace.json'), JSON.stringify(projectRunTrace(result, timeline), null, 2));
    }
    await store.writeAttemptResult(result.testId, result.attemptId, result);
  }
}
