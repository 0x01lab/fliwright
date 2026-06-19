import type { Page } from '../Page.js';
import { FliwrightAgentError } from '../agent/FliwrightAgentError.js';
import type { AgentVisibleFailure, TimelineArtifactRef, TimelineNodeStartOptions } from './types.js';
import { TimelineArtifactStore } from './TimelineArtifactStore.js';
import { TimelineRecorder } from './TimelineRecorder.js';

export interface FlowRuntimeOptions {
  recorder: TimelineRecorder;
  artifactStore?: TimelineArtifactStore;
  page?: Page;
}

export interface FlowFrameOptions {
  screenshot?: boolean;
  snapshot?: boolean;
  diagnostics?: boolean;
  metadata?: Record<string, unknown>;
}

export class FlowRuntime {
  constructor(private readonly options: FlowRuntimeOptions) {}

  async step<T>(title: string, body: () => T | Promise<T>, metadata?: Record<string, unknown>): Promise<T> {
    return this.runNode('step', title, { metadata }, body);
  }

  async page<T>(
    title: string,
    options: { route?: string; metadata?: Record<string, unknown> } | (() => T | Promise<T>),
    body?: () => T | Promise<T>,
  ): Promise<T> {
    if (typeof options === 'function') {
      return this.runNode('page', title, {}, options);
    }
    return this.runNode('page', title, {
      route: options.route,
      metadata: options.metadata,
    }, body ?? (() => undefined as T));
  }

  async branch<T>(title: string, metadata: Record<string, unknown>, body: () => T | Promise<T>): Promise<T> {
    return this.runNode('branch', title, { metadata }, body);
  }

  async optional<T>(title: string, options: { when?: boolean }, body: () => T | Promise<T>): Promise<T | undefined> {
    const node = this.options.recorder.startNode('optional', title, {
      metadata: { when: options.when ?? true },
    });
    if (options.when === false) {
      this.options.recorder.skipNode(node.id);
      return undefined;
    }
    try {
      const value = await body();
      this.options.recorder.passNode(node.id);
      return value;
    } catch (error) {
      const failure = createAgentFailure(error, title, node.id, 'step_failed');
      this.options.recorder.failNode(node.id, failure);
      throw wrapAgentError(error, failure);
    }
  }

  async frame(title: string, options: FlowFrameOptions = {}): Promise<TimelineArtifactRef[]> {
    const node = this.options.recorder.startNode('frame', title, { metadata: options.metadata });
    try {
      const artifacts = await this.captureFrameArtifacts(node.id, options);
      if (artifacts.length) this.options.recorder.addArtifacts(node.id, artifacts);
      this.options.recorder.passNode(node.id);
      return artifacts;
    } catch (error) {
      const failure = createAgentFailure(error, title, node.id, 'step_failed');
      this.options.recorder.failNode(node.id, failure);
      throw wrapAgentError(error, failure);
    }
  }

  assertion<T>(title: string, body: () => T | Promise<T>, metadata?: Record<string, unknown>): Promise<T> {
    return this.runNode('assertion', title, { metadata }, body, 'assertion_failed');
  }

  private async runNode<T>(
    kind: 'step' | 'page' | 'branch' | 'assertion',
    title: string,
    options: TimelineNodeStartOptions,
    body: () => T | Promise<T>,
    failureCode: AgentVisibleFailure['code'] = 'step_failed',
  ): Promise<T> {
    const node = this.options.recorder.startNode(kind, title, options);
    try {
      const value = await body();
      this.options.recorder.passNode(node.id);
      return value;
    } catch (error) {
      const failure = createAgentFailure(error, title, node.id, failureCode);
      this.options.recorder.failNode(node.id, failure);
      throw wrapAgentError(error, failure);
    }
  }

  private async captureFrameArtifacts(nodeId: string, options: FlowFrameOptions): Promise<TimelineArtifactRef[]> {
    const page = this.options.page;
    const store = this.options.artifactStore;
    if (!page || !store) return [];

    const artifacts: TimelineArtifactRef[] = [];
    const captureFrame = (page as unknown as { captureFrame?: (options?: unknown) => Promise<unknown> }).captureFrame;
    if ((options.screenshot || options.snapshot || options.diagnostics) && typeof captureFrame === 'function') {
      try {
        const frame = await captureFrame.call(page, options);
        if (options.screenshot && isRecord(frame) && isRecord(frame.screenshot) && typeof frame.screenshot.base64 === 'string') {
          artifacts.push(await store.writeScreenshot(nodeId, Buffer.from(frame.screenshot.base64, 'base64')));
        }
        if (options.snapshot && isRecord(frame) && 'snap' in frame) {
          artifacts.push(await store.writeSnapshot(nodeId, frame.snap));
        }
        if (options.diagnostics && isRecord(frame) && 'diagnostics' in frame) {
          artifacts.push(await store.writeDiagnostics(nodeId, frame.diagnostics));
        }
        if (artifacts.length) return artifacts;
      } catch {
        // Fall back to per-artifact calls below.
      }
    }

    if (options.screenshot && typeof (page as unknown as { screenshot?: () => Promise<Buffer> }).screenshot === 'function') {
      try {
        const screenshot = await (page as unknown as { screenshot: () => Promise<Buffer> }).screenshot();
        artifacts.push(await store.writeScreenshot(nodeId, screenshot));
      } catch {
        // Screenshot capture is best-effort for frame artifacts.
      }
    }
    if (options.snapshot && typeof page.snapshot === 'function') {
      try {
        const snapshot = await page.snapshot();
        artifacts.push(await store.writeSnapshot(nodeId, snapshot));
      } catch {
        // Snapshot capture is best-effort for frame artifacts.
      }
    }
    return artifacts;
  }
}

export function createAgentFailure(
  error: unknown,
  title: string,
  timelineNodeId?: string,
  code: AgentVisibleFailure['code'] = 'unknown',
): AgentVisibleFailure {
  if (error instanceof FliwrightAgentError) {
    return { ...error.failure, timelineNodeId: error.failure.timelineNodeId ?? timelineNodeId };
  }
  const message = error instanceof Error ? error.message : String(error);
  return {
    code,
    title,
    message,
    timelineNodeId,
    recoveryHints: defaultRecoveryHints(code, message),
  };
}

export function wrapAgentError(error: unknown, failure: AgentVisibleFailure): FliwrightAgentError {
  if (error instanceof FliwrightAgentError) return error;
  return new FliwrightAgentError(failure, { cause: error });
}

function defaultRecoveryHints(code: AgentVisibleFailure['code'], message: string): AgentVisibleFailure['recoveryHints'] {
  if (code === 'selector_not_found' || /not found|no ref|no widget|selector/i.test(message)) {
    return [
      { kind: 'observe', description: 'Inspect the current widget tree and visible semantic snapshot.' },
      { kind: 'change-selector', description: 'Use a more stable key, semantics label, or scoped selector.' },
      { kind: 'retry', description: 'Retry after the app has settled if the element appears asynchronously.' },
    ];
  }
  if (code === 'actionability_failed' || /obscured|disabled|offscreen|hit/i.test(message)) {
    return [
      { kind: 'close-overlay', description: 'Dismiss overlays that may intercept the action.' },
      { kind: 'wait', description: 'Wait for animations or layout changes to settle.' },
      { kind: 'retry', description: 'Retry the action after the target becomes actionable.' },
    ];
  }
  if (code === 'navigation_failed') {
    return [
      { kind: 'observe', description: 'Capture the current route and visible screen before retrying navigation.' },
      { kind: 'manual', description: 'Check whether the route exists in the running app build.' },
    ];
  }
  return [
    { kind: 'observe', description: 'Capture a screenshot and snapshot around the failed timeline node.' },
    { kind: 'manual', description: 'Inspect the thrown error and current app state.' },
  ];
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null;
}
