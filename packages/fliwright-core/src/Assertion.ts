import { widgetCheckedState, type Locator } from './Locator.js';
import type { Page } from './Page.js';
import type { WidgetSnapshot } from './types.js';
import type { FailureCollector } from './FailureCollector.js';
import type { SelfHealingEngine } from './SelfHealingEngine.js';
import { FliwrightAgentError } from './agent/FliwrightAgentError.js';
import type { TimelineArtifactStore } from './timeline/TimelineArtifactStore.js';
import type { TimelineRecorder } from './timeline/TimelineRecorder.js';
import type { AgentVisibleFailure, TimelineArtifactRef } from './timeline/types.js';

const DEFAULT_TIMEOUT = 5000;
const DEFAULT_INTERVAL = 100;

/**
 * Error thrown when an assertion fails after polling.
 */
export class AssertionError extends Error {
  readonly matcher: string;
  readonly expected: string;
  readonly actual: string;
  readonly selector: string;

  constructor(matcher: string, expected: string, actual: string, selector: string) {
    super(`${matcher} failed for "${selector}": expected ${expected}, got ${actual}`);
    this.name = 'AssertionError';
    this.matcher = matcher;
    this.expected = expected;
    this.actual = actual;
    this.selector = selector;
  }
}

export interface AssertionOptions {
  timeout?: number;
  title?: string;
  includeScreenshot?: boolean;
  includeSnapshot?: boolean;
}

export interface AssertionTimelineOptions {
  title?: string;
  recorder?: TimelineRecorder;
  artifactStore?: TimelineArtifactStore;
  page?: Page;
}

/**
 * Playwright-style auto-wait polling assertion wrapper for a Locator.
 */
export class Assertion {
  private readonly locator: Locator;
  private readonly negated: boolean;
  private readonly failureCollector: FailureCollector | null;
  private readonly healingEngine: SelfHealingEngine | null;
  private readonly testName: string | null;
  private readonly sendRequest: ((method: string, params?: Record<string, unknown>) => Promise<unknown>) | null;
  private readonly timeline: AssertionTimelineOptions | null;

  constructor(
    locator: Locator,
    negated = false,
    failureCollector?: FailureCollector,
    healingEngine?: SelfHealingEngine,
    testName?: string,
    sendRequest?: (method: string, params?: Record<string, unknown>) => Promise<unknown>,
    timeline?: AssertionTimelineOptions,
  ) {
    this.locator = locator;
    this.negated = negated;
    this.failureCollector = failureCollector ?? null;
    this.healingEngine = healingEngine ?? null;
    this.testName = testName ?? null;
    this.sendRequest = sendRequest ?? null;
    this.timeline = timeline ?? null;
  }

  /** Negates the next assertion. */
  get not(): Assertion {
    return new Assertion(
      this.locator,
      true,
      this.failureCollector ?? undefined,
      this.healingEngine ?? undefined,
      this.testName ?? undefined,
      this.sendRequest ?? undefined,
      this.timeline ?? undefined,
    );
  }

  private async attemptHealing(matcher: string, options?: { timeout?: number }): Promise<boolean> {
    if (!this.healingEngine || !this.testName || !this.sendRequest || this.negated) {
      return false;
    }
    try {
      const result = await this.healingEngine.tryHeal(
        this.locator,
        this.testName,
        {
          assertion: { matcher, expected: '', actual: '', timeout: options?.timeout ?? 5000 },
          screenshot: null,
          widgetTree: {},
          source: { file: '', line: 0, snippet: '' },
          timestamp: new Date().toISOString(),
        },
        () => this.fetchSnapshotWidgets(),
      );

      if (result.healed && result.report) {
        const { Locator } = await import('./Locator.js');
        const newLocator = new Locator(result.report.suggestedSelector, this.sendRequest!, this.timeline ?? undefined);
        const healedAssertion = new Assertion(
          newLocator,
          false,
          this.failureCollector ?? undefined,
          this.healingEngine ?? undefined,
          this.testName ?? undefined,
          this.sendRequest ?? undefined,
          this.timeline ?? undefined,
        );
        await healedAssertion.toBeVisible(options);
        return true;
      }
    } catch {
      // Healing failed — will throw original error.
    }
    return false;
  }

  /** Tracks which (testName, selector) pairs have already been snapshotted to avoid redundant RPCs. */
  private static readonly _snapshotCache = new Set<string>();

  private async recordSuccessSnapshot(): Promise<void> {
    if (!this.healingEngine || !this.testName || !this.sendRequest || this.negated) {
      return;
    }
    const cacheKey = `${this.testName}::${this.locator.selectorString}`;
    if (Assertion._snapshotCache.has(cacheKey)) {
      return;
    }
    try {
      await this.healingEngine.recordSuccess(
        this.locator,
        this.testName,
        () => this.fetchSnapshotWidgets(),
      );
      Assertion._snapshotCache.add(cacheKey);
    } catch {
      // Snapshot capture is best-effort and must never fail a passing assertion.
    }
  }

  private async fetchSnapshotWidgets(): Promise<WidgetSnapshot[]> {
    const resp = await this.sendRequest!('ext.fliwright.snapshot', {}) as { widgets?: WidgetSnapshot[] };
    return resp.widgets ?? [];
  }

  /** Asserts that the element is visible. */
  async toBeVisible(options?: AssertionOptions): Promise<void> {
    return this.runWithTimeline('toBeVisible', this.negated ? 'not visible' : 'visible', options, async () => {
      await this.checkVisible(options);
    });
  }

  private async checkVisible(options?: AssertionOptions): Promise<void> {
    const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
    const selector = this.locator.selectorString;

    const passed = await pollUntil(
      () => this.locator.isVisible(),
      (visible) => (this.negated ? !visible : visible),
      timeout,
    );

    if (passed) {
      await this.recordSuccessSnapshot();
      return;
    }

    // Try self-healing before throwing (only for non-negated assertions).
    if (!this.negated) {
      const healed = await this.attemptHealing('toBeVisible', options);
      if (healed) return;
    }

    const lastValue = await this.locator.isVisible();
    if (this.negated) {
      throw new AssertionError('toBeVisible', 'not visible', `visible=${lastValue}`, selector);
    } else {
      throw new AssertionError('toBeVisible', 'visible', `visible=${lastValue}`, selector);
    }
  }

  /** Asserts that the element has the exact text. */
  async toHaveText(text: string, options?: AssertionOptions): Promise<void> {
    return this.runWithTimeline('toHaveText', this.negated ? `not "${text}"` : `"${text}"`, options, async () => {
      await this.checkText(text, options);
    });
  }

  private async checkText(text: string, options?: AssertionOptions): Promise<void> {
    const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
    const selector = this.locator.selectorString;

    const getText = async (): Promise<string | undefined> => {
      return (await this.locator.resolve())?.text;
    };

    const passed = await pollUntil(
      () => getText(),
      (actual) => {
        const match = actual === text;
        return this.negated ? !match : match;
      },
      timeout,
    );

    if (!passed) {
      const actual = await getText();
      if (this.negated) {
        throw new AssertionError('toHaveText', `not "${text}"`, `"${actual ?? ''}"`, selector);
      } else {
        throw new AssertionError('toHaveText', `"${text}"`, `"${actual ?? ''}"`, selector);
      }
    }
  }

  /** Asserts that the element contains the given text substring. */
  async toContainText(text: string, options?: AssertionOptions): Promise<void> {
    return this.runWithTimeline('toContainText', this.negated ? `not containing "${text}"` : `containing "${text}"`, options, async () => {
      await this.checkContainsText(text, options);
    });
  }

  private async checkContainsText(text: string, options?: AssertionOptions): Promise<void> {
    const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
    const selector = this.locator.selectorString;

    const getText = async (): Promise<string | undefined> => {
      return (await this.locator.resolve())?.text;
    };

    const passed = await pollUntil(
      () => getText(),
      (actual) => {
        const match = actual !== undefined && actual.includes(text);
        return this.negated ? !match : match;
      },
      timeout,
    );

    if (!passed) {
      const actual = await getText();
      if (this.negated) {
        throw new AssertionError('toContainText', `not containing "${text}"`, `"${actual ?? ''}"`, selector);
      } else {
        throw new AssertionError('toContainText', `containing "${text}"`, `"${actual ?? ''}"`, selector);
      }
    }
  }

  /** Asserts that the element is enabled. */
  async toBeEnabled(options?: AssertionOptions): Promise<void> {
    return this.runWithTimeline('toBeEnabled', this.negated ? 'disabled' : 'enabled', options, async () => {
      await this.checkEnabled(options);
    });
  }

  private async checkEnabled(options?: AssertionOptions): Promise<void> {
    const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
    const selector = this.locator.selectorString;

    const getEnabled = async (): Promise<boolean> => {
      const widget = await this.locator.resolve();
      return (widget?.properties?.enabled ?? true) as boolean;
    };

    const passed = await pollUntil(
      () => getEnabled(),
      (enabled) => {
        const match = enabled;
        return this.negated ? !match : match;
      },
      timeout,
    );

    if (!passed) {
      const actual = await getEnabled();
      if (this.negated) {
        throw new AssertionError('toBeEnabled', 'disabled', `enabled=${actual}`, selector);
      } else {
        throw new AssertionError('toBeEnabled', 'enabled', `enabled=${actual}`, selector);
      }
    }
  }

  /** Asserts that the element is disabled. */
  async toBeDisabled(options?: AssertionOptions): Promise<void> {
    return this.runWithTimeline('toBeDisabled', this.negated ? 'enabled' : 'disabled', options, async () => {
      const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
      const selector = this.locator.selectorString;

      const getEnabled = async (): Promise<boolean> => {
        const widget = await this.locator.resolve();
        return (widget?.properties?.enabled ?? true) as boolean;
      };

      const passed = await pollUntil(
        () => getEnabled(),
        (enabled) => {
          const match = !enabled;
          return this.negated ? !match : match;
        },
        timeout,
      );

      if (!passed) {
        const actual = await getEnabled();
        if (this.negated) {
          throw new AssertionError('toBeDisabled', 'enabled', `enabled=${actual}`, selector);
        } else {
          throw new AssertionError('toBeDisabled', 'disabled', `enabled=${actual}`, selector);
        }
      }
    });
  }

  /** Asserts that the element is checked, toggled, or selected. */
  async toBeChecked(options?: AssertionOptions): Promise<void> {
    return this.runWithTimeline('toBeChecked', this.negated ? 'unchecked' : 'checked', options, async () => {
      await this.checkChecked(options);
    });
  }

  private async checkChecked(options?: AssertionOptions): Promise<void> {
    const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
    const selector = this.locator.selectorString;

    const getChecked = async (): Promise<boolean | undefined> => {
      return widgetCheckedState(await this.locator.resolve());
    };

    const passed = await pollUntil(
      () => getChecked(),
      (checked) => {
        const match = checked === true;
        return this.negated ? !match : match;
      },
      timeout,
    );

    if (!passed) {
      const actual = await getChecked();
      if (this.negated) {
        throw new AssertionError('toBeChecked', 'unchecked', `checked=${actual}`, selector);
      } else {
        throw new AssertionError('toBeChecked', 'checked', `checked=${actual}`, selector);
      }
    }
  }

  private async runWithTimeline(
    matcher: string,
    expected: unknown,
    options: AssertionOptions | undefined,
    body: () => Promise<void>,
  ): Promise<void> {
    const recorder = this.timeline?.recorder;
    if (!recorder) {
      await body();
      return;
    }

    const title = options?.title ?? this.timeline?.title ?? `${matcher} ${this.locator.selectorString}`;
    const metadata = {
      matcher,
      target: this.locator.selectorString,
      expected,
      ...(this.negated ? { negated: true } : {}),
    };
    const node = recorder.startNode('assertion', title, { metadata });
    try {
      await body();
      recorder.passNode(node.id);
    } catch (error) {
      const artifacts = await this.captureFailureArtifacts(node.id, options);
      if (artifacts.length) recorder.addArtifacts(node.id, artifacts);
      const failure = createAssertionFailure(error, title, node.id, metadata, artifacts);
      recorder.failNode(node.id, failure, { ...metadata, actual: assertionActual(error) });
      throw new FliwrightAgentError(failure, { cause: error });
    }
  }

  private async captureFailureArtifacts(nodeId: string, options?: AssertionOptions): Promise<TimelineArtifactRef[]> {
    const page = this.timeline?.page;
    const store = this.timeline?.artifactStore;
    if (!page || !store) return [];
    const artifacts: TimelineArtifactRef[] = [];
    try {
      if (options?.includeScreenshot !== false && typeof page.screenshot === 'function') {
        artifacts.push(await store.writeScreenshot(nodeId, await page.screenshot()));
      }
    } catch {
      // Best effort only.
    }
    try {
      if (options?.includeSnapshot !== false && typeof page.snapshot === 'function') {
        artifacts.push(await store.writeSnapshot(nodeId, await page.snapshot()));
      }
    } catch {
      // Best effort only.
    }
    return artifacts;
  }
}

/**
 * Creates an Assertion for the given Locator (Playwright-style `expect`).
 */
export function createExpect(
  locator: Locator,
  failureCollector?: FailureCollector,
  timeline?: AssertionTimelineOptions,
): Assertion {
  return new Assertion(locator, false, failureCollector, undefined, undefined, undefined, timeline);
}

function createAssertionFailure(
  error: unknown,
  title: string,
  timelineNodeId: string,
  metadata: Record<string, unknown>,
  artifacts: TimelineArtifactRef[],
): AgentVisibleFailure {
  const message = error instanceof Error ? error.message : String(error);
  const screenshot = artifacts.find((artifact) => artifact.kind === 'screenshot');
  const snapshot = artifacts.find((artifact) => artifact.kind === 'snapshot');
  return {
    code: 'assertion_failed',
    title,
    message,
    timelineNodeId,
    appState: {
      ...(screenshot ? { screenshotPath: screenshot.path } : {}),
      ...(snapshot ? { snapshotPath: snapshot.path } : {}),
    },
    actionContext: {
      action: String(metadata.matcher),
      target: typeof metadata.target === 'string' ? metadata.target : undefined,
    },
    recoveryHints: [
      { kind: 'observe', description: 'Inspect the current screen and semantic snapshot around the failed assertion.' },
      { kind: 'retry', description: 'Retry after the UI has settled if the expected state is asynchronous.' },
      { kind: 'manual', description: 'Check whether the assertion target or expected value still matches the app behavior.' },
    ],
  };
}

function assertionActual(error: unknown): unknown {
  if (error instanceof AssertionError) return error.actual;
  return error instanceof Error ? error.message : String(error);
}

/**
 * Polls `getValue` every `interval` ms until `check` returns true or timeout.
 * Returns true if the check passed, false if timed out.
 */
function pollUntil<T>(
  getValue: () => Promise<T>,
  check: (value: T) => boolean,
  timeout: number,
  interval: number = DEFAULT_INTERVAL,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const start = Date.now();

    const tick = async () => {
      try {
        const value = await getValue();
        if (check(value)) {
          resolve(true);
          return;
        }
      } catch {
        // Ignore errors during polling — retry on next tick.
      }

      if (Date.now() - start >= timeout) {
        resolve(false);
        return;
      }

      setTimeout(tick, interval);
    };

    tick();
  });
}
