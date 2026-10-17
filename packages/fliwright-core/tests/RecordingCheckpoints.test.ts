import { describe, expect, it } from 'vitest';
import {
  confirmRecordingCheckpoint,
  countConfirmedRecordingCheckpoints,
  createRecordingCheckpointCandidate,
  invalidateStaleRecordingVerification,
} from '../src/index.js';

describe('recording checkpoint confirmation', () => {
  it('keeps suggestions unconfirmed until an explicit confirmation is applied', () => {
    const candidate = createRecordingCheckpointCandidate({
      id: 'saved',
      matcher: 'visible',
      expected: 'Saved',
      source: 'snapshot',
      confirmed: false,
    });
    expect(countConfirmedRecordingCheckpoints([candidate])).toBe(0);
    const confirmed = confirmRecordingCheckpoint(candidate, {
      id: 'saved',
      confirmed: true,
    });
    expect(confirmed.confirmed).toBe(true);
    expect(countConfirmedRecordingCheckpoints([confirmed])).toBe(1);
  });

  it('invalidates verification when the content fingerprint changes', () => {
    const result = invalidateStaleRecordingVerification({
      automationKind: 'test',
      readiness: 'verified',
      issues: [],
      contentFingerprint: 'old',
      scenarioFingerprint: 'scenario',
      verifiedRunId: 'run-1',
    }, {
      contentFingerprint: 'new',
      scenarioFingerprint: 'scenario',
    });
    expect(result.readiness).toBe('generated');
    expect(result.verifiedRunId).toBeUndefined();
    expect(result.issues[0]).toMatch(/invalidated/);
  });
});
