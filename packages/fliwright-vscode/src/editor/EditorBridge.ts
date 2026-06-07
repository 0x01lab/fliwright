import type { StepModel, ExtToWebview } from './types';

export interface StepResult {
  status: 'pass' | 'fail';
  error?: string;
}

export interface EditorPanel {
  postMessage(message: ExtToWebview): void;
}

export class EditorBridge {
  private panel: EditorPanel | undefined;

  attach(panel: EditorPanel): void {
    this.panel = panel;
  }

  detach(): void {
    this.panel = undefined;
  }

  setLiveMode(active: boolean): void {
    this.panel?.postMessage({ type: 'live-mode', active });
  }

  onStepRecorded(step: StepModel): void {
    this.panel?.postMessage({ type: 'step-added', step });
  }

  onStepResult(stepIndex: number, result: StepResult): void {
    this.panel?.postMessage({
      type: 'run-status',
      stepIndex,
      status: result.status,
      error: result.error,
    });
  }

  onRunComplete(summary: { total: number; passed: number; failed: number }): void {
    void summary;
  }
}
