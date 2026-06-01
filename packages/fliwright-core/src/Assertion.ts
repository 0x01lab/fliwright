import type { Locator } from './Locator.js';
import type { WidgetInfo, WidgetSnapshot } from './types.js';
import type { FailureCollector } from './FailureCollector.js';
import type { SelfHealingEngine } from './SelfHealingEngine.js';

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

  constructor(
    locator: Locator,
    negated = false,
    failureCollector?: FailureCollector,
    healingEngine?: SelfHealingEngine,
    testName?: string,
    sendRequest?: (method: string, params?: Record<string, unknown>) => Promise<unknown>,
  ) {
    this.locator = locator;
    this.negated = negated;
    this.failureCollector = failureCollector ?? null;
    this.healingEngine = healingEngine ?? null;
    this.testName = testName ?? null;
    this.sendRequest = sendRequest ?? null;
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
        const newLocator = new Locator(result.report.suggestedSelector, this.sendRequest!);
        const healedAssertion = new Assertion(newLocator, false, this.failureCollector ?? undefined);
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
  async toBeVisible(options?: { timeout?: number }): Promise<void> {
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
  async toHaveText(text: string, options?: { timeout?: number }): Promise<void> {
    const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
    const selector = this.locator.selectorString;

    const getText = async (): Promise<string | undefined> => {
      const widgets = await (this.locator as any)._resolve() as WidgetInfo[];
      return widgets[0]?.text;
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
  async toContainText(text: string, options?: { timeout?: number }): Promise<void> {
    const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
    const selector = this.locator.selectorString;

    const getText = async (): Promise<string | undefined> => {
      const widgets = await (this.locator as any)._resolve() as WidgetInfo[];
      return widgets[0]?.text;
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
  async toBeEnabled(options?: { timeout?: number }): Promise<void> {
    const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
    const selector = this.locator.selectorString;

    const getEnabled = async (): Promise<boolean> => {
      const widgets = await (this.locator as any)._resolve() as WidgetInfo[];
      return (widgets[0]?.properties?.enabled ?? true) as boolean;
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
  async toBeDisabled(options?: { timeout?: number }): Promise<void> {
    const negatedAssertion = new Assertion(
      this.locator,
      !this.negated,
      this.failureCollector ?? undefined,
      this.healingEngine ?? undefined,
      this.testName ?? undefined,
      this.sendRequest ?? undefined,
    );
    await negatedAssertion.toBeEnabled(options);
  }
}

/**
 * Creates an Assertion for the given Locator (Playwright-style `expect`).
 */
export function createExpect(locator: Locator, failureCollector?: FailureCollector): Assertion {
  return new Assertion(locator, false, failureCollector);
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
