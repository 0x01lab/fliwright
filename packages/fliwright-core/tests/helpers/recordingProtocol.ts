import type { RecordingEventEnvelope } from '../../src/RunContracts.js';
import type { ProtocolMock } from './mockVMService.js';
import type { RecordedTarget, SelectorQuery, WidgetInfo, RecordingSelectorStability } from '../../src/types.js';

export function frozenTarget(query: SelectorQuery, widget: Partial<WidgetInfo> = {}, stability: RecordingSelectorStability = 'key'): RecordedTarget {
  return {
    ...widget, targetId: widget.id ?? 'target-fixture', status: 'resolved',
    candidates: [{ query, stability, matchCount: 1, matchesTarget: true }],
  };
}

/** Explicit v2 producer fixture. Events use the client-owned start session. */
export function createRecordingProtocolFixture() {
  let sessionId = '';
  let sequence = 0;
  let started!: () => void;
  const whenStarted = new Promise<void>((resolve) => { started = resolve; });
  return {
    whenStarted,
    response(method: string, params?: Record<string, unknown>): unknown {
      if (method === 'ext.fliwright.handshake') return {
        protocolVersion: 2, compatible: true,
        bridgeCapabilities: {
          recordingProtocolVersion: 2,
          recordingBeforeDispatchTarget: true,
          recordingFocusedInputController: true,
        },
      };
      if (method === 'ext.fliwright.startRecording') {
        sessionId = String(params?.sessionId ?? '');
        sequence = 0;
        started();
        return { protocolVersion: 2, recording: true, sessionId };
      }
      if (method === 'ext.fliwright.stopRecording') return {
        protocolVersion: 2, recording: false, sessionId, lastSequence: sequence,
      };
      return undefined;
    },
    envelope(payload: RecordingEventEnvelope['payload'], elapsedUs: number, extra: Record<string, unknown> = {}) {
      if (!sessionId) throw new Error('Start the v2 fixture before emitting events.');
      sequence++;
      const target = extra.target as RecordedTarget | undefined;
      return { version: 2, sessionId, sequence, elapsedUs, frameId: `frame-${sequence}`, payload,
        ...(target ? { targetId: target.targetId } : {}), ...extra };
    },
    pointer(phase: 'down' | 'move' | 'up' | 'cancel', x: number, y: number, elapsedUs: number, pointer = 0, extra: Record<string, unknown> = {}) {
      return this.envelope({
        kind: 'pointer', phase, pointer, x, y,
        viewportWidth: 320, viewportHeight: 640, pixelRatio: 1,
      }, elapsedUs, extra);
    },
    text(value: string, elapsedUs: number, extra: Record<string, unknown> = {}) {
      return this.envelope({ kind: 'text', value, focusSessionId: 'focus-1' }, elapsedUs, extra);
    },
  };
}

export function installRecordingProtocol(mock: ProtocolMock) {
  const fixture = createRecordingProtocolFixture();
  for (const method of ['handshake', 'startRecording', 'stopRecording']) {
    const extension = `ext.fliwright.${method}`;
    mock.mockExtension(extension, (params) => fixture.response(extension, params));
  }
  return fixture;
}
