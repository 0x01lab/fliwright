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

  return {
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
