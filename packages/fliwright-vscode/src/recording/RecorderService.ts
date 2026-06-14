import * as path from 'node:path';
import * as vscode from 'vscode';
import type { CodegenOptions, FliwrightDriver, RecordingFrame } from '@fliwright/core';
import type { RecordingSession } from '../types.js';
import { RecordingPersistenceService, type RecordingListItem } from './RecordingPersistenceService.js';

type RecorderLike = FliwrightDriver['recorder'] & {
  getFrames?: () => RecordingFrame[];
  setOperationIncluded?: (operationIndex: number, included: boolean) => string;
};

export interface RecordingStartOptions {
  testName?: string;
  onDidChange?: (session: RecordingSession) => void;
  /** 每录制一个操作时的回调 */
  onStepRecorded?: (step: { action: string; selector: string; timestamp: number }) => void;
}

export class RecorderService {
  private session: RecordingSession = { status: 'idle', rawEventCount: 0, operationCount: 0, frames: [] };
  private onDidChange: ((session: RecordingSession) => void) | undefined;
  private onStepRecorded: ((step: { action: string; selector: string; timestamp: number }) => void) | undefined;
  private readonly persistence = new RecordingPersistenceService();

  getSession(): RecordingSession {
    return { ...this.session };
  }

  reset(): RecordingSession {
    this.session = { status: 'idle', rawEventCount: 0, operationCount: 0, frames: [] };
    this.onDidChange = undefined;
    this.onStepRecorded = undefined;
    return this.getSession();
  }

  listPersistedRecordings(workspaceRoot: vscode.Uri): Promise<RecordingListItem[]> {
    return this.persistence.list(workspaceRoot);
  }

  async loadPersistedRecording(recordingDir: vscode.Uri): Promise<RecordingSession> {
    const session = await this.persistence.load(recordingDir);
    this.setSession(session);
    return this.getSession();
  }

  async start(driver: FliwrightDriver, options: RecordingStartOptions = {}): Promise<RecordingSession> {
    const startedAt = Date.now();
    this.onDidChange = options.onDidChange;
    this.onStepRecorded = options.onStepRecorded;
    this.setSession({
      status: 'recording',
      startedAt,
      rawEventCount: 0,
      operationCount: 0,
      frames: [],
      testName: options.testName,
    });
    await driver.recorder.start({
      captureScreenshots: true,
      filterNoise: true,
      onOperation: () => {
        this.setSession({
          ...this.session,
          rawEventCount: driver.recorder.getRawEvents().length,
          operationCount: driver.recorder.getOperations().length,
          frames: getRecorderFrames(driver.recorder),
        });
      },
      onFrame: () => {
        this.setSession({
          ...this.session,
          rawEventCount: driver.recorder.getRawEvents().length,
          operationCount: driver.recorder.getOperations().length,
          frames: getRecorderFrames(driver.recorder),
        });
      },
    });
    return this.getSession();
  }

  async stop(driver: FliwrightDriver, targetFile?: vscode.Uri, options: CodegenOptions = {}, workspaceRoot?: vscode.Uri): Promise<RecordingSession> {
    const generatedCode = await driver.recorder.stop({
      lang: 'ts',
      testName: this.session.testName,
      resetToHomeBeforeEach: true,
      homeRoute: '/',
      ...options,
    });
    this.setSession({
      status: 'preview',
      startedAt: this.session.startedAt,
      rawEventCount: driver.recorder.getRawEvents().length,
      operationCount: driver.recorder.getOperations().length,
      frames: getRecorderFrames(driver.recorder),
      generatedCode,
      targetFile: targetFile?.fsPath,
      testName: options.testName ?? this.session.testName,
      recordingId: this.session.recordingId ?? `recording-${this.session.startedAt ?? Date.now()}`,
    });
    if (workspaceRoot) await this.persistSession(workspaceRoot);
    return this.getSession();
  }

  async insertGeneratedCode(): Promise<vscode.Uri> {
    if (!this.session.generatedCode) {
      throw new Error('Stop recording before inserting generated code.');
    }

    const active = vscode.window.activeTextEditor;
    if (!active) {
      throw new Error('Open a TypeScript test file before inserting recorded code, or save it as a new file.');
    }

    await active.edit((builder) => {
      builder.insert(active.selection.active, `\n${this.session.generatedCode}\n`);
    });
    this.setSession({ ...this.session, targetFile: active.document.uri.fsPath });
    return active.document.uri;
  }

  async setFrameIncluded(driver: FliwrightDriver, frameId: string, included: boolean, workspaceRoot?: vscode.Uri): Promise<RecordingSession> {
    const frame = this.session.frames?.find((candidate) => candidate.id === frameId);
    if (!frame || frame.operationIndex == null) {
      throw new Error('This frame is not associated with a generated operation yet.');
    }
    const recorder = driver.recorder as RecorderLike;
    if (typeof recorder.setOperationIncluded !== 'function') {
      throw new Error('The connected recorder does not support manual frame filtering.');
    }
    const generatedCode = recorder.setOperationIncluded(frame.operationIndex, included);
    this.setSession({
      ...this.session,
      frames: getRecorderFrames(recorder),
      operationCount: recorder.getOperations().length,
      rawEventCount: recorder.getRawEvents().length,
      generatedCode: this.session.status === 'preview' ? generatedCode : this.session.generatedCode,
    });
    if (workspaceRoot) await this.persistSession(workspaceRoot);
    return this.getSession();
  }

  async saveGeneratedCode(workspaceRoot: vscode.Uri, targetFile?: vscode.Uri): Promise<vscode.Uri> {
    if (!this.session.generatedCode) {
      throw new Error('Stop recording before saving generated code.');
    }

    const target = targetFile ?? vscode.Uri.file(path.join(
      workspaceRoot.fsPath,
      'tests',
      `recorded-${Date.now()}.test.ts`,
    ));
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(target.fsPath)));
    await vscode.workspace.fs.writeFile(target, Buffer.from(`${this.session.generatedCode}\n`, 'utf8'));
    await vscode.window.showTextDocument(target);
    this.setSession({ ...this.session, targetFile: target.fsPath });
    await this.persistSession(workspaceRoot);
    return target;
  }

  private setSession(session: RecordingSession): void {
    this.session = session;
    this.onDidChange?.(this.getSession());
  }

  private async persistSession(workspaceRoot: vscode.Uri): Promise<void> {
    if (this.session.status !== 'preview') return;
    const recordingDir = await this.persistence.save(workspaceRoot, this.session, this.session.recordingId);
    this.setSession({
      ...this.session,
      recordingId: this.session.recordingId ?? recordingDir.fsPath.split(/[\\/]/).pop(),
      recordingDir: recordingDir.fsPath,
    });
  }
}

function getRecorderFrames(recorder: RecorderLike): RecordingFrame[] {
  return typeof recorder.getFrames === 'function' ? recorder.getFrames() : [];
}
