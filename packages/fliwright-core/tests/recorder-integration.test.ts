/**
 * Integration test: Recorder + EventAggregator + CodeGenerator Pipeline
 *
 * Exercises the full data flow:
 *   RecorderController → EventAggregator → SelectorResolver → CodeGenerator/DartCodeGenerator
 *
 * Uses MockWebSocket so no Flutter app is required.
 */
import { describe, it, expect } from 'vitest';
import { FliwrightDriver } from '../src/Driver.js';
import { createProtocolMock } from './helpers/mockVMService.js';
import type { RawInputEvent, WidgetInfo } from '../src/types.js';

function createDriverWithMock() {
  const mock = createProtocolMock();
  const driver = new FliwrightDriver();
  return { mock, driver, init: () => driver.attachMockConnector(mock.ws) };
}

describe('Recorder + Codegen Pipeline Integration', () => {
  it('full recording session: tap → drag → type → generate TS code', async () => {
    const { mock, driver, init } = createDriverWithMock();

    // hitTest returns widget info for selector resolution
    const widgets: Record<string, Partial<WidgetInfo>> = {
      '100,200': { type: 'ElevatedButton', text: 'Login' },
      '50,300': { type: 'Slider' },
      '150,400': { type: 'TextField', text: 'Email' },
    };

    mock.mockExtension('ext.fliwright.hitTest', (params: any) => {
      const key = `${Math.round(params.x)},${Math.round(params.y)}`;
      return { widget: widgets[key] ?? { type: 'Widget' } };
    });

    mock.mockExtension('ext.fliwright.startRecording', () => ({ status: 'ok' }));
    mock.mockExtension('ext.fliwright.stopRecording', () => ({ status: 'ok' }));

    await init();
    const recorder = driver.recorder;

    await recorder.start();

    // Simulate tap: pointer down then up at same position
    const now = Date.now();
    injectPointerEvent(mock, { type: 'pointerEvent', kind: 'down', pointer: 0, position: { x: 100, y: 200 }, timestamp: now, buttons: 1 });
    injectPointerEvent(mock, { type: 'pointerEvent', kind: 'up', pointer: 0, position: { x: 100, y: 200 }, timestamp: now + 50, buttons: 0 });

    // Simulate drag: down → move → up with significant delta
    injectPointerEvent(mock, { type: 'pointerEvent', kind: 'down', pointer: 0, position: { x: 50, y: 300 }, timestamp: now + 200, buttons: 1 });
    injectPointerEvent(mock, { type: 'pointerEvent', kind: 'move', pointer: 0, position: { x: 150, y: 300 }, timestamp: now + 300, buttons: 1 });
    injectPointerEvent(mock, { type: 'pointerEvent', kind: 'up', pointer: 0, position: { x: 150, y: 300 }, timestamp: now + 400, buttons: 0 });

    // Simulate text input
    injectPointerEvent(mock, { type: 'pointerEvent', kind: 'down', pointer: 0, position: { x: 150, y: 400 }, timestamp: now + 500, buttons: 1 });
    injectPointerEvent(mock, { type: 'pointerEvent', kind: 'up', pointer: 0, position: { x: 150, y: 400 }, timestamp: now + 550, buttons: 0 });
    mock.emitStreamEvent('FliwrightRecording', {
      type: 'textInput',
      text: 'hello',
      timestamp: now + 600,
    });

    // Stop and generate code
    const code = await recorder.stop({ testName: 'login flow', lang: 'ts' });
    const ops = recorder.getOperations();

    // Verify operations were captured
    expect(ops.length).toBeGreaterThanOrEqual(2);

    // Verify code generation
    expect(code).toContain("import { test, expect } from '@fliwright/vitest'");
    expect(code).toContain("test('login flow'");
    expect(code).toContain('.click()');
    // Text input should generate type
    expect(code).toContain(".type('hello')");

    // Verify hitTest was called for selector resolution
    const hitTestMessages = mock.sentMessages().filter(m => m.method === 'ext.fliwright.hitTest');
    expect(hitTestMessages.length).toBeGreaterThanOrEqual(2);
  });

  it('onOperation callback fires during recording', async () => {
    const { mock, driver, init } = createDriverWithMock();

    mock.mockExtension('ext.fliwright.hitTest', () => ({ widget: { type: 'Text', text: 'Click Me' } }));
    mock.mockExtension('ext.fliwright.startRecording', () => ({ status: 'ok' }));
    mock.mockExtension('ext.fliwright.stopRecording', () => ({ status: 'ok' }));

    await init();

    const operations: Array<{ kind: string; index: number }> = [];
    const recorder = driver.recorder;

    await recorder.start({
      onOperation: (op, idx) => {
        operations.push({ kind: op.kind, index: idx });
      },
    });

    const now = Date.now();
    injectPointerEvent(mock, { type: 'pointerEvent', kind: 'down', pointer: 0, position: { x: 10, y: 20 }, timestamp: now, buttons: 1 });
    injectPointerEvent(mock, { type: 'pointerEvent', kind: 'up', pointer: 0, position: { x: 10, y: 20 }, timestamp: now + 50, buttons: 0 });

    // Wait for event processing
    await new Promise(r => setTimeout(r, 50));

    await recorder.stop();

    expect(operations.length).toBeGreaterThanOrEqual(1);
    expect(operations[0].kind).toBe('tap');
    expect(operations[0].index).toBe(0);
  });

  it('generates Dart code when lang is dart', async () => {
    const { mock, driver, init } = createDriverWithMock();

    mock.mockExtension('ext.fliwright.hitTest', () => ({ widget: { type: 'ElevatedButton', text: 'OK' } }));
    mock.mockExtension('ext.fliwright.startRecording', () => ({ status: 'ok' }));
    mock.mockExtension('ext.fliwright.stopRecording', () => ({ status: 'ok' }));

    await init();
    const recorder = driver.recorder;

    await recorder.start();

    const now = Date.now();
    injectPointerEvent(mock, { type: 'pointerEvent', kind: 'down', pointer: 0, position: { x: 10, y: 20 }, timestamp: now, buttons: 1 });
    injectPointerEvent(mock, { type: 'pointerEvent', kind: 'up', pointer: 0, position: { x: 10, y: 20 }, timestamp: now + 50, buttons: 0 });

    const code = await recorder.stop({ testName: 'tap test', lang: 'dart' });

    // Dart code should use Dart-style imports and syntax
    expect(code).toContain("import 'package:flutter_test/flutter_test.dart'");
    expect(code).toContain('await');
    expect(code).toContain("testWidgets('tap test'");
    expect(code).toContain('tester.tap(');
  });
});

function injectPointerEvent(mock: ReturnType<typeof createProtocolMock>, event: RawInputEvent) {
  mock.emitStreamEvent('FliwrightRecording', event as unknown as Record<string, unknown>);
}
