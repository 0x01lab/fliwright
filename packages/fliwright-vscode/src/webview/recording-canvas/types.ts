import type { RecordingFrame } from '@fliwright/core';
import type { FlowCleanPlan, FliwrightFlowDocument } from '@fliwright/core';
import type { RecordingSession } from '../../types.js';

export interface RecordingCanvasSession extends Omit<RecordingSession, 'frames'> {
  frames: RecordingFrame[];
}

export type ExtensionToCanvasMessage =
  | { type: 'session'; session: RecordingCanvasSession }
  | {
    type: 'flowCleanResult';
    requestId: string;
    result?: {
      flow: FliwrightFlowDocument;
      plan: FlowCleanPlan;
      applied: boolean;
    };
    error?: string;
  };

export type CanvasToExtensionMessage =
  | { type: 'ready' }
  | { type: 'startRecording' }
  | { type: 'stopRecording' }
  | { type: 'insertRecordedTest' }
  | { type: 'openSavedRecording' }
  | { type: 'setFrameIncluded'; frameId: string; included: boolean }
  | { type: 'cleanFlow'; requestId: string; apply?: boolean; instructions?: string }
  | { type: 'updateFlow'; flow: FliwrightFlowDocument };
