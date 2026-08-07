import { FliwrightAgentError } from '../agent/FliwrightAgentError.js';
import type { Page } from '../Page.js';
import type { TimelineArtifactStore } from '../timeline/TimelineArtifactStore.js';
import type { TimelineRecorder } from '../timeline/TimelineRecorder.js';
import type { AgentVisibleFailure, TimelineArtifactRef } from '../timeline/types.js';
import {
  TIMELINE_ARTIFACT_KIND_SCREENSHOT,
  TIMELINE_ARTIFACT_KIND_SNAPSHOT,
} from '../timeline/constants.js';

export interface AssertionTimelineRunOptions {
  title: string;
  metadata: Record<string, unknown> & { matcher: string; target?: string };
  recorder?: TimelineRecorder;
  page?: Page;
  artifactStore?: TimelineArtifactStore;
  includeScreenshot?: boolean;
  includeSnapshot?: boolean;
}

export async function runTimelineAssertion<T>(
  options: AssertionTimelineRunOptions,
  body: () => Promise<T>,
): Promise<T> {
  const node = options.recorder?.startNode('assertion', options.title, { metadata: options.metadata });
  try {
    const value = await body();
    if (node) options.recorder?.passNode(node.id);
    return value;
  } catch (error) {
    const artifacts = node ? await captureFailureArtifacts(node.id, options) : [];
    if (node && artifacts.length) options.recorder?.addArtifacts(node.id, artifacts);
    const failure = createAssertionFailure(error, options, node?.id, artifacts);
    if (node) {
      options.recorder?.failNode(node.id, failure, { ...options.metadata, actual: assertionActual(error) });
    }
    throw error instanceof FliwrightAgentError ? error : new FliwrightAgentError(failure, { cause: error });
  }
}

async function captureFailureArtifacts(
  nodeId: string,
  options: AssertionTimelineRunOptions,
): Promise<TimelineArtifactRef[]> {
  if (!options.page || !options.artifactStore) return [];

  const artifacts: TimelineArtifactRef[] = [];
  try {
    if (options.includeScreenshot !== false && typeof options.page.screenshot === 'function') {
      artifacts.push(await options.artifactStore.writeScreenshot(nodeId, await options.page.screenshot()));
    }
  } catch {
    // Failure evidence is best-effort and must not mask the assertion error.
  }
  try {
    if (options.includeSnapshot !== false && typeof options.page.snapshot === 'function') {
      artifacts.push(await options.artifactStore.writeSnapshot(nodeId, await options.page.snapshot()));
    }
  } catch {
    // Failure evidence is best-effort and must not mask the assertion error.
  }
  return artifacts;
}

function createAssertionFailure(
  error: unknown,
  options: AssertionTimelineRunOptions,
  timelineNodeId: string | undefined,
  artifacts: TimelineArtifactRef[],
): AgentVisibleFailure {
  const screenshot = artifacts.find((artifact) => artifact.kind === TIMELINE_ARTIFACT_KIND_SCREENSHOT);
  const snapshot = artifacts.find((artifact) => artifact.kind === TIMELINE_ARTIFACT_KIND_SNAPSHOT);
  return {
    code: 'assertion_failed',
    title: options.title,
    message: error instanceof Error ? error.message : String(error),
    ...(timelineNodeId ? { timelineNodeId } : {}),
    appState: {
      ...(screenshot ? { screenshotPath: screenshot.path } : {}),
      ...(snapshot ? { snapshotPath: snapshot.path } : {}),
    },
    actionContext: {
      action: options.metadata.matcher,
      target: options.metadata.target,
    },
    recoveryHints: [
      { kind: 'observe', description: 'Inspect the current screen and semantic snapshot around the failed assertion.' },
      { kind: 'retry', description: 'Retry after the UI has settled if the expected state is asynchronous.' },
      { kind: 'manual', description: 'Check whether the assertion target or expected value still matches the app behavior.' },
    ],
  };
}

function assertionActual(error: unknown): unknown {
  if (isAssertionError(error)) return error.actual;
  return error instanceof Error ? error.message : String(error);
}

function isAssertionError(error: unknown): error is { actual: unknown } {
  return typeof error === 'object' && error !== null && 'actual' in error;
}
