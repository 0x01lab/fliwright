import { describe, it, expect } from 'vitest';
import { handleRunTest } from '../src/tools/runTest.js';
import { createServerState } from '../src/state.js';

describe('handleRunTest', () => {
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
    try {
      await handleRunTest({ testFile: 'tests/demo.test.ts', vmServiceUrl: 'ws://param-url' }, state);
    } catch (e) {
      expect(state.getVmServiceUrl()).toBe('ws://param-url');
    }
    delete process.env.FLIWRIGHT_VM_URL;
  });

  it('uses env var FLIWRIGHT_VM_URL when param is not provided', async () => {
    const state = createServerState();
    process.env.FLIWRIGHT_VM_URL = 'ws://env-url';
    try {
      await handleRunTest({ testFile: 'tests/demo.test.ts' }, state);
    } catch (e) {
      expect(state.getVmServiceUrl()).toBe('ws://env-url');
    }
    delete process.env.FLIWRIGHT_VM_URL;
  });

  it('stores vmServiceUrl in state after resolving', async () => {
    const state = createServerState();
    try {
      await handleRunTest({ testFile: 'tests/demo.test.ts', vmServiceUrl: 'ws://localhost:9999/ws' }, state);
    } catch (e) {
      // Connection will fail but state should be set
    }
    expect(state.getVmServiceUrl()).toBe('ws://localhost:9999/ws');
  });
});
