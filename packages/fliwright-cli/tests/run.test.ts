import { describe, it, expect } from 'vitest';
import { runCommand, parseVitestOutput, type RunOptions } from '../src/commands/run.js';
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('runCommand', () => {
  it('throws with friendly message when VM URL cannot be resolved', async () => {
    const options: RunOptions = {
      testPattern: 'tests/example.test.ts',
      reporter: 'pretty',
    };

    await expect(runCommand(options, {
      resolveVmUrl: async () => null,
    })).rejects.toThrow('Could not find a running Flutter VM Service');
  });

  it('passes vmServiceUrl through deps and runs vitest', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'fliwright-cli-run-'));
    await writeFile(join(tmpDir, 'pass.test.ts'), [
      "import { describe, expect, it } from 'vitest';",
      "describe('cli fixture', () => {",
      "  it('passes', () => { expect(1).toBe(1); });",
      "});",
    ].join('\n'));

    let capturedUrl: string | undefined;
    const result = await runCommand({
      testPattern: 'pass.test.ts',
      reporter: 'json',
      cwd: tmpDir,
    }, {
      resolveVmUrl: async () => 'ws://mock-vm:8181/ws',
      onVmResolved: (url) => { capturedUrl = url; },
    });

    expect(capturedUrl).toBe('ws://mock-vm:8181/ws');
    expect(result.passed).toBe(true);
    expect(result.totalTests).toBe(1);
    expect(result.artifacts?.reportPath).toBeDefined();
    await expect(stat(result.artifacts!.reportPath!)).resolves.toBeDefined();

    await rm(tmpDir, { recursive: true, force: true });
  });

  it('persists structured failure context and screenshots in the AI report', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'fliwright-cli-failure-artifacts-'));
    await writeFile(join(tmpDir, 'sidecar.test.ts'), [
      "import { writeFileSync } from 'node:fs';",
      "import { describe, expect, it } from 'vitest';",
      "describe('fixture', () => {",
      "  it('writes failure context', () => {",
      "    writeFileSync(process.env.FLIWRIGHT_MCP_FAILURE_CONTEXT_PATH!, JSON.stringify([{",
      "      testName: 'login failure',",
      "      assertion: { matcher: 'toBeVisible', expected: 'visible', actual: 'missing', timeout: 5000 },",
      "      widgetTree: { widgets: [{ type: 'Text' }] },",
      "      diagnostics: [{ kind: 'Flutter.Error', timestamp: 1812345678901, streamId: 'Logging', data: { message: 'build failed' } }],",
      "      source: { file: '/tmp/login.test.ts', line: 4, snippet: 'expect(locator).toBeVisible()' },",
      "      screenshot: { mimeType: 'image/png', base64: Buffer.from('png-bytes').toString('base64') },",
      "      timestamp: '2026-05-31T00:00:00.000Z'",
      '    }]));',
      '    expect(true).toBe(false);',
      '  });',
      '});',
    ].join('\n'));

    const result = await runCommand({
      testPattern: 'sidecar.test.ts',
      reporter: 'ai-json',
      cwd: tmpDir,
      print: false,
    }, {
      resolveVmUrl: async () => 'ws://mock-vm:8181/ws',
    });

    expect(result.passed).toBe(false);
    expect(result.failures).toHaveLength(1);
    expect(result.failures![0].screenshot?.path).toBeDefined();
    expect(result.failures![0].screenshot?.base64).toBeUndefined();
    expect(result.artifacts?.screenshots).toHaveLength(1);
    const report = JSON.parse(await readFile(result.artifacts!.reportPath!, 'utf8')) as typeof result;
    expect(report.failures![0].widgetTree).toEqual({ widgets: [{ type: 'Text' }] });
    expect(report.failures![0].diagnostics).toEqual([{
      kind: 'Flutter.Error',
      timestamp: 1812345678901,
      streamId: 'Logging',
      data: { message: 'build failed' },
    }]);
    await expect(stat(result.artifacts!.screenshots[0])).resolves.toBeDefined();

    await rm(tmpDir, { recursive: true, force: true });
  });

  it('attaches timeline summaries and agent-visible failures to the report', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'fliwright-cli-timeline-'));
    await writeFile(join(tmpDir, 'timeline.test.ts'), [
      "import { mkdirSync, writeFileSync } from 'node:fs';",
      "import { join } from 'node:path';",
      "import { describe, expect, it } from 'vitest';",
      "describe('timeline fixture', () => {",
      "  it('writes timeline sidecar', () => {",
      "    const dir = join(process.cwd(), '.fliwright', 'runs', process.env.FLIWRIGHT_RUN_ID!, 'timeline-fixture');",
      "    mkdirSync(dir, { recursive: true });",
      "    writeFileSync(join(dir, 'timeline.json'), JSON.stringify({",
      "      version: 1, runId: process.env.FLIWRIGHT_RUN_ID, testName: 'timeline fixture', mode: 'test', status: 'failed', startedAt: '2026-06-18T00:00:00.000Z',",
      "      nodes: [",
      "        { id: 'page-1', kind: 'page', title: 'Register', status: 'passed', startedAt: 'x', endedAt: 'x' },",
      "        { id: 'step-2', kind: 'step', title: 'Fill', status: 'passed', startedAt: 'x', endedAt: 'x', artifacts: [{ kind: 'screenshot', path: 'artifacts/screenshots/step-2.png' }] },",
      "        { id: 'step-3', kind: 'step', title: 'Submit', status: 'failed', startedAt: 'x', endedAt: 'x' }",
      "      ],",
      "      agentVisibleFailures: [{ code: 'assertion_failed', title: 'Submit', message: 'button disabled', timelineNodeId: 'step-3' }]",
      "    }));",
      "    expect(true).toBe(true);",
      "  });",
      "});",
    ].join('\n'));

    const result = await runCommand({
      testPattern: 'timeline.test.ts',
      reporter: 'ai-json',
      cwd: tmpDir,
      print: false,
    }, {
      resolveVmUrl: async () => 'ws://mock-vm:8181/ws',
    });

    expect(result.timelines).toHaveLength(1);
    expect(result.timelines![0]).toMatchObject({
      pages: 1,
      stepsPassed: 1,
      stepsFailed: 1,
      screenshots: 1,
      firstFailure: { code: 'assertion_failed', message: 'button disabled' },
    });
    expect(result.agentVisibleFailures).toEqual([
      { code: 'assertion_failed', title: 'Submit', message: 'button disabled', timelineNodeId: 'step-3' },
    ]);
    expect(result.artifacts?.timelines?.[0]).toContain('timeline.json');

    await rm(tmpDir, { recursive: true, force: true });
  });
});

describe('parseVitestOutput', () => {
  it('returns empty result for empty string', () => {
    const result = parseVitestOutput('');
    expect(result.passed).toBe(false);
    expect(result.totalTests).toBe(0);
    expect(result.results).toEqual([]);
  });

  it('returns empty result for string without braces', () => {
    const result = parseVitestOutput('no json here');
    expect(result.passed).toBe(false);
    expect(result.totalTests).toBe(0);
  });

  it('returns empty result for malformed JSON', () => {
    const result = parseVitestOutput('{not valid json}');
    expect(result.passed).toBe(false);
    expect(result.totalTests).toBe(0);
  });

  it('handles missing testResults gracefully', () => {
    const result = parseVitestOutput('{"success":true,"numTotalTests":0}');
    expect(result.passed).toBe(true);
    expect(result.totalTests).toBe(0);
    expect(result.results).toEqual([]);
  });

  it('parses a complete vitest JSON report', () => {
    const json = JSON.stringify({
      success: true,
      numTotalTests: 2,
      numPassedTests: 2,
      numFailedTests: 0,
      startTime: Date.now() - 100,
      testResults: [{
        assertionResults: [
          { fullName: 'test a', status: 'passed', duration: 10 },
          { fullName: 'test b', status: 'passed', duration: 20 },
        ],
      }],
    });
    const result = parseVitestOutput(json);
    expect(result.passed).toBe(true);
    expect(result.totalTests).toBe(2);
    expect(result.results).toHaveLength(2);
    expect(result.results[0].name).toBe('test a');
  });

  it('captures failure messages for failed tests', () => {
    const json = JSON.stringify({
      success: false,
      numTotalTests: 1,
      numPassedTests: 0,
      numFailedTests: 1,
      startTime: Date.now(),
      testResults: [{
        assertionResults: [{
          fullName: 'failing test',
          status: 'failed',
          duration: 50,
          failureMessages: ['expected 1 to be 2'],
        }],
      }],
    });
    const result = parseVitestOutput(json);
    expect(result.passed).toBe(false);
    expect(result.results[0].error).toBe('expected 1 to be 2');
  });
});
