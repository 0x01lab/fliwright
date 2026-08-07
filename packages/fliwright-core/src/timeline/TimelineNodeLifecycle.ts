import { FliwrightAgentError } from '../agent/FliwrightAgentError.js';
import type {
  AgentVisibleFailure,
  TimelineArtifactRef,
  TimelineNodeKind,
  TimelineNodeStartOptions,
} from './types.js';
import type { TimelineRecorder } from './TimelineRecorder.js';

export interface TimelineNodeFailure {
  failure: AgentVisibleFailure;
  artifacts?: TimelineArtifactRef[];
  metadata?: Record<string, unknown>;
}

export interface TimelineNodeRunOptions<T> {
  kind: TimelineNodeKind;
  title: string;
  start?: TimelineNodeStartOptions;
  body: () => T | Promise<T>;
  onFailure: (error: unknown, timelineNodeId?: string) => TimelineNodeFailure | Promise<TimelineNodeFailure>;
  successMetadata?: () => Record<string, unknown> | undefined;
  wrapError?: (error: unknown, failure: AgentVisibleFailure) => Error;
}

/**
 * Owns the shared timeline node lifecycle while callers retain their failure semantics.
 * Evidence capture and failure construction stay behind the caller's callback.
 */
export class TimelineNodeLifecycle {
  constructor(private readonly recorder?: TimelineRecorder) {}

  async run<T>(options: TimelineNodeRunOptions<T>): Promise<T> {
    const node = this.recorder?.startNode(options.kind, options.title, options.start);
    try {
      const value = await options.body();
      if (node) this.recorder?.passNode(node.id, options.successMetadata?.());
      return value;
    } catch (error) {
      const result = await options.onFailure(error, node?.id);
      if (node && result.artifacts?.length) this.recorder?.addArtifacts(node.id, result.artifacts);
      if (node) this.recorder?.failNode(node.id, result.failure, result.metadata);
      throw (options.wrapError ?? wrapTimelineError)(error, result.failure);
    }
  }
}

export function wrapTimelineError(error: unknown, failure: AgentVisibleFailure): FliwrightAgentError {
  if (error instanceof FliwrightAgentError) return error;
  return new FliwrightAgentError(failure, { cause: error });
}
