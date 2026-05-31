import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { recordCommand, type RecordOptions, type RecordDeps } from '../src/commands/record.js';
import type { RecordedOperation } from '@fliwright/core';

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

    expect(stopFn).toHaveBeenCalledWith({ lang: 'dart', testName: 'dart test' });
  });
});
