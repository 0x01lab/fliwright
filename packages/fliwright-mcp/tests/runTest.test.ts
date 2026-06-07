import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { handleRunTest, runVitest, type TestRunner } from '../src/tools/runTest.js';
import { createServerState } from '../src/state.js';

describe('handleRunTest', () => {
  const passingRunner: TestRunner = async () => ({
    passed: true,
    totalTests: 1,
    passedTests: 1,
    failedTests: 0,
    duration: 12,
    results: [{ name: 'sample passes', passed: true, duration: 12 }],
  });

  it('throws when no VM Service URL is provided and env var is not set', async () => {
    const state = createServerState();
    const origEnv = process.env.FLIWRIGHT_VM_URL;
    delete process.env.FLIWRIGHT_VM_URL;

    await expect(handleRunTest({ testFile: 'tests/demo.test.ts' }, state))
      .rejects.toThrow('No VM Service URL');

    if (origEnv) process.env.FLIWRIGHT_VM_URL = origEnv;
  });

  it('uses vmServiceUrl from params over env var', async () => {
    const state = createServerState();
    process.env.FLIWRIGHT_VM_URL = 'ws://env-url';
    await handleRunTest({ testFile: 'tests/demo.test.ts', vmServiceUrl: 'ws://param-url' }, state, passingRunner);
    expect(state.getVmServiceUrl()).toBe('ws://param-url');
    delete process.env.FLIWRIGHT_VM_URL;
  });

  it('uses env var FLIWRIGHT_VM_URL when param is not provided', async () => {
    const state = createServerState();
    process.env.FLIWRIGHT_VM_URL = 'ws://env-url';
    await handleRunTest({ testFile: 'tests/demo.test.ts' }, state, passingRunner);
    expect(state.getVmServiceUrl()).toBe('ws://env-url');
    delete process.env.FLIWRIGHT_VM_URL;
  });

  it('stores vmServiceUrl in state after resolving', async () => {
    const state = createServerState();
    await handleRunTest({ testFile: 'tests/demo.test.ts', vmServiceUrl: 'ws://localhost:9999/ws' }, state, passingRunner);
    expect(state.getVmServiceUrl()).toBe('ws://localhost:9999/ws');
  });

  it('stores the runner result in state', async () => {
    const state = createServerState();
    const result = await handleRunTest({ testFile: 'tests/demo.test.ts', vmServiceUrl: 'ws://url' }, state, passingRunner);
    expect(result.passed).toBe(true);
    expect(state.getLastRunResult()).toEqual(result);
  });

  it('passes testFile, testName, vmServiceUrl, and cwd to the runner', async () => {
    const state = createServerState();
    let received: Parameters<TestRunner>[0] | null = null;
    const runner: TestRunner = async (params) => {
      received = params;
      return {
        passed: true,
        totalTests: 0,
        passedTests: 0,
        failedTests: 0,
        duration: 0,
        results: [],
      };
    };

    await handleRunTest({
      testFile: 'tests/login.test.ts',
      testName: 'login flow',
      vmServiceUrl: 'ws://vm',
      cwd: '/workspace/app',
    }, state, runner);

    expect(received).toMatchObject({
      testFile: 'tests/login.test.ts',
      testName: 'login flow',
      vmServiceUrl: 'ws://vm',
      cwd: '/workspace/app',
    });
  });

  it('stores failure entries from failed runner results', async () => {
    const state = createServerState();
    const runner: TestRunner = async () => ({
      passed: false,
      totalTests: 1,
      passedTests: 0,
      failedTests: 1,
      duration: 20,
      results: [{
        name: 'login shows dashboard',
        passed: false,
        duration: 20,
        error: 'AssertionError: toBeVisible failed for "text=Dashboard": expected visible, got visible=false\n    at Object.<anonymous> (/tests/login.test.ts:42:5)',
      }],
    });

    await handleRunTest({ testFile: 'tests/login.test.ts', vmServiceUrl: 'ws://vm' }, state, runner);

    expect(state.getLastFailures()).toHaveLength(1);
    expect(state.getLastFailures()[0].testName).toBe('login shows dashboard');
    expect(state.getLastFailures()[0].assertion.matcher).toBe('toBeVisible');
    expect(state.getLastFailures()[0].source.file).toBe('/tests/login.test.ts');
    expect(state.getLastFailures()[0].source.line).toBe(42);
  });

  it('prefers structured failures returned by the runner', async () => {
    const state = createServerState();
    const runner: TestRunner = async () => ({
      passed: false,
      totalTests: 1,
      passedTests: 0,
      failedTests: 1,
      duration: 20,
      results: [{
        name: 'fallback failure',
        passed: false,
        duration: 20,
        error: 'plain error',
      }],
      failures: [{
        testName: 'structured failure',
        assertion: { matcher: 'toHaveText', expected: 'Dashboard', actual: 'Login', timeout: 1000 },
        widgetTree: { widgets: [] },
        source: { file: '/tests/structured.test.ts', line: 7, snippet: 'expect(locator).toHaveText()' },
        timestamp: '2026-05-31T00:00:00.000Z',
      }],
    });

    await handleRunTest({ testFile: 'tests/login.test.ts', vmServiceUrl: 'ws://vm' }, state, runner);

    expect(state.getLastFailures()).toHaveLength(1);
    expect(state.getLastFailures()[0].testName).toBe('structured failure');
    expect(state.getLastFailures()[0].widgetTree).toEqual({ widgets: [] });
  });
});

describe('runVitest', () => {
  it('executes a real Vitest file and maps JSON output', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'fliwright-mcp-pass-'));
    await writeFile(join(cwd, 'pass.test.ts'), [
      "import { describe, expect, it } from 'vitest';",
      "describe('fixture', () => {",
      "  it('passes', () => {",
      '    expect(true).toBe(true);',
      '  });',
      '});',
    ].join('\n'));

    const result = await runVitest({
      cwd,
      testFile: 'pass.test.ts',
      vmServiceUrl: 'ws://vm',
    });

    expect(result.passed).toBe(true);
    expect(result.totalTests).toBe(1);
    expect(result.passedTests).toBe(1);
    expect(result.results[0].name).toContain('passes');
  });

  it('maps failed Vitest output without throwing', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'fliwright-mcp-fail-'));
    await writeFile(join(cwd, 'fail.test.ts'), [
      "import { describe, expect, it } from 'vitest';",
      "describe('fixture', () => {",
      "  it('fails', () => {",
      '    expect(true).toBe(false);',
      '  });',
      '});',
    ].join('\n'));

    const result = await runVitest({
      cwd,
      testFile: 'fail.test.ts',
      vmServiceUrl: 'ws://vm',
    });

    expect(result.passed).toBe(false);
    expect(result.totalTests).toBe(1);
    expect(result.failedTests).toBe(1);
    expect(result.results[0].passed).toBe(false);
    expect(result.results[0].error).toContain('expected true to be false');
  });

  it('reads structured failure context from the sidecar file', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'fliwright-mcp-sidecar-'));
    await writeFile(join(cwd, 'sidecar.test.ts'), [
      "import { writeFileSync } from 'node:fs';",
      "import { dirname } from 'node:path';",
      "import { describe, expect, it } from 'vitest';",
      "describe('fixture', () => {",
      "  it('writes sidecar and fails', () => {",
      "    writeFileSync('sidecar-dir.txt', dirname(process.env.FLIWRIGHT_MCP_FAILURE_CONTEXT_PATH!));",
      "    writeFileSync(process.env.FLIWRIGHT_MCP_FAILURE_CONTEXT_PATH!, JSON.stringify([{",
      "      testName: 'sidecar failure',",
      "      assertion: { matcher: 'toBeVisible', expected: 'visible', actual: 'missing', timeout: 5000 },",
      "      widgetTree: { widgets: [{ type: 'Text' }] },",
      "      source: { file: '/tmp/sidecar.test.ts', line: 4, snippet: 'expect(locator).toBeVisible()' },",
      "      healingSuggestion: {",
      "        originalSelector: 'text=Login',",
      "        suggestedSelector: 'text=Sign in',",
      "        confidence: 0.91,",
      "        scores: { position: 0.8, context: 0.9, codeBinding: 0.95, text: 0.99, weighted: 0.91 }",
      '      },',
      "      timestamp: '2026-05-31T00:00:00.000Z'",
      '    }]));',
      '    expect(true).toBe(false);',
      '  });',
      '});',
    ].join('\n'));

    const result = await runVitest({
      cwd,
      testFile: 'sidecar.test.ts',
      vmServiceUrl: 'ws://vm',
    });

    expect(result.passed).toBe(false);
    expect(result.failures).toHaveLength(1);
    expect(result.failures![0].testName).toBe('sidecar failure');
    expect(result.failures![0].widgetTree).toEqual({ widgets: [{ type: 'Text' }] });
    expect(result.failures![0].healingSuggestion).toEqual({
      originalSelector: 'text=Login',
      suggestedSelector: 'text=Sign in',
      confidence: 0.91,
      scores: { position: 0.8, context: 0.9, codeBinding: 0.95, text: 0.99, weighted: 0.91 },
    });
    const sidecarDir = await readFile(join(cwd, 'sidecar-dir.txt'), 'utf8');
    await expect(stat(sidecarDir)).resolves.toBeDefined();
    expect(result.artifacts?.reportPath).toBeDefined();
    await expect(stat(result.artifacts!.reportPath!)).resolves.toBeDefined();
  });
});
