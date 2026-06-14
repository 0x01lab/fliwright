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

export interface RecordingListItem {
  id: string;
  label: string;
  description?: string;
  recordingDir: vscode.Uri;
  manifestUri: vscode.Uri;
  manifest: PersistedRecordingManifest;
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

  async list(workspaceRoot: vscode.Uri): Promise<RecordingListItem[]> {
    const recordingsRoot = vscode.Uri.joinPath(workspaceRoot, '.fliwright', 'recordings');
    let entries: [string, unknown][];
    try {
      entries = await vscode.workspace.fs.readDirectory(recordingsRoot) as [string, unknown][];
    } catch {
      return [];
    }

    const recordings: RecordingListItem[] = [];
    for (const [name] of entries) {
      const recordingDir = vscode.Uri.joinPath(recordingsRoot, name);
      const manifestUri = vscode.Uri.joinPath(recordingDir, 'recording.json');
      try {
        const manifest = JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(manifestUri)).toString('utf8')) as PersistedRecordingManifest;
        recordings.push({
          id: manifest.id,
          label: manifest.testName || manifest.id,
          description: `${manifest.operationCount} operations · ${manifest.updatedAt}`,
          recordingDir,
          manifestUri,
          manifest,
        });
      } catch {
        // Ignore corrupt or partial recording directories.
      }
    }
    recordings.sort((a, b) => b.manifest.updatedAt.localeCompare(a.manifest.updatedAt));
    return recordings;
  }

  async load(recordingDir: vscode.Uri): Promise<RecordingSession> {
    const manifestUri = vscode.Uri.joinPath(recordingDir, 'recording.json');
    const manifest = JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(manifestUri)).toString('utf8')) as PersistedRecordingManifest;
    const frames: RecordingFrame[] = [];

    for (const frame of manifest.frames) {
      const { screenshotFile, screenshot, ...rest } = frame;
      let restoredScreenshot: RecordingFrame['screenshot'] | undefined;
      if (screenshotFile && screenshot) {
        const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(recordingDir, ...screenshotFile.split('/')));
        restoredScreenshot = {
          ...screenshot,
          base64: Buffer.from(bytes).toString('base64'),
        };
      }
      frames.push({
        ...rest,
        screenshot: restoredScreenshot,
      });
    }

    return {
      status: 'preview',
      startedAt: Date.parse(manifest.createdAt),
      rawEventCount: manifest.rawEventCount,
      operationCount: manifest.operationCount,
      frames,
      generatedCode: manifest.generatedCode,
      targetFile: manifest.targetFile,
      testName: manifest.testName,
      recordingId: manifest.id,
      recordingDir: recordingDir.fsPath,
    };
  }
}

function createRecordingId(session: RecordingSession): string {
  const startedAt = session.startedAt ?? Date.now();
  return `recording-${startedAt}`;
}
