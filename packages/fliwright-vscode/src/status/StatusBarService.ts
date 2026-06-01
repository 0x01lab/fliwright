import * as vscode from 'vscode';
import type { DeviceConnectionState, RecordingSession, RunResult } from '../types.js';

export class StatusBarService implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private state: DeviceConnectionState = { status: 'disconnected' };
  private recording: RecordingSession = { status: 'idle', rawEventCount: 0, operationCount: 0 };
  private lastRun: RunResult | undefined;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.command = 'fliwright.connect';
    this.update();
    this.item.show();
  }

  setConnectionState(state: DeviceConnectionState): void {
    this.state = state;
    this.update();
  }

  setRecording(session: RecordingSession): void {
    this.recording = session;
    this.update();
  }

  setRunResult(result: RunResult): void {
    this.lastRun = result;
    this.update();
  }

  dispose(): void {
    this.item.dispose();
  }

  private update(): void {
    if (this.recording.status === 'recording') {
      this.item.text = `$(record) Fliwright: Recording ${this.recording.operationCount}`;
      this.item.command = 'fliwright.stopRecording';
      return;
    }
    if (this.lastRun) {
      this.item.text = this.lastRun.passed
        ? `$(pass) Fliwright: ${this.lastRun.passedTests}/${this.lastRun.totalTests} passed`
        : `$(error) Fliwright: ${this.lastRun.failedTests} failed`;
      this.item.command = 'fliwright.runWorkspaceTests';
      return;
    }
    if (this.state.status === 'connected') {
      this.item.text = '$(plug) Fliwright: Connected';
      this.item.command = 'fliwright.disconnect';
      return;
    }
    if (this.state.status === 'connecting') {
      this.item.text = '$(sync~spin) Fliwright: Connecting';
      return;
    }
    this.item.text = '$(circle-slash) Fliwright: Disconnected';
    this.item.command = 'fliwright.connect';
  }
}
