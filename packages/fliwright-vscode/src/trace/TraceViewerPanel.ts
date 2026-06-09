// packages/fliwright-vscode/src/trace/TraceViewerPanel.ts
import * as vscode from 'vscode';
import { TraceService } from './TraceService.js';
import { getTraceHtml } from './getTraceHtml.js';
import type { TraceData } from '@fliwright/core';

export class TraceViewerPanel {
  private panel: vscode.WebviewPanel | undefined;
  private readonly traceService = new TraceService();

  constructor(private readonly extensionUri: vscode.Uri) {}

  /**
   * Open the trace viewer for a specific run.
   */
  async openForRun(traceDir: vscode.Uri, runId: string): Promise<void> {
    const traces = await this.traceService.loadAllTracesForRun(traceDir, runId);
    if (traces.size === 0) {
      vscode.window.showWarningMessage('No trace data found for this run.');
      return;
    }
    await this.show(traceDir, runId, traces);
  }

  /**
   * Open the trace viewer with the latest available trace.
   */
  async openLatest(): Promise<void> {
    const workspaceRoot = this.traceService.getWorkspaceRoot();
    if (!workspaceRoot) {
      vscode.window.showWarningMessage('No workspace folder open.');
      return;
    }

    const traceDir = await this.traceService.getTraceDir(workspaceRoot);
    if (!traceDir) {
      vscode.window.showWarningMessage('No trace data found. Run tests with trace enabled first.');
      return;
    }

    const latest = await this.traceService.findLatestTrace(traceDir);
    if (!latest) {
      vscode.window.showWarningMessage('No trace data found. Run tests with trace enabled first.');
      return;
    }

    const traces = await this.traceService.loadAllTracesForRun(traceDir, latest.runId);
    await this.show(traceDir, latest.runId, traces);
  }

  /**
   * Prompt user to select a run and open it.
   */
  async openWithPicker(): Promise<void> {
    const workspaceRoot = this.traceService.getWorkspaceRoot();
    if (!workspaceRoot) {
      vscode.window.showWarningMessage('No workspace folder open.');
      return;
    }

    const traceDir = await this.traceService.getTraceDir(workspaceRoot);
    if (!traceDir) {
      vscode.window.showWarningMessage('No trace data found. Run tests with trace enabled first.');
      return;
    }

    const runs = await this.traceService.listRuns(traceDir);
    if (runs.length === 0) {
      vscode.window.showWarningMessage('No trace runs found.');
      return;
    }

    const picked = await vscode.window.showQuickPick(
      runs.map(r => ({ label: r.replace(/T.*/, 'T...'), description: `Run ${r}`, runId: r })),
      { placeHolder: 'Select a trace run' },
    );
    if (!picked) return;

    await this.openForRun(traceDir, picked.runId);
  }

  private async show(traceDir: vscode.Uri, runId: string, traces: Map<string, TraceData>): Promise<void> {
    // Build screenshot base URIs
    const screenshotBaseUrls = new Map<string, string>();
    for (const testDir of traces.keys()) {
      const testTraceDir = vscode.Uri.joinPath(traceDir, runId, testDir);
      if (this.panel) {
        screenshotBaseUrls.set(testDir, this.panel.webview.asWebviewUri(testTraceDir).toString());
      } else {
        screenshotBaseUrls.set(testDir, testTraceDir.toString());
      }
    }

    // Create or reveal panel
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
    } else {
      this.panel = vscode.window.createWebviewPanel(
        'fliwright.traceViewer',
        'Fliwright Trace Viewer',
        vscode.ViewColumn.Beside,
        {
          enableScripts: true,
          localResourceRoots: [traceDir, this.extensionUri],
        },
      );
      this.panel.onDidDispose(() => { this.panel = undefined; });
    }

    // Recalculate URIs with the panel's webview
    const screenshotBaseUrlsFinal = new Map<string, string>();
    for (const testDir of traces.keys()) {
      const testTraceDir = vscode.Uri.joinPath(traceDir, runId, testDir);
      screenshotBaseUrlsFinal.set(testDir, this.panel.webview.asWebviewUri(testTraceDir).toString());
    }

    const nonce = getNonce();
    this.panel.webview.html = getTraceHtml(traces, {
      runId,
      cspSource: this.panel.webview.cspSource,
      nonce,
      screenshotBaseUrls: screenshotBaseUrlsFinal,
    });

    // Handle messages from webview (future: step click → source navigation)
    this.panel.webview.onDidReceiveMessage((_msg: unknown) => {
      // Future: open source file at step location
    });
  }
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
