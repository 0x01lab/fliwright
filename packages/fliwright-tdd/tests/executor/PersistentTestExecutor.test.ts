import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { defaultArtifactsRoot, PersistentTestExecutor } from '../../src/executor/PersistentTestExecutor.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('PersistentTestExecutor.rerun', () => {
  it('places default artifacts under the project root for file and directory config roots', () => {
    expect(defaultArtifactsRoot('/repo/app/vitest.config.ts')).toBe('/repo/app/.fliwright/tdd');
    expect(defaultArtifactsRoot('/repo/app/custom.vitest.mjs')).toBe('/repo/app/.fliwright/tdd');
    expect(defaultArtifactsRoot('/repo/app')).toBe('/repo/app/.fliwright/tdd');
  });

  it('does not restore runtime env before boot has applied it', async () => {
    const previous = process.env.FLIWRIGHT_VM_SERVICE_URL;
    process.env.FLIWRIGHT_VM_SERVICE_URL = 'ws://preexisting/ws';
    const executor = new PersistentTestExecutor();

    try {
      await executor.dispose();
      expect(process.env.FLIWRIGHT_VM_SERVICE_URL).toBe('ws://preexisting/ws');
    } finally {
      if (previous === undefined) delete process.env.FLIWRIGHT_VM_SERVICE_URL;
      else process.env.FLIWRIGHT_VM_SERVICE_URL = previous;
    }
  });

  it('reports red for a failing fixture test and green for a passing one', async () => {
    const artifactsRoot = await mkdtemp(resolve(tmpdir(), 'fliwright-tdd-'));
    const executor = new PersistentTestExecutor();

    await executor.boot({
      configRoot: resolve(__dirname, '../../spike/fixture-project/vitest.config.ts'),
      artifactsRoot,
      vmServiceUrl: 'ws://runtime/ws',
      driverProvider: async () => ({}),
    });

    try {
      expect(process.env.FLIWRIGHT_VM_SERVICE_URL).toBe('ws://runtime/ws');
      const failing = await executor.rerun(resolve(__dirname, '../../spike/fixture-project/.fliwright/tests/sample.test.ts'), 'beta fails');
      expect(failing.status).toBe('red');

      const passing = await executor.rerun(resolve(__dirname, '../../spike/fixture-project/.fliwright/tests/sample.test.ts'), 'alpha passes');
      expect(passing.status).toBe('green');
    } finally {
      await executor.dispose();
    }
    expect(process.env.FLIWRIGHT_VM_SERVICE_URL).not.toBe('ws://runtime/ws');
  }, 30_000);

  it('runs a generated candidate as an explicit focus without broadening ordinary discovery', async () => {
    const artifactsRoot = await mkdtemp(resolve(tmpdir(), 'fliwright-tdd-generated-'));
    const executor = new PersistentTestExecutor();
    const fixtureRoot = resolve(__dirname, '../../spike/fixture-project');
    const candidatePath = resolve(fixtureRoot, '.fliwright/generated/generated-candidate.test.ts');

    await executor.boot({
      configRoot: resolve(fixtureRoot, 'vitest.config.ts'),
      artifactsRoot,
      vmServiceUrl: 'ws://runtime/ws',
      driverProvider: async () => ({}),
    });

    try {
      const candidate = await executor.rerun(candidatePath, 'generated candidate passes');

      expect(candidate).toMatchObject({
        status: 'green',
        testName: 'generated candidate passes',
      });
      expect(candidate.timelinePath).toBeUndefined();
      expect(await readdir(resolve(fixtureRoot, '.fliwright/tests'))).toEqual(['sample.test.ts']);
    } finally {
      await executor.dispose();
    }
  }, 30_000);

  it('reads TDD failure details from the MCP failure sidecar when present', async () => {
    const artifactsRoot = await mkdtemp(resolve(tmpdir(), 'fliwright-tdd-'));
    const executor = new PersistentTestExecutor();

    await executor.boot({
      configRoot: resolve(__dirname, '../../spike/fixture-project/vitest.config.ts'),
      artifactsRoot,
      vmServiceUrl: 'ws://runtime/ws',
      driverProvider: async () => ({}),
    });

    try {
      await writeFile(resolve(artifactsRoot, 'failures.json'), JSON.stringify([
        {
          testName: 'beta fails',
          assertion: { matcher: 'toBe', expected: '3', actual: '2', timeout: 5000 },
          widgetTree: { type: 'Root' },
          source: { file: '/app/lib/login.dart', line: 12, snippet: 'expect failed' },
          screenshot: { mimeType: 'image/png', base64: 'abc123' },
          timestamp: new Date().toISOString(),
        },
      ]), 'utf8');
      const runDir = resolve(artifactsRoot, 'runs', 'run-beta-fails');
      await mkdir(runDir, { recursive: true });
      await writeFile(resolve(runDir, 'timeline.json'), JSON.stringify({
        version: 1,
        runId: 'run-beta-fails',
        testName: 'beta fails',
        mode: 'test',
        status: 'failed',
        startedAt: new Date().toISOString(),
        nodes: [],
        agentVisibleFailures: [{ timelineNodeId: 'node-1' }],
      }), 'utf8');

      const failing = await executor.rerun(resolve(__dirname, '../../spike/fixture-project/.fliwright/tests/sample.test.ts'), 'beta fails');

      expect(failing.status).toBe('red');
      expect(failing.failureDetails).toMatchObject({
        assertion: { matcher: 'toBe', expected: '3', actual: '2', timeout: 5000 },
        source: { file: '/app/lib/login.dart', line: 12 },
        artifacts: {
          failureContextPath: resolve(artifactsRoot, 'failures.json'),
          screenshotBase64: 'abc123',
          widgetTree: { type: 'Root' },
          timelinePath: resolve(runDir, 'timeline.json'),
          timelineNodeId: 'node-1',
        },
      });
    } finally {
      await executor.dispose();
    }
  }, 30_000);
});
