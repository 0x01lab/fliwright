import type { Locator } from './Locator.js';
import type { WidgetInfo } from './types.js';
import type { FailureCollector } from './FailureCollector.js';

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

  constructor(locator: Locator, negated = false, failureCollector?: FailureCollector) {
    this.locator = locator;
    this.negated = negated;
    this.failureCollector = failureCollector ?? null;
  }

  /** Negates the next assertion. */
  get not(): Assertion {
    return new Assertion(this.locator, true, this.failureCollector ?? undefined);
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

    if (!passed) {
      const lastValue = await this.locator.isVisible();
      if (this.negated) {
        throw new AssertionError('toBeVisible', 'not visible', `visible=${lastValue}`, selector);
      } else {
        throw new AssertionError('toBeVisible', 'visible', `visible=${lastValue}`, selector);
      }
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
    const negatedAssertion = new Assertion(this.locator, !this.negated);
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
