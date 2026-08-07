import type { Page } from '../Page.js';
import { FliwrightAgentError } from '../agent/FliwrightAgentError.js';
import type { AgentVisibleFailure, TimelineArtifactRef, TimelineNodeStartOptions } from './types.js';
import { TimelineArtifactStore } from './TimelineArtifactStore.js';
import { TimelineNodeLifecycle, wrapTimelineError } from './TimelineNodeLifecycle.js';
import { TimelineRecorder } from './TimelineRecorder.js';
import {
  TIMELINE_ARTIFACT_KIND_DIAGNOSTICS,
  TIMELINE_ARTIFACT_KIND_SCREENSHOT,
  TIMELINE_ARTIFACT_KIND_SNAPSHOT,
} from './constants.js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

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

export interface FlowManualOptions {
  message?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  metadata?: Record<string, unknown>;
  resumeWhen?: () => boolean | Promise<boolean>;
  confirm?: (prompt: string, options: { signal: AbortSignal }) => void | Promise<void>;
}

export class FlowRuntime {
  private readonly lifecycle: TimelineNodeLifecycle;

  constructor(private readonly options: FlowRuntimeOptions) {
    this.lifecycle = new TimelineNodeLifecycle(options.recorder);
  }

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
      const artifacts = await this.captureFailureArtifacts(node.id);
      if (artifacts.length) this.options.recorder.addArtifacts(node.id, artifacts);
      const failure = withArtifactAppState(createAgentFailure(error, title, node.id, 'step_failed'), artifacts);
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
      const artifacts = await this.captureFailureArtifacts(node.id);
      if (artifacts.length) this.options.recorder.addArtifacts(node.id, artifacts);
      const failure = withArtifactAppState(createAgentFailure(error, title, node.id, 'step_failed'), artifacts);
      this.options.recorder.failNode(node.id, failure);
      throw wrapAgentError(error, failure);
    }
  }

  async manual(title: string, options: FlowManualOptions = {}): Promise<void> {
    const message = options.message ?? title;
    const node = this.options.recorder.startNode('manual', title, {
      metadata: {
        ...(options.metadata ?? {}),
        message,
        ...(options.timeoutMs != null ? { timeoutMs: options.timeoutMs } : {}),
        ...(options.pollIntervalMs != null ? { pollIntervalMs: options.pollIntervalMs } : {}),
        completion: options.resumeWhen ? 'resumeWhen' : options.confirm ? 'confirm' : 'manual-file',
      },
    });
    const controller = new AbortController();
    const timer = options.timeoutMs == null
      ? undefined
      : setTimeout(() => controller.abort(), options.timeoutMs);

    try {
      await waitForManualCompletion(message, options, controller.signal);
      this.options.recorder.passNode(node.id);
    } catch (error) {
      const artifacts = await this.captureFailureArtifacts(node.id);
      if (artifacts.length) this.options.recorder.addArtifacts(node.id, artifacts);
      const failure = withArtifactAppState(createAgentFailure(error, title, node.id, 'step_failed'), artifacts);
      this.options.recorder.failNode(node.id, failure, { manual: true });
      throw wrapAgentError(error, failure);
    } finally {
      if (timer) clearTimeout(timer);
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
    return this.lifecycle.run({
      kind,
      title,
      start: options,
      body,
      onFailure: async (error, timelineNodeId) => {
        const artifacts = timelineNodeId ? await this.captureFailureArtifacts(timelineNodeId) : [];
        return {
          artifacts,
          failure: withArtifactAppState(
            createAgentFailure(error, title, timelineNodeId, failureCode),
            artifacts,
          ),
        };
      },
    });
  }

  private async captureFailureArtifacts(nodeId: string): Promise<TimelineArtifactRef[]> {
    return this.captureFrameArtifacts(nodeId, { screenshot: true, snapshot: true });
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

async function waitForManualCompletion(prompt: string, options: FlowManualOptions, signal: AbortSignal): Promise<void> {
  if (options.resumeWhen) {
    await waitForManualResumeCondition(prompt, options.resumeWhen, {
      signal,
      pollIntervalMs: options.pollIntervalMs ?? 500,
    });
    return;
  }
  await (options.confirm ?? defaultManualConfirm)(prompt, { signal });
}

async function waitForManualResumeCondition(
  prompt: string,
  resumeWhen: () => boolean | Promise<boolean>,
  options: { signal: AbortSignal; pollIntervalMs: number },
): Promise<void> {
  while (!options.signal.aborted) {
    if (await resumeWhen()) return;
    await delay(options.pollIntervalMs);
  }
  throw new Error(`Manual checkpoint aborted: ${prompt}`);
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
  return wrapTimelineError(error, failure);
}

function withArtifactAppState(failure: AgentVisibleFailure, artifacts: TimelineArtifactRef[]): AgentVisibleFailure {
  const screenshot = artifacts.find((artifact) => artifact.kind === TIMELINE_ARTIFACT_KIND_SCREENSHOT);
  const snapshot = artifacts.find((artifact) => artifact.kind === TIMELINE_ARTIFACT_KIND_SNAPSHOT);
  const diagnostics = artifacts.find((artifact) => artifact.kind === TIMELINE_ARTIFACT_KIND_DIAGNOSTICS);
  if (!screenshot && !snapshot && !diagnostics) return failure;
  return {
    ...failure,
    appState: {
      ...(failure.appState ?? {}),
      ...(screenshot ? { screenshotPath: screenshot.path } : {}),
      ...(snapshot ? { snapshotPath: snapshot.path } : {}),
      ...(diagnostics ? { diagnosticsPath: diagnostics.path } : {}),
    },
  };
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

async function defaultManualConfirm(prompt: string, options: { signal: AbortSignal }): Promise<void> {
  const dir = resolve(process.env.FLIWRIGHT_MANUAL_DIR ?? join(process.cwd(), '.fliwright', 'manual'));
  const id = `manual-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const requestPath = join(dir, `${id}.json`);
  const continuePath = join(dir, `${id}.continue.json`);
  const cancelPath = join(dir, `${id}.cancel.json`);
  await mkdir(dir, { recursive: true });
  await writeFile(requestPath, JSON.stringify({
    id,
    status: 'waiting',
    message: prompt,
    continueFile: continuePath,
    cancelFile: cancelPath,
    continueCommand: `touch ${shellQuote(continuePath)}`,
    cancelCommand: `touch ${shellQuote(cancelPath)}`,
    createdAt: new Date().toISOString(),
  }, null, 2));

  process.stdout.write([
    '',
    'Fliwright manual checkpoint is waiting for human input.',
    prompt,
    `Request: ${requestPath}`,
    `After completing the manual action, run: touch ${shellQuote(continuePath)}`,
    `To cancel this checkpoint, run: touch ${shellQuote(cancelPath)}`,
    '',
  ].join('\n'));

  while (!options.signal.aborted) {
    if (await fileExists(cancelPath)) {
      throw new Error(`Manual checkpoint cancelled: ${prompt}`);
    }
    if (await fileExists(continuePath)) {
      await writeFile(requestPath, JSON.stringify({
        id,
        status: 'continued',
        message: prompt,
        continueFile: continuePath,
        cancelFile: cancelPath,
        continuedAt: new Date().toISOString(),
      }, null, 2));
      return;
    }
    await delay(250);
  }
  throw new Error(`Manual checkpoint aborted: ${prompt}`);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:=@%+-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}
