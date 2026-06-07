import { describe, it, expect, vi } from 'vitest';
import { EditorBridge } from '../src/editor/EditorBridge';
import type { StepModel, ExtToWebview } from '../src/editor/types';

function mockPanel() {
  const messages: ExtToWebview[] = [];
  return {
    postMessage: vi.fn((msg: ExtToWebview) => { messages.push(msg); }),
    messages,
    setLiveMode: vi.fn(),
  };
}

function makeStep(name: string): StepModel {
  return {
    annotation: { name },
    annotationLine: 0,
    atoms: [],
    sourceCode: '',
    sourceStartLine: 1,
    sourceEndLine: 2,
  };
}

describe('EditorBridge', () => {
  it('录制事件转发为 step-added 消息', () => {
    const bridge = new EditorBridge();
    const panel = mockPanel();
    bridge.attach(panel as any);

    const step = makeStep('新步骤');
    bridge.onStepRecorded(step);

    expect(panel.postMessage).toHaveBeenCalledWith({
      type: 'step-added',
      step,
    });
  });

  it('运行结果转发为 run-status 消息', () => {
    const bridge = new EditorBridge();
    const panel = mockPanel();
    bridge.attach(panel as any);

    bridge.onStepResult(2, { status: 'fail', error: 'not visible' });

    expect(panel.postMessage).toHaveBeenCalledWith({
      type: 'run-status',
      stepIndex: 2,
      status: 'fail',
      error: 'not visible',
    });
  });

  it('detach 后不再转发消息', () => {
    const bridge = new EditorBridge();
    const panel = mockPanel();
    bridge.attach(panel as any);
    bridge.detach();

    bridge.onStepRecorded(makeStep('nope'));

    expect(panel.postMessage).not.toHaveBeenCalled();
  });

  it('setLiveMode 发送 live-mode 消息', () => {
    const bridge = new EditorBridge();
    const panel = mockPanel();
    bridge.attach(panel as any);

    bridge.setLiveMode(true);

    expect(panel.postMessage).toHaveBeenCalledWith({
      type: 'live-mode',
      active: true,
    });
  });

  it('无 panel 时静默忽略', () => {
    const bridge = new EditorBridge();
    expect(() => bridge.onStepRecorded(makeStep('ok'))).not.toThrow();
    expect(() => bridge.onStepResult(0, { status: 'pass' })).not.toThrow();
  });
});
