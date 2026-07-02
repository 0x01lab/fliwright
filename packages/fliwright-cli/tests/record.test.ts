import { describe, it, expect, vi } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { recordCommand } from '../src/commands/record.js';

describe('recordCommand', () => {
  it('throws with friendly message when VM URL cannot be resolved', async () => {
    await expect(recordCommand({
      reporter: 'pretty',
    }, {
      resolveVmUrl: async () => null,
    })).rejects.toThrow('Could not find a running Flutter VM Service');
  });

  it('returns generated code from recorder', async () => {
    const result = await recordCommand({
      vmUrl: 'ws://mock:8181/ws',
      lang: 'ts',
      testName: 'my test',
    }, {
      resolveVmUrl: async () => 'ws://mock:8181/ws',
      createRecorder: async () => ({
        start: vi.fn(),
        stop: vi.fn().mockResolvedValue("import { test } from '@fliwright/vitest';\ntest('my test', async ({ page }) => {});"),
        getOperations: vi.fn().mockReturnValue([]),
      }),
      stopSignal: Promise.resolve(),
    });

    expect(result.code).toContain("@fliwright/vitest");
    expect(result.code).toContain("my test");
    expect(result.flow).toMatchObject({
      version: 1,
      id: 'flow-my-test',
      title: 'my test',
      source: {
        kind: 'recording',
        testName: 'my test',
      },
    });
  });

  it('writes an editable flow JSON when flowOutput is provided', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fliwright-record-flow-'));
    const flowOutput = join(dir, 'checkout.flow.json');

    await recordCommand({
      vmUrl: 'ws://mock:8181/ws',
      lang: 'ts',
      testName: 'checkout',
      flowOutput,
    }, {
      resolveVmUrl: async () => 'ws://mock:8181/ws',
      createRecorder: async () => ({
        start: vi.fn(),
        stop: vi.fn().mockResolvedValue("test('checkout', async () => {});"),
        getOperations: vi.fn().mockReturnValue([
          { kind: 'tap', position: { x: 100, y: 200 }, timestamp: 1000, status: 'included' },
        ]),
        getFrames: vi.fn().mockReturnValue([
          {
            id: 'frame-1',
            index: 0,
            kind: 'tap',
            status: 'ready',
            timestamp: 1000,
            operationIndex: 0,
            position: { x: 100, y: 200 },
            selector: 'text=Pay',
            operationStatus: 'included',
          },
        ]),
      }),
      stopSignal: Promise.resolve(),
    });

    const flow = JSON.parse(await readFile(flowOutput, 'utf8')) as { nodes: Array<{ selector?: string }> };
    expect(flow.nodes).toHaveLength(1);
    expect(flow.nodes[0].selector).toBe('text=Pay');
  });

  it('calls stop with correct CodegenOptions', async () => {
    const stopFn = vi.fn().mockResolvedValue('code');
    await recordCommand({
      vmUrl: 'ws://mock:8181/ws',
      lang: 'dart',
      testName: 'dart test',
    }, {
      resolveVmUrl: async () => 'ws://mock:8181/ws',
      createRecorder: async () => ({
        start: vi.fn(),
        stop: stopFn,
        getOperations: vi.fn().mockReturnValue([]),
      }),
      stopSignal: Promise.resolve(),
    });

    expect(stopFn).toHaveBeenCalledWith(expect.objectContaining({
      lang: 'dart',
      testName: 'dart test',
      resetToHomeBeforeEach: false,
    }));
  });

  it('generates TS recordings with a home reset hook by default', async () => {
    const stopFn = vi.fn().mockResolvedValue('code');
    await recordCommand({
      vmUrl: 'ws://mock:8181/ws',
      lang: 'ts',
      testName: 'home reset test',
      homeRoute: '/dashboard',
    }, {
      resolveVmUrl: async () => 'ws://mock:8181/ws',
      createRecorder: async () => ({
        start: vi.fn(),
        stop: stopFn,
        getOperations: vi.fn().mockReturnValue([]),
      }),
      stopSignal: Promise.resolve(),
    });

    expect(stopFn).toHaveBeenCalledWith(expect.objectContaining({
      lang: 'ts',
      testName: 'home reset test',
      resetToHomeBeforeEach: true,
      homeRoute: '/dashboard',
    }));
  });
});
