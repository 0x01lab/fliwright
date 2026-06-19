import type { AgentVisibleFailure } from '../timeline/types.js';

export class FliwrightAgentError extends Error {
  readonly failure: AgentVisibleFailure;

  constructor(failure: AgentVisibleFailure, options?: { cause?: unknown }) {
    super(`${failure.title}: ${failure.message}${failure.timelineNodeId ? ` [${failure.timelineNodeId}]` : ''}`, {
      cause: options?.cause,
    });
    this.name = 'FliwrightAgentError';
    this.failure = failure;
  }
}
