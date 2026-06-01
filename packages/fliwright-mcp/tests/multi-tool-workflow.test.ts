/**
 * Integration test: MCP Multi-Tool Workflow
 *
 * Verifies state coordination across fliwright_run → fliwright_get_failure → test_report.
 */
import { describe, it, expect } from 'vitest';
import { handleRunTest, type TestRunner } from '../src/tools/runTest.js';
import { handleGetFailure } from '../src/tools/getFailure.js';
import { handleReadTestReport } from '../src/resources/testReport.js';
import { handleRecord, type RecorderFactory } from '../src/tools/record.js';
import { createServerState } from '../src/state.js';
import { FliwrightDriver } from '@fliwright/core';
import { createProtocolMock } from '../../fliwright-core/tests/helpers/mockVMService.js';

const passingRunner: TestRunner = async () => ({
  passed: true,
  totalTests: 1,
  passedTests: 1,
  failedTests: 0,
  duration: 50,
  results: [{ name: 'sample passes', passed: true, duration: 50 }],
});

const failingRunner: TestRunner = async () => ({
  passed: false,
  totalTests: 2,
  passedTests: 1,
  failedTests: 1,
  duration: 100,
  results: [
    { name: 'test-a', passed: true, duration: 50 },
    { name: 'test-b', passed: false, duration: 50, error: 'failed' },
  ],
  failures: [
    {
      testName: 'test-b',
      assertion: { matcher: 'toBeVisible', expected: 'visible', actual: 'not found', timeout: 5000 },
      widgetTree: { type: 'Column' },
      source: { file: 'test.ts', line: 1, snippet: 'failed' },
      timestamp: new Date().toISOString(),
    },
  ],
});

describe('MCP Multi-Tool Workflow Integration', () => {
  it('Run → GetFailure → TestReport complete workflow', async () => {
    const state = createServerState();

    // Step 1: Run tests
    const runResult = await handleRunTest(
      { testFile: 'tests/example.test.ts', vmServiceUrl: 'ws://mock:8181/ws' },
      state,
      failingRunner,
    );
    expect(runResult.passed).toBe(false);

    // Step 2: Get failures
    const failures = handleGetFailure({}, state);
    expect(failures.failures).toHaveLength(1);
    expect(failures.failures[0].testName).toBe('test-b');

    // Step 3: Read test report
    const report = handleReadTestReport(state);
    const parsed = JSON.parse(report);
    expect(parsed.passed).toBe(false);
    expect(parsed.totalTests).toBe(2);
    expect(parsed.passedTests).toBe(1);
    expect(parsed.failedTests).toBe(1);
    expect(parsed.results).toHaveLength(2);
  });

  it('second Run overwrites previous state', async () => {
    const state = createServerState();

    // First run with failures
    await handleRunTest(
      { testFile: 'tests/a.test.ts', vmServiceUrl: 'ws://mock:8181/ws' },
      state,
      failingRunner,
    );
    expect(handleGetFailure({}, state).failures).toHaveLength(1);

    // Second run - all passing
    await handleRunTest(
      { testFile: 'tests/b.test.ts', vmServiceUrl: 'ws://mock:8181/ws' },
      state,
      passingRunner,
    );

    // Failures should be cleared (passing runner produces no failures)
    const failures = handleGetFailure({}, state);
    expect(failures.failures).toHaveLength(0);

    // Report should reflect second run
    const report = JSON.parse(handleReadTestReport(state));
    expect(report.passed).toBe(true);
    expect(report.totalTests).toBe(1);
  });

  it('record stores VM URL in state', async () => {
    const state = createServerState();
    const mock = createProtocolMock();
    mock.mockExtension('ext.fliwright.startRecording', () => ({ status: 'ok' }));
    mock.mockExtension('ext.fliwright.stopRecording', () => ({ status: 'ok' }));
    mock.mockExtension('ext.fliwright.hitTest', () => ({ widget: { type: 'Widget' } }));

    const factory: RecorderFactory = async () => {
      const driver = new FliwrightDriver();
      await driver.attachMockConnector(mock.ws);
      return driver.recorder;
    };

    await handleRecord(
      { vmServiceUrl: 'ws://recorder-url:9999/ws', duration: 0.05 },
      state,
      factory,
    );

    expect(state.getVmServiceUrl()).toBe('ws://recorder-url:9999/ws');
  });
});
