/**
 * Integration test: CLI commands + Core
 *
 * Exercises CLI command functions using real Core components
 * via dependency injection, with MockWebSocket replacing real Flutter VM.
 */
import { describe, it, expect } from 'vitest';
import { recordCommand, type RecordDeps, type RecorderLike } from '../src/commands/record.js';
import { FliwrightDriver } from '@fliwright/core';
import type { CodegenOptions, RecordedOperation, WidgetInfo } from '@fliwright/core';
import { createProtocolMock } from '../../fliwright-core/tests/helpers/mockVMService.js';

function createMockRecorder(ops: RecordedOperation[]): RecorderLike {
  return {
    start: async () => {},
    stop: async (options?: CodegenOptions) => {
      // Generate minimal code based on operations
      const testName = options?.testName ?? 'recorded test';
      const lines: string[] = [];
      lines.push(`import { test, expect } from '@fliwright/vitest';`);
      lines.push('');
      lines.push(`test('${testName}', async ({ page }) => {`);
      for (const op of ops) {
        if (op.kind === 'tap') {
          lines.push(`  await page.locator({ text: 'Widget' }).click();`);
        } else if (op.kind === 'type') {
          lines.push(`  await page.locator({ text: 'Widget' }).type('${op.text ?? ''}');`);
        }
      }
      lines.push('});');
      return lines.join('\n');
    },
    getOperations: () => ops,
  };
}

describe('CLI + Core Integration', () => {
  it('recordCommand uses real RecorderController via DI', async () => {
    const mock = createProtocolMock();
    mock.mockExtension('ext.fliwright.startRecording', () => ({ status: 'ok' }));
    mock.mockExtension('ext.fliwright.stopRecording', () => ({ status: 'ok' }));
    mock.mockExtension('ext.fliwright.hitTest', () => ({ widget: { type: 'Text', text: 'Button' } }));

    const deps: RecordDeps = {
      resolveVmUrl: async () => 'ws://mock:8181/ws',
      createRecorder: async (vmUrl: string) => {
        const driver = new FliwrightDriver();
        await driver.attachMockConnector(mock.ws);
        return driver.recorder;
      },
      stopSignal: (async () => {
        // Simulate brief recording
        await new Promise(r => setTimeout(r, 100));

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

        await new Promise(r => setTimeout(r, 50));
      })(),
    };

    const result = await recordCommand({ testName: 'tap test' }, deps);

    expect(result.code).toContain("import { test, expect } from '@fliwright/vitest'");
    expect(result.code).toContain("test('tap test'");
    expect(result.operations).toBeDefined();
  });

  it('recordCommand integrates AssertionSuggester for suggestion comments', async () => {
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
      createRecorder: async () => createMockRecorder(operations),
      stopSignal: Promise.resolve(),
    };

    const result = await recordCommand({ testName: 'suggestion test' }, deps);

    // Should include assertion suggestion comments
    expect(result.code).toContain('Assertion Suggestions');
    expect(result.code).toContain('possible navigation tap');
    expect(result.code).toContain('possible form submit');
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
