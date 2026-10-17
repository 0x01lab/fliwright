import { describe, expect, it } from 'vitest';
import {
  evidenceStatusSchema,
  recordingEventEnvelopeSchema,
  runManifestSchema,
  runStatusSchema,
  type RecordingEventEnvelope,
} from '../src/index.js';
import { frozenTarget } from './helpers/recordingProtocol.js';

describe('run and recording protocol contracts', () => {
  it('validates frozen candidates and requires envelope and target identity to agree', () => {
    const target = frozenTarget({ match: { key: 'save' } });
    const event = {
      version: 2, sessionId: 'session', sequence: 1, elapsedUs: 100, frameId: 'frame',
      targetId: target.targetId, target, payload: { kind: 'focus', focused: true },
    };
    expect(recordingEventEnvelopeSchema.safeParse(event).success).toBe(true);
    expect(recordingEventEnvelopeSchema.safeParse({ ...event, targetId: 'different-instance' }).success).toBe(false);
    expect(recordingEventEnvelopeSchema.safeParse({ ...event, target: { type: 'TextField' } }).success).toBe(false);
    expect(recordingEventEnvelopeSchema.safeParse({ ...event, target: { ...target,
      candidates: [{ ...target.candidates[0], matchCount: -1 }],
    } }).success).toBe(false);
  });
  it('accepts masked sensitive input and rejects plaintext in a sensitive envelope', () => {
    const event = {
      version: 2, sessionId: 'session', sequence: 1, elapsedUs: 100, frameId: 'frame',
      payload: { kind: 'text', focusSessionId: 'focus-1', value: '<masked>', sensitive: true },
    };
    expect(recordingEventEnvelopeSchema.safeParse(event).success).toBe(true);
    expect(recordingEventEnvelopeSchema.safeParse({ ...event,
      payload: { ...event.payload, value: 'private-input' },
    }).success).toBe(false);
  });

  it('accepts versioned pointer envelopes with monotonic sequence metadata', () => {
    const event: RecordingEventEnvelope = {
      version: 2,
      sessionId: 'recording-1',
      sequence: 4,
      elapsedUs: 1200,
      frameId: 'frame-7',
      targetId: 'target-2',
      payload: {
        kind: 'pointer',
        phase: 'down',
        pointer: 1,
        x: 12,
        y: 24,
        viewportWidth: 320,
        viewportHeight: 640,
        pixelRatio: 2,
      },
    };
    expect(recordingEventEnvelopeSchema.parse(event)).toEqual(event);
  });

  it('rejects old protocol versions and platform timestamps as ordering fields', () => {
    expect(() => recordingEventEnvelopeSchema.parse({
      version: 1,
      sessionId: 'recording-1',
      sequence: 1,
      elapsedUs: 0,
      frameId: 'frame-1',
      payload: { kind: 'route', route: '/home' },
    })).toThrow();
  });

  it('keeps test status and evidence status independent', () => {
    expect(runStatusSchema.parse('interrupted')).toBe('interrupted');
    expect(evidenceStatusSchema.parse('partial')).toBe('partial');
    const manifest = runManifestSchema.parse({
      schemaVersion: 1,
      runId: 'run-1',
      status: 'failed',
      evidenceStatus: 'partial',
      runnerErrors: [{ phase: 'collection', message: 'module failed', file: 'broken.test.ts' }],
      tests: [{ testId: 'test-1', attempts: [{ attemptId: 'attempt-1', resultPath: 'tests/test-1/attempts/attempt-1/result.json' }] }],
    });
    expect(manifest.runnerErrors?.[0]).toMatchObject({ phase: 'collection', message: 'module failed' });
    expect(manifest.tests[0].attempts[0].resultPath).toContain('attempt-1');
  });
});
