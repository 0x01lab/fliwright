import type { RecordedOperation, ResolvedSelector } from './types.js';
import type { RecordingResult } from './RecorderController.js';
import { recordingInputParameters } from './RecordingInputs.js';

export type AutomationKind = 'script' | 'test';
export type RecordingReadiness = 'draft' | 'generated' | 'verified';
export type RecordingLanguage = 'ts' | 'dart';

export interface DartVerificationEvidence {
  status: 'passed' | 'failed';
  runId: string;
  contentFingerprint: string;
  appEntrypoint: string;
  platform: string;
  artifactPath?: string;
  issues?: string[];
}

/** Validate imported compiler/replay evidence before it can affect a recording. */
export function parseDartVerificationEvidence(value: unknown): DartVerificationEvidence {
  const evidence = value as Partial<DartVerificationEvidence> | null;
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)
    || (evidence.status !== 'passed' && evidence.status !== 'failed')
    || typeof evidence.runId !== 'string' || !evidence.runId.trim()
    || typeof evidence.contentFingerprint !== 'string' || !evidence.contentFingerprint.trim()
    || typeof evidence.appEntrypoint !== 'string'
    || !/^package:[a-z][a-z0-9_]*\/[a-zA-Z0-9_/-]+\.dart$/.test(evidence.appEntrypoint)
    || typeof evidence.platform !== 'string' || !evidence.platform.trim()
    || (evidence.artifactPath !== undefined && typeof evidence.artifactPath !== 'string')
    || (evidence.issues !== undefined && (!Array.isArray(evidence.issues)
      || evidence.issues.some((issue) => typeof issue !== 'string')))) {
    throw new Error('Invalid Dart verification evidence; expected compiler/replay status, run identity, content fingerprint, app entrypoint and platform.');
  }
  return { status: evidence.status, runId: evidence.runId, contentFingerprint: evidence.contentFingerprint,
    appEntrypoint: evidence.appEntrypoint, platform: evidence.platform,
    ...(evidence.artifactPath !== undefined ? { artifactPath: evidence.artifactPath } : {}),
    ...(evidence.issues !== undefined ? { issues: [...evidence.issues] } : {}),
  };
}

export interface RecordingReadinessResult {
  automationKind: AutomationKind;
  language?: RecordingLanguage;
  readiness: RecordingReadiness;
  issues: string[];
  contentFingerprint?: string;
  scenarioFingerprint?: string;
  verifiedRunId?: string;
  /** Last replay, retained even when verification failed. */
  replayRunId?: string;
  requiredInputParameters?: string[];
  dartVerification?: DartVerificationEvidence;
  dartAppEntrypoint?: string;
}

export interface AssessRecordingReadinessOptions {
  capture?: Pick<RecordingResult, 'status' | 'issues'>;
  mode?: AutomationKind;
  operations: readonly RecordedOperation[];
  selectors: ReadonlyMap<number, ResolvedSelector>;
  assertionCount?: number;
  requireAssertions?: boolean;
  scenarioName?: string;
  scenarioFingerprint?: string;
  verifiedRunId?: string;
  contentFingerprint?: string;
  language?: RecordingLanguage;
  dartAppEntrypoint?: string;
}

export interface RecordingVerificationInputs {
  contentFingerprint?: string;
  scenarioFingerprint?: string;
}

/**
 * Decide whether generated recording output is safe to present as a
 * regression test. This is a pure gate: it never guesses a selector or
 * promotes an assertion suggestion to an executable assertion.
 */
export function assessRecordingReadiness(
  options: AssessRecordingReadinessOptions,
): RecordingReadinessResult {
  const automationKind = options.mode ?? 'script';
  const issues: string[] = [];
  if (options.capture) {
    issues.push(...options.capture.issues);
    if (options.capture.status !== 'captured' && issues.length === 0) {
      issues.push(`Recording capture is ${options.capture.status}.`);
    }
  }
  for (let index = 0; index < options.operations.length; index++) {
    const operation = options.operations[index];
    if (operation.status === 'ignored') continue;
    const selector = options.selectors.get(index);
    if (!selector) {
      issues.push(`unresolved target at operation ${index + 1}`);
      if (operation.recordedTarget?.issue) issues.push(operation.recordedTarget.issue);
    } else if (selector.ambiguous) {
      issues.push(`target at operation ${index + 1} is ambiguous`);
    } else if (selector.matchCount !== 1) {
      issues.push(`target at operation ${index + 1} was not verified unique`);
    } else if (hasPositionalQuery(selector.query)) {
      issues.push(`target at operation ${index + 1} relies on a positional selector`);
    }
  }
  if (automationKind === 'test') {
    if ((options.assertionCount ?? 0) === 0 && (options.requireAssertions ?? true)) {
      issues.push('missing confirmed assertion');
    }
    if (!options.scenarioName) issues.push('missing deterministic scenario');
  }
  const readiness: RecordingReadiness = issues.length > 0
    ? 'draft'
    : options.language !== 'dart' && options.verifiedRunId && options.contentFingerprint && options.scenarioFingerprint
      ? 'verified' : 'generated';
  const requiredInputParameters = [...recordingInputParameters(options.operations).values()];
  return {
    ...(requiredInputParameters.length ? { requiredInputParameters } : {}),
    automationKind,
    ...(options.language ? { language: options.language } : {}),
    ...(options.dartAppEntrypoint ? { dartAppEntrypoint: options.dartAppEntrypoint } : {}),
    readiness,
    issues,
    ...(options.contentFingerprint ? { contentFingerprint: options.contentFingerprint } : {}),
    ...(options.scenarioFingerprint ? { scenarioFingerprint: options.scenarioFingerprint } : {}),
    ...(readiness === 'verified' ? { verifiedRunId: options.verifiedRunId } : {}),
  };
}

/**
 * Apply independent Dart compile/run evidence without inheriting TypeScript verification.
 * Failed evidence always revokes verification, including when diagnostics are empty;
 * retain its run identity so editor regeneration preserves the failed replay.
 */
export function applyDartVerification(
  result: RecordingReadinessResult,
  evidence: DartVerificationEvidence,
): RecordingReadinessResult {
  const issues = [...result.issues];
  if (result.language !== 'dart') issues.push('Dart verification can only be applied to Dart output.');
  if (evidence.status !== 'passed') {
    const diagnostics = evidence.issues?.filter((issue) => issue.trim().length > 0) ?? [];
    issues.push(...(diagnostics.length ? diagnostics : ['Dart compilation or replay failed.']));
  }
  if (!result.contentFingerprint || evidence.contentFingerprint !== result.contentFingerprint) {
    issues.push('Dart verification content fingerprint does not match the generated recording.');
  }
  if (result.dartAppEntrypoint && evidence.appEntrypoint !== result.dartAppEntrypoint) {
    issues.push('Dart verification app entrypoint does not match the generated recording.');
  }
  if (!evidence.runId || !evidence.appEntrypoint || !evidence.platform) {
    issues.push('Dart verification requires a run identity, app entrypoint, and platform.');
  }
  if (issues.length) {
    const { verifiedRunId: _verifiedRunId, dartVerification: _dartVerification, ...draft } = result;
    return { ...draft, readiness: 'draft', ...(evidence.runId ? { replayRunId: evidence.runId } : {}), issues };
  }
  return { ...result, readiness: 'verified', verifiedRunId: evidence.runId, dartVerification: evidence, issues: [] };
}

function hasPositionalQuery(query: import('./types.js').SelectorQuery): boolean {
  return query.position !== undefined
    || [query.within, query.containing, ...(query.and ?? []), ...(query.or ?? [])]
      .some((child) => child !== undefined && hasPositionalQuery(child));
}

/**
 * Keep a verified label only while the generated content and bound scenario
 * still identify the run that was actually replayed.
 */
export function invalidateStaleRecordingVerification(
  result: RecordingReadinessResult,
  current: RecordingVerificationInputs,
): RecordingReadinessResult {
  if (result.readiness !== 'verified') return result;
  const contentChanged = !result.verifiedRunId || !result.contentFingerprint
    || current.contentFingerprint !== result.contentFingerprint;
  const scenarioChanged = !result.scenarioFingerprint
    || current.scenarioFingerprint !== result.scenarioFingerprint;
  if (!contentChanged && !scenarioChanged) return result;
  const { verifiedRunId: _verifiedRunId, ...withoutVerification } = result;
  return {
    ...withoutVerification,
    readiness: 'generated',
    issues: [...result.issues, 'verification invalidated because recording content or scenario changed'],
  };
}
