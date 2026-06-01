import * as path from 'node:path';
import * as vscode from 'vscode';
import type { FliwrightDriver } from '@fliwright/core';
import type { RecordingSession } from '../types.js';

export class RecorderService {
  private session: RecordingSession = { status: 'idle', rawEventCount: 0, operationCount: 0 };

  getSession(): RecordingSession {
    return { ...this.session };
  }

  async start(driver: FliwrightDriver): Promise<RecordingSession> {
    const startedAt = Date.now();
    this.session = { status: 'recording', startedAt, rawEventCount: 0, operationCount: 0 };
    await driver.recorder.start({
      onOperation: () => {
        this.session = {
          ...this.session,
          rawEventCount: driver.recorder.getRawEvents().length,
          operationCount: driver.recorder.getOperations().length,
        };
      },
    });
    return this.getSession();
  }

  async stop(driver: FliwrightDriver, targetFile?: vscode.Uri): Promise<RecordingSession> {
    const generatedCode = await driver.recorder.stop({ lang: 'ts' });
    this.session = {
      status: 'preview',
      startedAt: this.session.startedAt,
      rawEventCount: driver.recorder.getRawEvents().length,
      operationCount: driver.recorder.getOperations().length,
      generatedCode,
      targetFile: targetFile?.fsPath,
    };
    return this.getSession();
  }

  async insertGeneratedCode(workspaceRoot: vscode.Uri): Promise<vscode.Uri> {
    if (!this.session.generatedCode) {
      throw new Error('Stop recording before inserting generated code.');
    }

    const active = vscode.window.activeTextEditor;
    if (active) {
      await active.edit((builder) => {
        builder.insert(active.selection.active, `\n${this.session.generatedCode}\n`);
      });
      return active.document.uri;
    }

    const target = vscode.Uri.file(path.join(workspaceRoot.fsPath, 'tests', `recorded-${Date.now()}.test.ts`));
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(target.fsPath)));
    await vscode.workspace.fs.writeFile(target, Buffer.from(`${this.session.generatedCode}\n`, 'utf8'));
    await vscode.window.showTextDocument(target);
    this.session = { ...this.session, targetFile: target.fsPath };
    return target;
  }
}
