import type { RecordingFrame } from '@fliwright/core';
import type { RecordingSession } from '../../types.js';

export interface RecordingCanvasSession extends Omit<RecordingSession, 'frames'> {
  frames: RecordingFrame[];
}

export type ExtensionToCanvasMessage =
  | { type: 'session'; session: RecordingCanvasSession };

export type CanvasToExtensionMessage =
  | { type: 'ready' }
  | { type: 'stopRecording' }
  | { type: 'insertRecordedTest' }
  | { type: 'openSavedRecording' }
  | { type: 'setFrameIncluded'; frameId: string; included: boolean };
