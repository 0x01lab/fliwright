import * as vscode from 'vscode';
import type { RecordingFrame } from '@fliwright/core';
import type { RecordingSession } from '../types.js';

export interface PersistedRecordingManifest {
  version: 1;
  id: string;
  createdAt: string;
  updatedAt: string;
  status: RecordingSession['status'];
  rawEventCount: number;
  operationCount: number;
  testName?: string;
  targetFile?: string;
  generatedCode?: string;
  frames: Array<Omit<RecordingFrame, 'screenshot'> & {
    screenshotFile?: string;
    screenshot?: Omit<NonNullable<RecordingFrame['screenshot']>, 'base64'>;
  }>;
}

export class RecordingPersistenceService {
  async save(workspaceRoot: vscode.Uri, session: RecordingSession, recordingId = createRecordingId(session)): Promise<vscode.Uri> {
    const recordingDir = vscode.Uri.joinPath(workspaceRoot, '.fliwright', 'recordings', recordingId);
    const screenshotsDir = vscode.Uri.joinPath(recordingDir, 'screenshots');
    await vscode.workspace.fs.createDirectory(screenshotsDir);

    const frames: PersistedRecordingManifest['frames'] = [];
    for (const frame of session.frames ?? []) {
      const { screenshot, ...rest } = frame;
      const screenshotFile = screenshot?.base64 ? `screenshots/frame-${String(frame.index + 1).padStart(4, '0')}.png` : undefined;
      if (screenshot?.base64 && screenshotFile) {
        await vscode.workspace.fs.writeFile(
          vscode.Uri.joinPath(recordingDir, ...screenshotFile.split('/')),
          Buffer.from(screenshot.base64, 'base64'),
        );
      }
      frames.push({
        ...rest,
        screenshotFile,
        screenshot: screenshot
          ? {
              format: screenshot.format,
              width: screenshot.width,
              height: screenshot.height,
              pixelRatio: screenshot.pixelRatio,
            }
          : undefined,
      });
    }

    const now = new Date().toISOString();
    const manifest: PersistedRecordingManifest = {
      version: 1,
      id: recordingId,
      createdAt: now,
      updatedAt: now,
      status: session.status,
      rawEventCount: session.rawEventCount,
      operationCount: session.operationCount,
      testName: session.testName,
      targetFile: session.targetFile,
      generatedCode: session.generatedCode,
      frames,
    };
    await vscode.workspace.fs.writeFile(
      vscode.Uri.joinPath(recordingDir, 'recording.json'),
      Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8'),
    );
    return recordingDir;
  }
}

function createRecordingId(session: RecordingSession): string {
  const startedAt = session.startedAt ?? Date.now();
  return `recording-${startedAt}`;
}
