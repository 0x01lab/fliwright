/** Recording v2 over the real connector, aggregator and code generators. */
import { afterEach, describe, it, expect } from 'vitest';
import { FliwrightDriver } from '../src/Driver.js';
import { createProtocolMock } from './helpers/mockVMService.js';
import { installRecordingProtocol, frozenTarget } from './helpers/recordingProtocol.js';

const drivers: FliwrightDriver[] = [];
afterEach(async () => { await Promise.all(drivers.splice(0).map((driver) => driver.dispose())); });

async function harness() {
  const mock = createProtocolMock();
  const protocol = installRecordingProtocol(mock);
  const driver = new FliwrightDriver();
  drivers.push(driver);
  await driver.attachMockConnector(mock.ws);
  return { mock, protocol, recorder: driver.recorder,
    emit: (data: Record<string, unknown>) => mock.emitStreamEvent('FliwrightRecording', data),
  };
}

describe('Recorder + Codegen Pipeline Integration', () => {
  it('records tap, drag and focused text values and generates TS code', async () => {
    const { mock, protocol, recorder, emit } = await harness();
    const target = frozenTarget({ match: { key: 'login' } }, { id: 'button', type: 'ElevatedButton' });
    await recorder.start();
    emit(protocol.pointer('down', 100, 200, 100, 1, { target }));
    emit(protocol.pointer('up', 100, 200, 200, 1));
    emit(protocol.pointer('down', 50, 300, 300, 2, { target: frozenTarget({ match: { type: 'Slider' }, position: { nth: 0 } }, { type: 'Slider' }, 'positional') }));
    emit(protocol.pointer('move', 150, 300, 400, 2));
    emit(protocol.pointer('up', 150, 300, 500, 2));
    emit(protocol.pointer('down', 150, 400, 600, 3, { target: frozenTarget({ match: { key: 'email' } }, { id: 'field', type: 'TextField' }) }));
    emit(protocol.pointer('up', 150, 400, 700, 3));
    emit(protocol.text('hello', 800, { targetId: 'field', target: frozenTarget({ match: { key: 'email' } }, { id: 'field', type: 'TextField' }) }));

    const result = await recorder.stop({ testName: 'login flow', lang: 'ts' });
    expect(result.status).toBe('captured');
    expect(result.operations).toHaveLength(3);
    expect(result.code).toContain("test('login flow'");
    expect(result.code).toContain('.click({ waitForAnimations: true })');
    expect(result.code).toContain(".fill('hello')");
    expect(mock.sentMessages().filter((message) => message.method === 'ext.fliwright.hitTest')).toHaveLength(0);
  });

  it('delivers onOperation before stop', async () => {
    const { protocol, recorder, emit } = await harness();
    const operations: Array<{ kind: string; index: number }> = [];
    await recorder.start({ onOperation: (operation, index) => operations.push({ kind: operation.kind, index }) });
    emit(protocol.pointer('down', 10, 20, 100));
    emit(protocol.pointer('up', 10, 20, 200));
    expect(operations).toEqual([{ kind: 'tap', index: 0 }]);
    await recorder.stop();
  });

  it('generates Dart output from the same captured operations', async () => {
    const { protocol, recorder, emit } = await harness();
    await recorder.start();
    emit(protocol.pointer('down', 10, 20, 100, 1, { target: frozenTarget({ match: { key: 'ok' } }, { type: 'ElevatedButton' }) }));
    emit(protocol.pointer('up', 10, 20, 200, 1));
    const { code } = await recorder.stop({ testName: 'tap test', lang: 'dart',
      dartAppEntrypoint: 'package:form_demo/recording_replay_main.dart' });
    expect(code).toContain("import 'package:flutter_test/flutter_test.dart'");
    expect(code).toContain("testWidgets('tap test'");
    expect(code).toContain('tester.tap(');
  });

  it('preserves frozen targets while deduplicating events and declaring initial/trailing gaps', async () => {
    const { mock, protocol, recorder, emit } = await harness();
    mock.mockExtension('ext.fliwright.stopRecording', (params) => ({
      ...protocol.response('ext.fliwright.stopRecording', params) as object, lastSequence: 4,
    }));
    mock.mockExtension('ext.fliwright.hitTest', () => { throw new Error('historical hitTest is forbidden'); });
    await recorder.start({ stopFlushTimeoutMs: 0 });
    const target = frozenTarget({ match: { key: 'frozen' } }, { id: 'button-1', type: 'ElevatedButton' });
    emit(protocol.pointer('down', 10, 20, 100, 1, { targetId: 'button-1', target }));
    const up = protocol.pointer('up', 10, 20, 200, 1, { sequence: 3, targetId: 'button-1', target });
    emit(up);
    emit(up);
    const result = await recorder.stop();
    expect(result.status).toBe('partial');
    expect(result.missingSequences).toEqual([2, 4]);
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0].recordedTarget).toMatchObject({ id: 'button-1' });
    expect(mock.sentMessages().filter((message) => message.method === 'ext.fliwright.hitTest')).toHaveLength(0);
  });
});
