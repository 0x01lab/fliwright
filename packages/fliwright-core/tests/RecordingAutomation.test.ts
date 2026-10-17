import { describe, expect, it } from 'vitest';
import { generateRecordingAutomation } from '../src/RecordingAutomation.js';
import type { RecordingCaptureResult } from '../src/RecordingCapture.js';

const capture: RecordingCaptureResult = {
  recording: {
    status: 'captured', code: '', issues: [], frames: [], receivedSequences: [], missingSequences: [],
    operations: [{ kind: 'tap', position: { x: 1, y: 2 }, timestamp: 1000 }],
  },
  selectors: new Map([[0, { query: { match: { key: 'save' } }, ambiguous: false, matchCount: 1 }]]),
  stopReason: 'requested',
};
const checkpoint = {
  id: 'saved', query: { match: { key: 'result' } }, matcher: 'toHaveText', expected: 'Saved',
  source: 'snapshot', confirmed: true, afterOperationIndex: 0,
};

describe('recording automation generation', () => {
  it('generates a confirmed checkpoint that executes after its recorded action', async () => {
    const result = generateRecordingAutomation(capture, {
      mode: 'test', scenarioName: 'saved-form', checkpoints: [checkpoint],
    });
    expect(result.readiness.readiness).toBe('generated');
    const events: string[] = [];
    let body: (fixtures: unknown) => Promise<void>;
    const register = Object.assign((_: string, callback: typeof body) => { body = callback; }, {
      scenario: (name: string) => {
        expect(name).toBe('saved-form');
        return register;
      },
    });
    // Generated TS contains JS-compatible fixture code; exercise its observable ordering.
    const execute = new Function('test', 'expect', result.recording.code.replace(/^import .*;\n/, ''));
    execute(register, (locator: { query: unknown }) => ({
      toHaveText: async (value: string) => events.push(`assert:${JSON.stringify(locator.query)}:${value}`),
    }));
    await body!({ page: { locator: (query: unknown) => ({ query, click: async () => events.push('click') }) } });
    expect(events).toEqual(['click', 'assert:{"match":{"key":"result"}}:Saved']);
    expect(result.checkpoints).toHaveLength(1);
  });

  it('parameterizes masked inputs and fails before any action if a replay value is missing', async () => {
    const sensitiveCapture: RecordingCaptureResult = { ...capture, recording: { ...capture.recording,
      operations: [capture.recording.operations[0], {
        kind: 'type', position: { x: 0, y: 0 }, timestamp: 2000, text: '<masked>', sensitive: true, action: 'replace',
      }],
    }, selectors: new Map([...capture.selectors, [1, {
      query: { match: { key: 'password' } }, ambiguous: false, matchCount: 1,
    }]]) };
    const result = generateRecordingAutomation(sensitiveCapture, {});
    expect(result.readiness.requiredInputParameters).toEqual(['FLIWRIGHT_INPUT_2']);
    expect(result.recording.code).not.toContain('<masked>');
    expect(result.recording.code).toContain('fill(recordedInput2, { sensitive: true })');
    let body!: (fixtures: unknown) => Promise<void>;
    const calls: string[] = [];
    const page = { locator: () => ({ click: async () => { calls.push('click'); }, fill: async (value: string) => { calls.push(value); } }) };
    const env: Record<string, string | undefined> = {};
    new Function('script', 'process', result.recording.code.replace(/^import .*;\n/, ''))(
      (_: string, callback: typeof body) => { body = callback; }, { env },
    );
    await expect(body({ page })).rejects.toThrow('FLIWRIGHT_INPUT_2');
    expect(calls).toEqual([]);
    env.FLIWRIGHT_INPUT_2 = 'supplied-at-replay';
    await body({ page });
    expect(calls).toEqual(['click', 'supplied-at-replay']);
    expect(JSON.stringify(result)).not.toContain('supplied-at-replay');
  });

  it('validates replay inputs before its generated home reset hook changes the app', async () => {
    const result = generateRecordingAutomation({ ...capture, recording: { ...capture.recording,
      operations: [{ kind: 'type', sensitive: true, text: '<masked>', position: { x: 0, y: 0 }, timestamp: 1 }],
    } }, { resetToHomeBeforeEach: true });
    let setup!: (fixtures: unknown) => Promise<void>;
    let reset = false;
    new Function('script', 'beforeEach', 'process', result.recording.code.replace(/^import .*;\n/, ''))(
      () => {}, (callback: typeof setup) => { setup = callback; }, { env: {} },
    );
    await expect(setup({ page: { resetToHome: async () => { reset = true; } } })).rejects.toThrow('FLIWRIGHT_INPUT_1');
    expect(reset).toBe(false);
  });

  it('keeps an observed suggestion unconfirmed and does not emit an assertion', () => {
    const result = generateRecordingAutomation(capture, {
      mode: 'test', scenarioName: 'saved-form', checkpoints: [{ ...checkpoint, confirmed: false }],
    });
    expect(result.readiness.readiness).toBe('draft');
    expect(result.readiness.issues).toContain('missing confirmed assertion');
    expect(result.recording.code).not.toContain('await expect(');
  });

  it('does not treat a bare confirmation boolean as a business assertion', () => {
    const result = generateRecordingAutomation(capture, {
      mode: 'test', scenarioName: 'saved-form', checkpoints: [{ confirmed: true }],
    });
    expect(result.readiness.readiness).toBe('draft');
    expect(result.readiness.issues).toContain('missing confirmed assertion');
    expect(result.recording.code).not.toContain('await expect(');
  });

  it.each([
    { ...checkpoint, matcher: 'toSaveToBackend' },
    { ...checkpoint, expected: 42 },
    { ...checkpoint, afterOperationIndex: 8 },
    { ...checkpoint, query: {} },
    { ...checkpoint, query: { match: { key: 'result' }, position: { nth: 0 } } },
  ])('preserves unsupported or invalid confirmed checkpoints as blockers: %j', (candidate) => {
    const result = generateRecordingAutomation(capture, {
      mode: 'test', scenarioName: 'saved-form', checkpoints: [candidate],
    });
    expect(result.readiness.readiness).toBe('draft');
    expect(result.readiness.issues.length).toBeGreaterThan(1);
    expect(result.recording.code).not.toContain('await expect(');
  });

  it('defaults to script and needs no assertions', () => {
    const result = generateRecordingAutomation(capture, {});
    expect(result.readiness).toMatchObject({ automationKind: 'script', readiness: 'generated' });
    expect(result.recording.code).toContain("script('recorded test'");
  });

  it('preserves capture diagnostics when generation itself succeeds', () => {
    const result = generateRecordingAutomation({
      ...capture, recording: { ...capture.recording, status: 'partial', issues: ['lost events'] },
    }, {});
    expect(result.readiness).toMatchObject({ readiness: 'draft', issues: ['lost events'] });
  });

  it('does not count unsupported Dart checkpoints as executable assertions', () => {
    const result = generateRecordingAutomation(capture, {
      lang: 'dart', mode: 'test', scenarioName: 'saved-form',
      dartAppEntrypoint: 'package:form_demo/recording_replay_main.dart',
      checkpoints: [{ ...checkpoint, matcher: 'toBeEnabled', expected: true }],
    });
    expect(result.readiness.readiness).toBe('draft');
    expect(result.readiness.issues.join(' ')).toMatch(/Dart.*checkpoint/i);
    expect(result.readiness.issues).toContain('missing confirmed assertion');
  });

  it('keeps Dart without an app entrypoint as a draft even with reliable TS selectors', () => {
    const result = generateRecordingAutomation(capture, { lang: 'dart' });
    expect(result.readiness.readiness).toBe('draft');
    expect(result.readiness.issues.join(' ')).toMatch(/app entrypoint/i);
  });

  it('propagates Dart finder limitations into shared readiness', () => {
    const result = generateRecordingAutomation({ ...capture, selectors: new Map([[0, {
      query: { match: { role: 'button' } }, matchCount: 1, ambiguous: false,
    }]]) }, { lang: 'dart', dartAppEntrypoint: 'package:form_demo/recording_replay_main.dart' });
    expect(result.readiness.readiness).toBe('draft');
    expect(result.readiness.issues.join(' ')).toMatch(/operation 1.*role/i);
  });

  it('counts a confirmed supported Dart checkpoint and generates it after the action', () => {
    const result = generateRecordingAutomation(capture, {
      lang: 'dart', mode: 'test', scenarioName: 'saved-form', checkpoints: [checkpoint],
      dartAppEntrypoint: 'package:form_demo/recording_replay_main.dart',
    });
    expect(result.readiness.readiness).toBe('generated');
    expect(result.recording.code).toContain("expect(_recordedText(tester.widget(_recordedKey('result'))), 'Saved'");
    expect(result.readiness.verifiedRunId).toBeUndefined();
  });
});
