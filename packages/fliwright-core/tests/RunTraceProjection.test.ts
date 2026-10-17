import { expect, it } from 'vitest';
import { RunSession, TimelineRecorder, projectRunTrace } from '../src/index.js';

it.each(['running', 'skipped', 'interrupted'] as const)('preserves %s action facts rather than projecting success', (outcome) => {
  const recorder = new TimelineRecorder({ runId: 'r', testName: 'unfinished' });
  const session = new RunSession({ runId: 'r', testId: 't', testName: 'unfinished' });
  const result = session.snapshot();
  result.operations.push({ operationId: 'action-1', kind: 'action', title: 'Submit',
    outcome, startedAt: new Date().toISOString() });
  const trace = projectRunTrace(result, recorder.toJSON());
  expect(trace.steps[0].status).toBe(outcome);
});

it('projects logical operation facts and existing evidence without issuing RPCs', async () => {
  const recorder = new TimelineRecorder({ runId: 'r', testName: 'projection' });
  const session = new RunSession({ runId: 'r', testId: 't', testName: 'projection', recorder,
    recordingMode: 'standard', captureEvidence: async () => ({ status: 'captured', artifactPaths: ['artifacts/screenshots/action.png'] }),
  });
  await session.perform({ kind: 'action', title: 'Tap Continue', metadata: { action: 'tap', selector: 'key=continue' } }, async () => {});
  await session.perform({ kind: 'action', title: 'Missing', metadata: { action: 'tap' } }, async () => { throw new Error('missing'); }).catch(() => {});
  const result = await session.finish({ status: 'passed', evidenceStatus: 'complete' });
  const trace = projectRunTrace(result, recorder.complete('passed'));
  expect(trace.meta).toMatchObject({ status: 'passed', totalSteps: 2 });
  expect(trace.steps[0]).toMatchObject({ action: 'tap', selector: 'key=continue', operationId: result.operations[0].operationId,
    status: 'pass', screenshotFile: '../artifacts/screenshots/action.png' });
  expect(trace.steps[1]).toMatchObject({ status: 'fail', error: 'missing' });
});

it('masks sensitive input echoed in operation and runner errors while rethrowing the original error', async () => {
  const recorder = new TimelineRecorder({ runId: 's', testName: 'sensitive' });
  const session = new RunSession({ runId: 's', testId: 't', testName: 'sensitive', recorder });
  const secret = 'private-input-42';
  const error = new Error(`Bridge rejected ${secret}`);
  await expect(session.perform({ kind: 'action', title: 'Fill password', sensitiveValues: [secret] }, async () => { throw error; })).rejects.toBe(error);
  const result = await session.finish({ status: 'failed', evidenceStatus: 'disabled' });
  const trace = projectRunTrace(result, recorder.complete('failed'));
  expect(trace.steps[0].error).toBe('Bridge rejected <masked>');
  expect(JSON.stringify(recorder.toJSON())).not.toContain(secret);
  expect(session.redactReport({ message: error.message, actual: { value: secret } })).toEqual({
    message: 'Bridge rejected <masked>', actual: { value: '<masked>' },
  });
});
