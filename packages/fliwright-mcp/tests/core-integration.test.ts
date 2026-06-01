/**
 * Integration test: MCP tools + Core
 *
 * Exercises MCP tool handlers delegating to real Core components.
 * Uses dependency injection to inject mock WS, avoiding real Flutter VM.
 */
import { describe, it, expect } from 'vitest';
import { handleRunTest, type TestRunner } from '../src/tools/runTest.js';
import { handleGetFailure } from '../src/tools/getFailure.js';
import { handleGenerateTest } from '../src/tools/generateTest.js';
import { handleRecord, type RecorderFactory } from '../src/tools/record.js';
import { createServerState } from '../src/state.js';
import type { FailureEntry, RunResult } from '../src/types.js';
import { FliwrightDriver } from '@fliwright/core';
import type { RecordedOperation, WidgetInfo } from '@fliwright/core';
import { createProtocolMock } from '../../fliwright-core/tests/helpers/mockVMService.js';

function createRecorderFromMock(): { recorderFactory: RecorderFactory; mock: ReturnType<typeof createProtocolMock> } {
  const mock = createProtocolMock();
  mock.mockExtension('ext.fliwright.startRecording', () => ({ status: 'ok' }));
  mock.mockExtension('ext.fliwright.stopRecording', () => ({ status: 'ok' }));
  mock.mockExtension('ext.fliwright.hitTest', () => ({ widget: { type: 'ElevatedButton', text: 'Login' } }));

  const recorderFactory: RecorderFactory = async (vmUrl: string) => {
    const driver = new FliwrightDriver();
    await driver.attachMockConnector(mock.ws);
    return driver.recorder;
  };

  return { recorderFactory, mock };
}

describe('MCP + Core Integration', () => {
  it('handleRecord with real RecorderController from core', async () => {
    const state = createServerState();
    const { recorderFactory, mock } = createRecorderFromMock();

    // Start recording, inject events, then stop after brief delay
    const recordPromise = handleRecord(
      { vmServiceUrl: 'ws://mock:8181/ws', duration: 0.1, testName: 'test recording' },
      state,
      recorderFactory,
    );

    // Inject a tap event
    const now = Date.now();
    mock.emitStreamEvent('FliwrightRecording', {
      type: 'pointerEvent',
      kind: 'down',
      pointer: 0,
      position: { x: 100, y: 200 },
      timestamp: now,
      buttons: 1,
    });
    mock.emitStreamEvent('FliwrightRecording', {
      type: 'pointerEvent',
      kind: 'up',
      pointer: 0,
      position: { x: 100, y: 200 },
      timestamp: now + 50,
      buttons: 0,
    });

    const result = await recordPromise;

    expect(result.testName).toBe('test recording');
    expect(result.testCode).toContain("import { test, expect } from '@fliwright/vitest'");
    expect(result.testCode).toContain('test recording');
    expect(result.operationCount).toBeGreaterThanOrEqual(0);

    // Verify state was updated
    expect(state.getVmServiceUrl()).toBe('ws://mock:8181/ws');
  });

  it('handleRunTest + handleGetFailure state coordination', async () => {
    const state = createServerState();

    const failingRunner: TestRunner = async () => ({
      passed: false,
      totalTests: 2,
      passedTests: 1,
      failedTests: 1,
      duration: 100,
      results: [
        { name: 'login passes', passed: true, duration: 50 },
        { name: 'dashboard fails', passed: false, duration: 50, error: 'toBeVisible failed' },
      ],
      failures: [
        {
          testName: 'dashboard fails',
          assertion: { matcher: 'toBeVisible', expected: 'visible', actual: 'visible=false', timeout: 5000 },
          widgetTree: { type: 'Column', children: [] },
          source: { file: 'dashboard.test.ts', line: 10, snippet: 'await expect(locator).toBeVisible()' },
          timestamp: new Date().toISOString(),
        },
      ],
    });

    const runResult = await handleRunTest(
      { testFile: 'tests/dashboard.test.ts', vmServiceUrl: 'ws://mock:8181/ws' },
      state,
      failingRunner,
    );

    expect(runResult.passed).toBe(false);
    expect(runResult.totalTests).toBe(2);
    expect(runResult.failedTests).toBe(1);

    // Now retrieve failures through handleGetFailure
    const failureResult = handleGetFailure({}, state);
    expect(failureResult.failures).toHaveLength(1);
    expect(failureResult.failures[0].testName).toBe('dashboard fails');
    expect(failureResult.failures[0].assertion.matcher).toBe('toBeVisible');
  });

  it('handleGetFailure filters by testName', async () => {
    const state = createServerState();

    const failingRunner: TestRunner = async () => ({
      passed: false,
      totalTests: 3,
      passedTests: 1,
      failedTests: 2,
      duration: 100,
      results: [
        { name: 'login passes', passed: true, duration: 50 },
        { name: 'login error', passed: false, duration: 25, error: 'failed' },
        { name: 'dashboard fails', passed: false, duration: 25, error: 'failed' },
      ],
      failures: [
        {
          testName: 'login error',
          assertion: { matcher: 'toBeVisible', expected: 'visible', actual: 'not found', timeout: 5000 },
          widgetTree: {},
          source: { file: 'login.test.ts', line: 5, snippet: 'failed' },
          timestamp: new Date().toISOString(),
        },
        {
          testName: 'dashboard fails',
          assertion: { matcher: 'toHaveText', expected: '"Welcome"', actual: '""', timeout: 5000 },
          widgetTree: {},
          source: { file: 'dashboard.test.ts', line: 10, snippet: 'failed' },
          timestamp: new Date().toISOString(),
        },
      ],
    });

    await handleRunTest(
      { testFile: 'tests/all.test.ts', vmServiceUrl: 'ws://mock:8181/ws' },
      state,
      failingRunner,
    );

    // Filter by testName
    const loginFailures = handleGetFailure({ testName: 'login error' }, state);
    expect(loginFailures.failures).toHaveLength(1);
    expect(loginFailures.failures[0].testName).toBe('login error');

    const dashFailures = handleGetFailure({ testName: 'dashboard fails' }, state);
    expect(dashFailures.failures).toHaveLength(1);
    expect(dashFailures.failures[0].testName).toBe('dashboard fails');
  });

  it('handleGenerateTest produces code compatible with @fliwright/vitest', async () => {
    const flutterSource = `
      class LoginPage extends StatelessWidget {
        @override
        Widget build(BuildContext context) {
          return Scaffold(
            appBar: AppBar(title: Text('Login')),
            body: Column(
              children: [
                TextField(decoration: InputDecoration(hintText: 'Email')),
                TextField(decoration: InputDecoration(hintText: 'Password')),
                ElevatedButton(
                  onPressed: () {},
                  child: Text('Submit'),
                ),
                Text('Welcome back'),
              ],
            ),
          );
        }
      }
    `;

    const result = handleGenerateTest({
      source: flutterSource,
      testName: 'login page',
    });

    expect(result.testCode).toContain("import { test, expect } from '@fliwright/vitest'");
    expect(result.testCode).toContain("test('login page'");
    expect(result.testCode).toContain('page.locator(');
    expect(result.testCode).toContain('.click()');
    expect(result.testCode).toContain('.type(');
    expect(result.testCode).toContain('expect(');
    expect(result.testCode).toContain('.toBeVisible()');
    expect(result.testName).toBe('login page');
  });
});
