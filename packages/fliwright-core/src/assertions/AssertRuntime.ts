import { Assertion, AssertionError, type AssertionOptions } from '../Assertion.js';
import { FliwrightAgentError } from '../agent/FliwrightAgentError.js';
import type { Locator } from '../Locator.js';
import { MockRuntime } from '../mocks/MockRuntime.js';
import type { NormalizedRequestMatcher } from '../mocks/types.js';
import { TimelineRecorder } from '../timeline/TimelineRecorder.js';
import type { AgentVisibleFailure, TimelineArtifactRef } from '../timeline/types.js';
import {
  TIMELINE_ARTIFACT_KIND_SCREENSHOT,
  TIMELINE_ARTIFACT_KIND_SNAPSHOT,
} from '../timeline/constants.js';
import type {
  AssertRuntimeOptions,
  AssertionMetadata,
  RuntimeAssertionOptions,
} from './types.js';

const DEFAULT_TIMEOUT = 5_000;
const DEFAULT_INTERVAL = 100;

export class AssertRuntime {
  private readonly recorder?: TimelineRecorder;

  constructor(private readonly options: AssertRuntimeOptions = {}) {
    this.recorder = options.recorder;
  }

  visible(title: string, locator: Locator, options?: RuntimeAssertionOptions): Promise<void> {
    return this.runLocator(title, 'visible', locator, options, (assertionOptions) => new Assertion(locator).toBeVisible(assertionOptions));
  }

  hidden(title: string, locator: Locator, options?: RuntimeAssertionOptions): Promise<void> {
    return this.runLocator(title, 'hidden', locator, options, (assertionOptions) => new Assertion(locator, true).toBeVisible(assertionOptions));
  }

  enabled(title: string, locator: Locator, options?: RuntimeAssertionOptions): Promise<void> {
    return this.runLocator(title, 'enabled', locator, options, (assertionOptions) => new Assertion(locator).toBeEnabled(assertionOptions));
  }

  disabled(title: string, locator: Locator, options?: RuntimeAssertionOptions): Promise<void> {
    return this.runLocator(title, 'disabled', locator, options, (assertionOptions) => new Assertion(locator, true).toBeEnabled(assertionOptions));
  }

  text(title: string, locator: Locator, expected: string, options?: RuntimeAssertionOptions): Promise<void> {
    return this.runLocator(title, 'text', locator, options, (assertionOptions) => new Assertion(locator).toHaveText(expected, assertionOptions), expected);
  }

  containsText(title: string, locator: Locator, expected: string, options?: RuntimeAssertionOptions): Promise<void> {
    return this.runLocator(title, 'containsText', locator, options, (assertionOptions) => new Assertion(locator).toContainText(expected, assertionOptions), expected);
  }

  count(title: string, locator: Locator, expected: number, options?: RuntimeAssertionOptions): Promise<void> {
    return this.run(title, { matcher: 'count', target: locator.selectorString, expected }, async () => {
      const actual = await pollValue(() => locator.count(), (value) => value === expected, options);
      if (actual !== expected) throw new Error(`Expected ${locator.selectorString} to have count ${expected}, got ${actual}.`);
    });
  }

  request(title: string, matcher: NormalizedRequestMatcher, options?: RuntimeAssertionOptions): Promise<void> {
    return this.run(title, { matcher: 'request', target: describeMatcher(matcher), expected: matcher }, async () => {
      const actual = await pollValue(
        () => this.requireMock().findCalls(matcher),
        (calls) => calls.length > 0,
        options,
      );
      if (actual.length === 0) throw new Error(`Expected ${describeMatcher(matcher)} to be requested.`);
    });
  }

  noRequest(title: string, matcher: NormalizedRequestMatcher, options?: RuntimeAssertionOptions): Promise<void> {
    return this.run(title, { matcher: 'noRequest', target: describeMatcher(matcher), expected: matcher }, async () => {
      const actual = await this.requireMock().findCalls(matcher);
      if (actual.length > 0) throw new Error(`Expected ${describeMatcher(matcher)} not to be requested, got ${actual.length} call(s).`);
    });
  }

  requestCount(title: string, matcher: NormalizedRequestMatcher, expected: number, options?: RuntimeAssertionOptions): Promise<void> {
    return this.run(title, { matcher: 'requestCount', target: describeMatcher(matcher), expected }, async () => {
      const actual = await pollValue(
        () => this.requireMock().findCalls(matcher),
        (calls) => calls.length === expected,
        options,
      );
      if (actual.length !== expected) throw new Error(`Expected ${describeMatcher(matcher)} to be requested ${expected} time(s), got ${actual.length}.`);
    });
  }

  private runLocator(
    title: string,
    matcher: string,
    locator: Locator,
    options: RuntimeAssertionOptions | undefined,
    body: (options: AssertionOptions) => Promise<void>,
    expected?: unknown,
  ): Promise<void> {
    return this.run(title, { matcher, target: locator.selectorString, ...(expected === undefined ? {} : { expected }) }, () => body({
      timeout: options?.timeout,
      includeScreenshot: options?.includeScreenshot,
      includeSnapshot: options?.includeSnapshot,
    }));
  }

  private async run(title: string, metadata: AssertionMetadata, body: () => Promise<void>): Promise<void> {
    const node = this.recorder?.startNode('assertion', title, { metadata });
    try {
      await body();
      if (node) this.recorder?.passNode(node.id);
    } catch (error) {
      const artifacts = node ? await this.captureFailureArtifacts(node.id) : [];
      if (node && artifacts.length) this.recorder?.addArtifacts(node.id, artifacts);
      const failure = createAssertionFailure(error, title, node?.id, metadata, artifacts);
      if (node) this.recorder?.failNode(node.id, failure, { ...metadata, actual: assertionActual(error) });
      throw error instanceof FliwrightAgentError ? error : new FliwrightAgentError(failure, { cause: error });
    }
  }

  private async captureFailureArtifacts(nodeId: string): Promise<TimelineArtifactRef[]> {
    const { page, artifactStore } = this.options;
    if (!page || !artifactStore) return [];

    const artifacts: TimelineArtifactRef[] = [];
    try {
      artifacts.push(await artifactStore.writeScreenshot(nodeId, await page.screenshot()));
    } catch {
      // Failure artifacts are best-effort and must not mask the assertion error.
    }
    try {
      artifacts.push(await artifactStore.writeSnapshot(nodeId, await page.snapshot()));
    } catch {
      // Failure artifacts are best-effort and must not mask the assertion error.
    }
    return artifacts;
  }

  private requireMock(): MockRuntime {
    if (!this.options.mock) throw new Error('MockRuntime is required for request assertions.');
    return this.options.mock;
  }
}

async function pollValue<T>(read: () => Promise<T>, matches: (value: T) => boolean, options?: RuntimeAssertionOptions): Promise<T> {
  const timeout = Math.max(0, options?.timeout ?? DEFAULT_TIMEOUT);
  const interval = Math.max(1, options?.interval ?? DEFAULT_INTERVAL);
  const startedAt = Date.now();
  let value = await read();
  while (!matches(value) && Date.now() - startedAt < timeout) {
    await new Promise((resolve) => setTimeout(resolve, interval));
    value = await read();
  }
  return value;
}

function createAssertionFailure(
  error: unknown,
  title: string,
  timelineNodeId?: string,
  metadata: AssertionMetadata = { matcher: 'unknown' },
  artifacts: TimelineArtifactRef[] = [],
): AgentVisibleFailure {
  const screenshot = artifacts.find((artifact) => artifact.kind === TIMELINE_ARTIFACT_KIND_SCREENSHOT);
  const snapshot = artifacts.find((artifact) => artifact.kind === TIMELINE_ARTIFACT_KIND_SNAPSHOT);
  return {
    code: 'assertion_failed',
    title,
    message: error instanceof Error ? error.message : String(error),
    timelineNodeId,
    appState: {
      ...(screenshot ? { screenshotPath: screenshot.path } : {}),
      ...(snapshot ? { snapshotPath: snapshot.path } : {}),
    },
    actionContext: {
      action: metadata.matcher,
      target: metadata.target,
    },
    recoveryHints: [
      { kind: 'observe', description: 'Inspect the current app state and timeline artifacts.' },
      { kind: 'retry', description: 'Retry after the app has settled.' },
    ],
  };
}

function assertionActual(error: unknown): unknown {
  if (error instanceof AssertionError) return error.actual;
  return error instanceof Error ? error.message : String(error);
}

function describeMatcher(matcher: NormalizedRequestMatcher): string {
  const method = matcher.method?.toUpperCase();
  const path = matcher.path instanceof RegExp ? matcher.path.toString() : matcher.path;
  const url = matcher.url instanceof RegExp ? matcher.url.toString() : matcher.url;
  return [method, path ?? url].filter(Boolean).join(' ') || 'mock request';
}
