// packages/fliwright-vscode/src/trace/TraceService.ts
import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { TraceStore } from '@fliwright/core';
import type { TraceData, TraceMeta } from '@fliwright/core';

/**
 * Service for reading trace data from the workspace.
 */
export class TraceService {
  /**
   * Find the .fliwright/traces directory in the workspace.
   */
  async getTraceDir(workspaceRoot: vscode.Uri): Promise<vscode.Uri | undefined> {
    const traceDir = vscode.Uri.joinPath(workspaceRoot, '.fliwright', 'traces');
    try {
      await vscode.workspace.fs.stat(traceDir);
      return traceDir;
    } catch {
      return undefined;
    }
  }

  /**
   * List all runs, newest first.
   */
  async listRuns(traceDir: vscode.Uri): Promise<string[]> {
    return TraceStore.listRuns(traceDir.fsPath);
  }

  /**
   * List test directories within a run.
   */
  async listTests(traceDir: vscode.Uri, runId: string): Promise<string[]> {
    return TraceStore.listTests(traceDir.fsPath, runId);
  }

  /**
   * Load a specific trace.
   */
  async loadTrace(traceDir: vscode.Uri, runId: string, testDir: string): Promise<TraceData | null> {
    return TraceStore.loadTrace(traceDir.fsPath, runId, testDir);
  }

  /**
   * Load all traces for a run.
   */
  async loadAllTracesForRun(traceDir: vscode.Uri, runId: string): Promise<Map<string, TraceData>> {
    return TraceStore.loadAllTracesForRun(traceDir.fsPath, runId);
  }

  /**
   * Get the URI for a step screenshot.
   */
  getScreenshotUri(traceDir: vscode.Uri, runId: string, testDir: string, screenshotFile: string): vscode.Uri {
    return vscode.Uri.file(path.join(traceDir.fsPath, runId, testDir, screenshotFile));
  }

  /**
   * Delete old runs, keeping only the N most recent.
   */
  async cleanupOldRuns(traceDir: vscode.Uri, keepCount = 10): Promise<number> {
    return TraceStore.cleanupOldRuns(traceDir.fsPath, keepCount);
  }

  /**
   * Find the latest run with trace data.
   * Returns { runId, testDir, traceData } for the first test in the latest run.
   */
  async findLatestTrace(traceDir: vscode.Uri): Promise<{ runId: string; testDir: string; trace: TraceData } | null> {
    const runs = await this.listRuns(traceDir);
    for (const runId of runs) {
      const tests = await this.listTests(traceDir, runId);
      for (const testDir of tests) {
        const trace = await this.loadTrace(traceDir, runId, testDir);
        if (trace) return { runId, testDir, trace };
      }
    }
    return null;
  }

  /**
   * Get the workspace root URI.
   */
  getWorkspaceRoot(): vscode.Uri | undefined {
    const folders = vscode.workspace.workspaceFolders;
    return folders?.[0]?.uri;
  }
}
