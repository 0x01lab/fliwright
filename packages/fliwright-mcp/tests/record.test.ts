import { describe, it, expect, vi } from 'vitest';
import { handleRecord, type RecordResult } from '../src/tools/record.js';
import { createServerState } from '../src/state.js';

describe('handleRecord', () => {
  it('throws when no VM Service URL is provided and env var is not set', async () => {
    const state = createServerState();
    const origEnv = process.env.FLIWRIGHT_VM_URL;
    delete process.env.FLIWRIGHT_VM_URL;

    await expect(handleRecord({ duration: 5 }, state))
      .rejects.toThrow('No VM Service URL');

    if (origEnv) process.env.FLIWRIGHT_VM_URL = origEnv;
  });

  it('uses vmServiceUrl from params over env var', async () => {
    const state = createServerState();
    process.env.FLIWRIGHT_VM_URL = 'ws://env-url';
    const mockRecorder = {
      start: vi.fn(),
      stop: vi.fn().mockResolvedValue('test code'),
      getOperations: vi.fn().mockReturnValue([]),
    };
    let capturedUrl = '';
    await handleRecord(
      { vmServiceUrl: 'ws://param-url', duration: 1 },
      state,
      async (url) => { capturedUrl = url; return mockRecorder; },
    );
    expect(capturedUrl).toBe('ws://param-url');
    expect(state.getVmServiceUrl()).toBe('ws://param-url');
    delete process.env.FLIWRIGHT_VM_URL;
  });

  it('returns generated code and operation count', async () => {
    const state = createServerState();
    const mockRecorder = {
      start: vi.fn(),
      stop: vi.fn().mockResolvedValue("import { test } from '@fliwright/vitest';"),
      getOperations: vi.fn().mockReturnValue([
        { kind: 'tap', position: { x: 100, y: 200 }, timestamp: 1000 },
      ]),
    };

    const result = await handleRecord(
      { vmServiceUrl: 'ws://vm', duration: 1, lang: 'ts', testName: 'my test' },
      state,
      async () => mockRecorder,
    );

    expect(result.testCode).toContain('@fliwright/vitest');
    expect(result.testName).toBe('my test');
    expect(result.operationCount).toBe(1);
    expect(result.flow).toMatchObject({
      version: 1,
      id: 'flow-my-test',
      title: 'my test',
      source: {
        kind: 'recording',
        testName: 'my test',
      },
      nodes: [],
      edges: [],
    });
    expect(mockRecorder.stop).toHaveBeenCalledWith(expect.objectContaining({
      lang: 'ts',
      testName: 'my test',
      resetToHomeBeforeEach: true,
      homeRoute: '/',
    }));
  });
});
