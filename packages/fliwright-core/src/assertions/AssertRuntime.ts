import { Assertion, type AssertionOptions } from '../Assertion.js';
import type { Locator } from '../Locator.js';
import { MockRuntime } from '../mocks/MockRuntime.js';
import type { NormalizedRequestMatcher } from '../mocks/types.js';
import { runTimelineAssertion } from './AssertionTimeline.js';
import type {
  AssertRuntimeOptions,
  AssertionMetadata,
  RuntimeAssertionOptions,
} from './types.js';

const DEFAULT_TIMEOUT = 5_000;
const DEFAULT_INTERVAL = 100;

export class AssertRuntime {
  constructor(private readonly options: AssertRuntimeOptions = {}) {}

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
    return this.run(title, { matcher: 'count', target: locator.selectorString, expected }, options, async () => {
      const actual = await pollValue(() => locator.count(), (value) => value === expected, options);
      if (actual !== expected) throw new Error(`Expected ${locator.selectorString} to have count ${expected}, got ${actual}.`);
    });
  }

  request(title: string, matcher: NormalizedRequestMatcher, options?: RuntimeAssertionOptions): Promise<void> {
    return this.run(title, { matcher: 'request', target: describeMatcher(matcher), expected: matcher }, options, async () => {
      const actual = await pollValue(
        () => this.requireMock().findCalls(matcher),
        (calls) => calls.length > 0,
        options,
      );
      if (actual.length === 0) throw new Error(`Expected ${describeMatcher(matcher)} to be requested.`);
    });
  }

  noRequest(title: string, matcher: NormalizedRequestMatcher, options?: RuntimeAssertionOptions): Promise<void> {
    return this.run(title, { matcher: 'noRequest', target: describeMatcher(matcher), expected: matcher }, options, async () => {
      const actual = await this.requireMock().findCalls(matcher);
      if (actual.length > 0) throw new Error(`Expected ${describeMatcher(matcher)} not to be requested, got ${actual.length} call(s).`);
    });
  }

  requestCount(title: string, matcher: NormalizedRequestMatcher, expected: number, options?: RuntimeAssertionOptions): Promise<void> {
    return this.run(title, { matcher: 'requestCount', target: describeMatcher(matcher), expected }, options, async () => {
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
    return this.run(title, { matcher, target: locator.selectorString, ...(expected === undefined ? {} : { expected }) }, options, () => body({
      timeout: options?.timeout,
      includeScreenshot: options?.includeScreenshot,
      includeSnapshot: options?.includeSnapshot,
    }));
  }

  private async run(
    title: string,
    metadata: AssertionMetadata,
    options: RuntimeAssertionOptions | undefined,
    body: () => Promise<void>,
  ): Promise<void> {
    await runTimelineAssertion({
      title,
      metadata,
      recorder: this.options.recorder,
      page: this.options.page,
      artifactStore: this.options.artifactStore,
      includeScreenshot: options?.includeScreenshot,
      includeSnapshot: options?.includeSnapshot,
    }, body);
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

function describeMatcher(matcher: NormalizedRequestMatcher): string {
  const method = matcher.method?.toUpperCase();
  const path = matcher.path instanceof RegExp ? matcher.path.toString() : matcher.path;
  const url = matcher.url instanceof RegExp ? matcher.url.toString() : matcher.url;
  return [method, path ?? url].filter(Boolean).join(' ') || 'mock request';
}
