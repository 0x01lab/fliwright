/**
 * Integration test: CLI commands + Core
 *
 * Exercises CLI command functions using real Core components
 * via dependency injection, with MockWebSocket replacing real Flutter VM.
 */
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { recordCommand, type RecordDeps } from '../src/commands/record.js';
import { FliwrightDriver, CodeGenerator } from '@fliwright/core';
import type { RecordingCaptureResource, RecordedOperation } from '@fliwright/core';
import { createProtocolMock } from '../../fliwright-core/tests/helpers/mockVMService.js';
import { installRecordingProtocol } from '../../fliwright-core/tests/helpers/recordingProtocol.js';

function createMockCapture(operations: RecordedOperation[]): RecordingCaptureResource {
  const selectors = new Map(operations.map((_, index) => [index, {
    query: { match: { text: 'Widget' } }, ambiguous: false, matchCount: 1,
  }]));
  return {
    recorder: {
      start: async () => {},
      stop: async (options) => ({
        status: 'captured', code: new CodeGenerator().generate(operations, selectors, options),
        operations, frames: [], issues: [], receivedSequences: [], missingSequences: [],
      }),
      getSelectors: () => selectors,
      getArtifactDirectory: () => undefined,
    },
    dispose: async () => {},
  };
}

describe('CLI + Core Integration', () => {
  let cwd: string;
  beforeEach(async () => { cwd = await mkdtemp(join(tmpdir(), 'fliwright-cli-core-')); });
  afterEach(async () => { await rm(cwd, { recursive: true, force: true }); });
  it('recordCommand uses real RecorderController via DI', async () => {
    const mock = createProtocolMock();
    const protocol = installRecordingProtocol(mock);
    mock.mockExtension('ext.fliwright.hitTest', () => ({ widget: { type: 'Text', text: 'Button' } }));

    const deps: RecordDeps = {
      resolveVmUrl: async () => 'ws://mock:8181/ws',
      openCapture: async (vmUrl: string) => {
        const driver = new FliwrightDriver();
        await driver.attachMockConnector(mock.ws);
        return { recorder: driver.recorder, dispose: () => driver.dispose() };
      },
      waitForStop: async () => {
        mock.emitStreamEvent('FliwrightRecording', protocol.pointer('down', 100, 200, 100));
        mock.emitStreamEvent('FliwrightRecording', protocol.pointer('up', 100, 200, 50_100));
      },
    };

    const result = await recordCommand({ cwd, testName: 'tap test' }, deps);

    expect(result.code).toContain("from '@fliwright/vitest'");
    expect(result.code).toContain("script('tap test'");
    expect(result.operations).toHaveLength(1);
  });

  it('does not infer business assertions from click coordinates or typed input', async () => {
    const operations: RecordedOperation[] = [
      {
        kind: 'tap',
        position: { x: 100, y: 50 },  // Top of screen → navigation suggestion
        timestamp: Date.now(),
      },
      {
        kind: 'type',
        text: 'user@example.com',
        position: { x: 100, y: 300 },
        timestamp: Date.now() + 1000,
      },
      {
        kind: 'tap',
        position: { x: 100, y: 500 },  // After type → submit suggestion
        timestamp: Date.now() + 2000,
      },
    ];

    const deps: RecordDeps = {
      resolveVmUrl: async () => 'ws://mock:8181/ws',
      openCapture: async () => createMockCapture(operations),
      waitForStop: async () => {},
    };

    const result = await recordCommand({ cwd, testName: 'suggestion test' }, deps);

    expect(result.checkpoints).toEqual([]);
    expect(result.code).not.toContain('await expect(');
    expect(result.readiness.automationKind).toBe('script');
  });

  it('recordCommand throws when no VM URL found', async () => {
    const deps: RecordDeps = {
      resolveVmUrl: async () => null,
    };

    await expect(
      recordCommand({}, deps),
    ).rejects.toThrow('Could not find a running Flutter VM Service');
  });
});
