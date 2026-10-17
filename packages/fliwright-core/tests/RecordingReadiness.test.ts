import { describe, expect, it } from 'vitest';
import { assessRecordingReadiness, applyDartVerification, invalidateStaleRecordingVerification, parseDartVerificationEvidence } from '../src/RecordingReadiness.js';

describe('recording capture readiness', () => {
  it('parses Dart evidence files and rejects malformed compile/run identities', () => {
    const evidence = { status: 'passed', runId: 'dart-run', contentFingerprint: 'content-1',
      appEntrypoint: 'package:demo/replay.dart', platform: 'macos', artifactPath: '.', issues: [] };
    expect(parseDartVerificationEvidence(evidence)).toEqual(evidence);
    for (const malformed of [null, [], { ...evidence, status: 'running' }, { ...evidence, runId: 42 },
      { ...evidence, platform: ' ' }, { ...evidence, appEntrypoint: '' },
      { ...evidence, contentFingerprint: undefined }, { ...evidence, issues: [42] },
      { ...evidence, artifactPath: false }]) {
      expect(() => parseDartVerificationEvidence(malformed)).toThrow(/invalid Dart verification evidence/i);
    }
  });
  it('requires matching Dart compile/run evidence before publishing a Dart recording', () => {
    const result = assessRecordingReadiness({
      language: 'dart', mode: 'script', operations: [], selectors: new Map(),
      contentFingerprint: 'content-1', dartAppEntrypoint: 'package:demo/replay.dart',
    });
    expect(result.language).toBe('dart');
    expect(result.readiness).toBe('generated');
    const verified = applyDartVerification(result, {
      status: 'passed', runId: 'dart-run-1', contentFingerprint: 'content-1',
      appEntrypoint: 'package:demo/replay.dart', platform: 'macos',
    });
    expect(verified.readiness).toBe('verified');
    expect(verified.verifiedRunId).toBe('dart-run-1');
    expect(verified.dartVerification?.platform).toBe('macos');
  });

  it('keeps Dart output as draft when evidence belongs to another file or run', () => {
    const result = assessRecordingReadiness({ language: 'dart', operations: [], selectors: new Map(), contentFingerprint: 'content-1' });
    const rejected = applyDartVerification(result, {
      status: 'passed', runId: 'dart-run-1', contentFingerprint: 'different',
      appEntrypoint: 'package:demo/replay.dart', platform: 'macos',
    });
    expect(rejected.readiness).toBe('draft');
    expect(rejected.verifiedRunId).toBeUndefined();
    expect(rejected.issues.join(' ')).toMatch(/content fingerprint/i);
  });
  it('rejects Dart evidence for a different app entrypoint', () => {
    const result = assessRecordingReadiness({ language: 'dart', operations: [], selectors: new Map(),
      contentFingerprint: 'content-1', dartAppEntrypoint: 'package:demo/replay.dart' });
    const rejected = applyDartVerification(result, {
      status: 'passed', runId: 'dart-run-1', contentFingerprint: 'content-1',
      appEntrypoint: 'package:demo/other.dart', platform: 'macos',
    });
    expect(rejected.readiness).toBe('draft');
    expect(rejected.issues.join(' ')).toMatch(/entrypoint/i);
  });

  it.each([{ issues: undefined }, { issues: [] }, { issues: ['', '  '] }, { issues: ['Compiler failed'] }])(
    'revokes Dart verification for failed evidence with diagnostics $issues', ({ issues }) => {
      const generated = assessRecordingReadiness({ language: 'dart', operations: [], selectors: new Map(),
        contentFingerprint: 'content-1', dartAppEntrypoint: 'package:demo/replay.dart' });
      const evidence = { status: 'passed' as const, runId: 'dart-run-1', contentFingerprint: 'content-1',
        appEntrypoint: 'package:demo/replay.dart', platform: 'macos' };
      const verified = applyDartVerification(generated, evidence);
      const rejected = applyDartVerification(verified, { ...evidence, status: 'failed', issues });
      expect(rejected.readiness).toBe('draft');
      expect(rejected.verifiedRunId).toBeUndefined();
      expect(rejected.dartVerification).toBeUndefined();
      expect(rejected.issues.join(' ')).toMatch(/compil.*failed/i);
    },
  );

  it('requires independent Dart evidence despite a supplied generic verified run', () => {
    const result = assessRecordingReadiness({ language: 'dart', operations: [], selectors: new Map(),
      contentFingerprint: 'content-1', scenarioFingerprint: 'scenario-1', verifiedRunId: 'ts-run',
      dartAppEntrypoint: 'package:demo/replay.dart' });
    expect(result.readiness).toBe('generated');
    expect(result.verifiedRunId).toBeUndefined();
  });
  it('does not accept an unbound run identity as verification', () => {
    expect(assessRecordingReadiness({ operations: [], selectors: new Map(),
      mode: 'test', scenarioName: 'saved', assertionCount: 1, verifiedRunId: 'unbound',
    }).readiness).toBe('generated');
    const unbound = invalidateStaleRecordingVerification({ automationKind: 'test', readiness: 'verified',
      issues: [], verifiedRunId: 'unbound',
    }, { contentFingerprint: 'current', scenarioFingerprint: 'current' });
    expect(unbound.readiness).toBe('generated');
    expect(unbound.verifiedRunId).toBeUndefined();
  });
  it.each(['partial', 'failed'] as const)('keeps %s capture output as draft despite reliable selectors', (status) => {
    const result = assessRecordingReadiness({
      operations: [], selectors: new Map(), capture: { status, issues: ['capture incomplete'] },
      verifiedRunId: 'untrusted-run',
    });
    expect(result.readiness).toBe('draft');
    expect(result.issues).toContain('capture incomplete');
    expect(result.verifiedRunId).toBeUndefined();
  });

  it('supplies a diagnostic when partial capture has no issue message', () => {
    expect(assessRecordingReadiness({
      operations: [], selectors: new Map(), capture: { status: 'partial', issues: [] },
    }).issues.join(' ')).toMatch(/partial/i);
  });

  it.each([
    { query: { match: { key: 'save' } }, ambiguous: false, matchCount: 0 },
    { query: { match: { text: 'Save' }, position: { nth: 0 } }, ambiguous: false, matchCount: 1 },
  ])('keeps an unverified or positional selector as a draft', (selector) => {
    const result = assessRecordingReadiness({
      operations: [{ kind: 'tap', timestamp: 1, position: { x: 1, y: 2 } }],
      selectors: new Map([[0, selector]]),
    });
    expect(result.readiness).toBe('draft');
    expect(result.issues.join(' ')).toMatch(/verified unique|positional/i);
  });
});
