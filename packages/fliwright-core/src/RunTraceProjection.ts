import { posix } from 'node:path';
import type { RunSessionResult } from './RunSession.js';
import type { TraceData } from './TraceCollector.js';
import type { TimelineData } from './timeline/types.js';

/** Trace is a presentation of recorded facts; projection never queries the app. */
export function projectRunTrace(result: RunSessionResult, timeline: TimelineData): TraceData {
  const actions = result.operations.filter((operation) => operation.kind === 'action' || operation.kind === 'raw');
  return {
    meta: {
      traceVersion: 1, runId: result.runId, testName: result.testName,
      startedAt: timeline.startedAt, completedAt: timeline.endedAt,
      status: timeline.status, totalSteps: actions.length,
    },
    steps: actions.map((operation, index) => {
      const screenshots = result.evidence.filter((evidence) => evidence.operationId === operation.operationId
        && evidence.kind === 'screenshot' && evidence.result.status === 'captured');
      const screenshot = (screenshots.find(({ reason }) => reason === 'failure')
        ?? screenshots.find(({ reason }) => reason === 'finish')
        ?? screenshots[0])?.result.artifactPaths?.[0];
      const error = operation.error;
      return {
        index, operationId: operation.operationId,
        action: String(operation.metadata?.action ?? operation.title),
        selector: String(operation.metadata?.selector ?? ''),
        status: operation.outcome === 'failed' ? 'fail' as const
          : operation.outcome === 'passed' ? 'pass' as const : operation.outcome,
        durationMs: operation.durationMs ?? 0, timestamp: operation.startedAt,
        ...(screenshot ? { screenshotFile: posix.join('..', screenshot) } : {}),
        ...(error ? { error: typeof error === 'object' && 'message' in error
          ? String(error.message) : String(error) } : {}),
      };
    }),
  };
}
