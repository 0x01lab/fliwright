import * as vscode from 'vscode';
import type { MockApiTreeProvider } from './MockApiTreeProvider.js';

export class MockApiSearchController implements vscode.Disposable {
  private input: vscode.InputBox | undefined;
  private finishSearch: ((keep: boolean) => void) | undefined;

  constructor(private readonly provider: MockApiTreeProvider) {
    this.setFilter(provider.filter);
  }

  show(): void {
    if (this.input) {
      this.input.show();
      return;
    }
    const previous = this.provider.filter;
    const input = vscode.window.createInputBox();
    this.input = input;
    input.title = 'Search Mock APIs';
    input.placeholder = 'Method, API path, API name or rule name (e.g. POST accounts)';
    input.prompt = 'Type to filter. Enter to keep the search; Escape to cancel.';
    input.value = previous;

    const subscriptions: vscode.Disposable[] = [];
    const finish = (keep: boolean) => {
      if (this.input !== input) return;
      this.input = undefined;
      this.finishSearch = undefined;
      for (const subscription of subscriptions) subscription.dispose();
      if (!keep) this.setFilter(previous);
      input.dispose();
    };
    this.finishSearch = finish;
    subscriptions.push(
      input.onDidChangeValue((value) => this.setFilter(value)),
      input.onDidAccept(() => finish(true)),
      input.onDidHide(() => finish(false)),
    );
    input.show();
  }

  clear(): void {
    this.finishSearch?.(true);
    this.setFilter('');
  }

  dispose(): void {
    this.finishSearch?.(false);
  }

  private setFilter(value: string): void {
    this.provider.setFilter(value);
    void vscode.commands.executeCommand('setContext', 'fliwright.mockApis.hasFilter', Boolean(this.provider.filter));
  }
}
