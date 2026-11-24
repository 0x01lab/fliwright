import { expect, it, vi } from 'vitest';
import { MissingSupportSettingError } from '@fliwright/core';
import { executeCli } from '../src/index.js';
import { doctorCommand } from '../src/commands/doctor.js';
import { runCommand } from '../src/commands/run.js';
import { recordCommand } from '../src/commands/record.js';
vi.mock('../src/commands/doctor.js', () => ({ doctorCommand: vi.fn() }));
vi.mock('../src/commands/run.js', () => ({ runCommand: vi.fn() }));
vi.mock('../src/commands/record.js', () => ({ recordCommand: vi.fn() }));

it('makes strict doctor fail for skipped required probes while preserving all checks', async () => {
  vi.mocked(doctorCommand).mockResolvedValue([{ name: 'Bridge extensions', passed: false, message: 'skipped (no VM Service URL)' }]);
  const result = await executeCli(['doctor', '--strict', '--json']);
  expect(result.exitCode).toBe(3);
  expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, data: { checks: [{ required: true, status: 'skipped' }] } });
});
it('does not fail strict doctor for unavailable optional integrations', async () => {
  vi.mocked(doctorCommand).mockResolvedValue([{ name: 'Bridge extensions', passed: true, message: 'ready' }, { name: 'Riverpod observer', passed: false, message: 'not installed' }]);
  const result = await executeCli(['doctor', '--strict', '--json']);
  expect(result.exitCode).toBe(0);
});
it('retains failed run evidence and uses the test exit code', async () => {
  vi.mocked(runCommand).mockResolvedValue({ passed: false, results: [], artifacts: { runId: 'failed', reportPath: '/artifacts/report.json' } } as never);
  const result = await executeCli(['run', '--scenario', 'ready', '--junit-output', 'junit.xml', '--json']);
  expect(result.exitCode).toBe(1);
  expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, data: { artifacts: { runId: 'failed' } }, error: { code: 'TEST_FAILED' } });
  expect(vi.mocked(runCommand).mock.calls.at(-1)?.[0]).toMatchObject({ scenario: 'ready', junitOutput: 'junit.xml', print: false });
});
it('adds terminal guidance for missing support settings and retains the original failure evidence', async () => {
  const missing = new MissingSupportSettingError('preview', 'route', '/runtime/preview.json', 'PREVIEW_ROUTE');
  const error = `Error: other failure\n    at other.test.ts:1:1\n${missing.stack}`;
  vi.mocked(runCommand).mockResolvedValue({ passed: false, totalTests: 1, passedTests: 0, failedTests: 1, duration: 1,
    results: [{ name: 'preview', passed: false, duration: 1, error }] });
  const terminal = await executeCli(['run']);
  expect(terminal.exitCode).toBe(1);
  expect(terminal.stderr).toContain(missing.message);
  expect(terminal.stderr).toContain('readSupportSettings() overrides');
  const json = await executeCli(['run', '--json']);
  expect(JSON.parse(json.stdout)).toMatchObject({ ok: false, data: { results: [{ error }] },
    error: { code: 'TEST_FAILED', message: expect.stringContaining('readSupportSettings() overrides') } });
});
it('bounds recording and emits only one JSON result', async () => {
  vi.mocked(recordCommand).mockResolvedValue({ readiness: { status: 'draft' } } as never);
  const result = await executeCli(['record', '--duration', '0.1', '--json']);
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, data: { readiness: { status: 'draft' } } });
  expect(vi.mocked(recordCommand).mock.calls.at(-1)?.[0]).toMatchObject({ durationMs: 100, print: false });
});
it('keeps offline discovery independent of an inherited connection session', async () => {
  vi.stubEnv('FLIWRIGHT_SESSION', 'missing-session');
  try {
    const result = await executeCli(['schema', 'app.snapshot', '--json']);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).not.toHaveProperty('operationId');
  } finally { vi.unstubAllEnvs(); }
});
it('rejects missing action targets as invalid input before app discovery', async () => {
  const result = await executeCli(['app', 'interact', 'tap', '--json']);
  expect(result.exitCode).toBe(2);
});
