import * as vscode from 'vscode';

export class E2eAutomationStatusBarService implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private enabled: boolean;

  constructor(enabled: boolean) {
    this.enabled = enabled;
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
    this.item.command = 'fliwright.toggleE2eAutomation';
    this.update();
    this.item.show();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.update();
  }

  dispose(): void {
    this.item.dispose();
  }

  private update(): void {
    this.item.text = this.enabled ? '$(shield) E2E: On' : '$(shield) E2E: Off';
    this.item.tooltip = this.enabled
      ? 'E2E Automation Environment is enabled for Fliwright runs.'
      : 'E2E Automation Environment is disabled for Fliwright runs.';
  }
}
