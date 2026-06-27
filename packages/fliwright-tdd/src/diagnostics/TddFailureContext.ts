import type { ResetCategory, TddCycleResult } from '../types.js';

export type TddFailureKind =
  | 'missing-element'
  | 'ambiguous-element'
  | 'wrong-text'
  | 'navigation-failed'
  | 'mock-not-called'
  | 'state-mismatch'
  | 'timeout'
  | 'disconnected'
  | 'test-error';

export interface TddFailureContext {
  kind: TddFailureKind;
  message: string;
  testFile: string;
  testName?: string;
  lastSync?: TddCycleResult['lastSync'];
  baselineVersion?: number;
  unsupportedState?: ResetCategory[];
  source?: TddFailureSource;
  assertion?: TddFailureAssertion;
  artifacts?: TddFailureArtifacts;
  recoveryHints?: TddRecoveryHint[];
}

export type TddRecoveryHintKind =
  | 'inspect-source'
  | 'inspect-snapshot'
  | 'refine-selector'
  | 'disambiguate-selector'
  | 'check-navigation'
  | 'configure-mock'
  | 'seed-state'
  | 'sync-app'
  | 'increase-timeout'
  | 'reconnect'
  | 'configure-reset-adapter';

export interface TddRecoveryHint {
  kind: TddRecoveryHintKind;
  priority: 'high' | 'medium' | 'low';
  message: string;
  actions: string[];
}

export interface BuildTddFailureContextInput {
  file: string;
  testName?: string;
  message?: string;
  /** Override the heuristic classification (e.g. an explicit cycle timeout / disconnect). */
  kind?: TddFailureKind;
  lastSync?: TddCycleResult['lastSync'];
  baselineVersion?: number;
  unsupportedState?: ResetCategory[];
  source?: TddFailureSource;
  assertion?: TddFailureAssertion;
  artifacts?: TddFailureArtifacts;
}

export interface TddFailureSource {
  file: string;
  line: number;
  snippet: string;
}

export interface TddFailureAssertion {
  matcher: string;
  expected: string;
  actual: string;
  timeout: number;
}

export interface TddFailureArtifacts {
  failureContextPath?: string;
  screenshotPath?: string;
  screenshotBase64?: string;
  widgetTree?: unknown;
  timelinePath?: string;
  timelineNodeId?: string;
}

export function buildTddFailureContext(input: BuildTddFailureContextInput): TddFailureContext {
  const message = input.message?.trim() || 'Focused TDD test failed without a structured failure message.';
  const kind = input.kind ?? classifyFailure(message);

  const context: TddFailureContext = {
    kind,
    message,
    testFile: input.file,
    testName: input.testName,
    lastSync: input.lastSync,
    baselineVersion: input.baselineVersion,
    unsupportedState: input.unsupportedState?.length ? input.unsupportedState : undefined,
    source: input.source,
    assertion: input.assertion,
    artifacts: input.artifacts,
  };
  const recoveryHints = buildRecoveryHints(context);
  return {
    ...context,
    recoveryHints: recoveryHints.length > 0 ? recoveryHints : undefined,
  };
}

export function classifyFailure(message: string): TddFailureKind {
  const normalized = message.toLowerCase();
  if (
    normalized.includes('strict mode violation')
    || normalized.includes('multiple widgets')
    || normalized.includes('ambiguous')
  ) {
    return 'ambiguous-element';
  }
  if (
    normalized.includes('no widget found')
    || normalized.includes('could not find')
    || normalized.includes('not found')
    || normalized.includes('tobevisible')
    || normalized.includes('to be visible')
  ) {
    return 'missing-element';
  }
  if (
    normalized.includes('currentroute')
    || normalized.includes('reset route')
    || normalized.includes('route')
    || normalized.includes('navigation')
  ) {
    return 'navigation-failed';
  }
  if (
    normalized.includes('tohavetext')
    || normalized.includes('tocontaintext')
    || (normalized.includes('expected') && normalized.includes('received'))
  ) {
    return 'wrong-text';
  }
  if (
    normalized.includes('waitforcall')
    || normalized.includes('recorded calls')
    || normalized.includes('mock')
    || normalized.includes('called at least')
  ) {
    return 'mock-not-called';
  }
  if (normalized.includes('state') || normalized.includes('provider')) {
    return 'state-mismatch';
  }
  return 'test-error';
}

function buildRecoveryHints(context: TddFailureContext): TddRecoveryHint[] {
  const hints: TddRecoveryHint[] = [];

  if (context.unsupportedState?.length) {
    hints.push({
      kind: 'configure-reset-adapter',
      priority: 'high',
      message: `Baseline reset could not fully control: ${context.unsupportedState.join(', ')}.`,
      actions: [
        'Add the missing host app reset handler/capability, or remove the unsupported category from the scenario while iterating.',
        'If the category is required for determinism, configure it before trusting a green result.',
      ],
    });
  }

  if (context.source) {
    hints.push({
      kind: 'inspect-source',
      priority: 'medium',
      message: `Inspect the failing test source at ${context.source.file}:${context.source.line}.`,
      actions: [
        'Open the reported source line and compare the assertion or locator with the current app snapshot.',
        'Prefer fixing stale generated test code before changing app behavior.',
      ],
    });
  }

  if (context.artifacts?.screenshotPath || context.artifacts?.widgetTree || context.artifacts?.timelinePath) {
    hints.push({
      kind: 'inspect-snapshot',
      priority: 'medium',
      message: 'Use the captured artifacts to compare expected UI with the actual rendered app state.',
      actions: [
        'Inspect screenshot, widget tree, or timeline artifacts before editing code.',
        'If the UI is correct but the locator is stale, update the generated test selector.',
      ],
    });
  }

  switch (context.kind) {
    case 'missing-element':
      hints.push({
        kind: 'refine-selector',
        priority: 'high',
        message: 'The generated test is looking for a widget that is not currently discoverable.',
        actions: [
          'Capture a fresh fliwright_snap and replace brittle text/type selectors with key or semantics selectors when available.',
          'If the widget should exist but does not render, fix the app state/setup before changing the assertion.',
        ],
      });
      maybeSuggestSync(hints, context);
      break;
    case 'ambiguous-element':
      hints.push({
        kind: 'disambiguate-selector',
        priority: 'high',
        message: 'The locator matches multiple widgets.',
        actions: [
          'Narrow the selector using a stable key, semantics label, ancestor scope, or visible text unique to the intended widget.',
          'Avoid broad text/type locators in generated tests when several widgets share the same label.',
        ],
      });
      break;
    case 'wrong-text':
      hints.push({
        kind: 'inspect-source',
        priority: 'high',
        message: 'The assertion expected different text or value than the app produced.',
        actions: [
          'Decide whether the generated expectation is stale or the product behavior is wrong.',
          'Update the test only when the current app output is the intended behavior.',
        ],
      });
      break;
    case 'navigation-failed':
      hints.push({
        kind: 'check-navigation',
        priority: 'high',
        message: 'The app is not on the expected route or reset route.',
        actions: [
          'Check scenario.homeRoute and any navigation preconditions in the generated test.',
          'If routing code changed, rerun with sync:auto or restart before editing assertions.',
        ],
      });
      break;
    case 'mock-not-called':
      hints.push({
        kind: 'configure-mock',
        priority: 'high',
        message: 'The expected mocked endpoint was not called or did not match the active mock profile.',
        actions: [
          'Verify the mock endpoint, HTTP method, active rule, and mockProfile used by the scenario.',
          'Check whether the app reached the action that should trigger the request.',
        ],
      });
      break;
    case 'state-mismatch':
      hints.push({
        kind: 'seed-state',
        priority: 'high',
        message: 'The app state does not match the test precondition.',
        actions: [
          'Seed required storage/Riverpod/app state through the scenario before the cycle.',
          'If reset categories are unsupported, configure the host app reset contract first.',
        ],
      });
      break;
    case 'timeout':
      hints.push({
        kind: 'increase-timeout',
        priority: 'medium',
        message: 'The cycle exceeded its wall-clock budget.',
        actions: [
          'Inspect whether the app is stuck, a locator wait is too broad, or the timeoutMs budget is too small.',
          'Keep the next cycle serialized; do not start a second runtime while the previous body is finishing.',
        ],
      });
      break;
    case 'disconnected':
      hints.push({
        kind: 'reconnect',
        priority: 'high',
        message: 'The Flutter VM service connection appears disconnected.',
        actions: [
          'Call fliwright_tdd_reconnect, then rerun the focused cycle.',
          'If reconnect fails, restart the app/runtime and preserve the generated test file.',
        ],
      });
      break;
    case 'test-error':
      hints.push({
        kind: 'inspect-source',
        priority: 'high',
        message: 'The failure is not recognized as a selector, mock, navigation, state, or timeout issue.',
        actions: [
          'Read the raw error and failing source line before editing.',
          'If this is a compile/runtime error, fix the test or app code and rerun the same focused cycle.',
        ],
      });
      break;
    default:
      break;
  }

  return dedupeHints(hints);
}

function maybeSuggestSync(hints: TddRecoveryHint[], context: TddFailureContext): void {
  if (context.lastSync === 'restart') return;
  hints.push({
    kind: 'sync-app',
    priority: 'low',
    message: 'A missing widget can be caused by stale hot-reload state after structural app changes.',
    actions: [
      'If app structure, generated code, assets, or providers changed, rerun with sync:auto or sync:restart.',
    ],
  });
}

function dedupeHints(hints: TddRecoveryHint[]): TddRecoveryHint[] {
  const seen = new Set<string>();
  return hints.filter((hint) => {
    const key = `${hint.kind}:${hint.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
