import * as path from 'node:path';
import * as vscode from 'vscode';
import type { CodegenOptions, FliwrightDriver } from '@fliwright/core';
import type { RecordingSession } from '../types.js';

export interface RecordingStartOptions {
  testName?: string;
  onDidChange?: (session: RecordingSession) => void;
}

export class RecorderService {
  private session: RecordingSession = { status: 'idle', rawEventCount: 0, operationCount: 0 };
  private onDidChange: ((session: RecordingSession) => void) | undefined;

  getSession(): RecordingSession {
    return { ...this.session };
  }

  reset(): RecordingSession {
    this.session = { status: 'idle', rawEventCount: 0, operationCount: 0 };
    this.onDidChange = undefined;
    return this.getSession();
  }

  async start(driver: FliwrightDriver, options: RecordingStartOptions = {}): Promise<RecordingSession> {
    const startedAt = Date.now();
    this.onDidChange = options.onDidChange;
    this.setSession({
      status: 'recording',
      startedAt,
      rawEventCount: 0,
      operationCount: 0,
      testName: options.testName,
    });
    await driver.recorder.start({
      onOperation: () => {
        this.setSession({
          ...this.session,
          rawEventCount: driver.recorder.getRawEvents().length,
          operationCount: driver.recorder.getOperations().length,
        });
      },
    });
    return this.getSession();
  }

  async stop(driver: FliwrightDriver, targetFile?: vscode.Uri, options: CodegenOptions = {}): Promise<RecordingSession> {
    const generatedCode = await driver.recorder.stop({
      lang: 'ts',
      testName: this.session.testName,
      ...options,
    });
    this.setSession({
      status: 'preview',
      startedAt: this.session.startedAt,
      rawEventCount: driver.recorder.getRawEvents().length,
      operationCount: driver.recorder.getOperations().length,
      generatedCode,
      targetFile: targetFile?.fsPath,
      testName: options.testName ?? this.session.testName,
    });
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
    return target;
  }

  private setSession(session: RecordingSession): void {
    this.session = session;
    this.onDidChange?.(this.getSession());
  }
}
