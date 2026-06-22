// packages/fliwright-vscode/src/trace/TraceService.ts
import * as vscode from 'vscode';
import * as path from 'node:path';
import { TraceStore } from '@fliwright/core';
import type { TraceData } from '@fliwright/core';
import { projectRunsRootCandidates } from '../testing/ProjectRunsRoot.js';
import { RunArtifactStore } from '../testing/RunArtifactStore.js';

/**
 * Service for reading trace data from the workspace.
 */
export class TraceService {
  private readonly artifacts = new RunArtifactStore();

  /**
   * Find the .fliwright/traces directory in the workspace.
   */
  async getTraceDir(workspaceRoot: vscode.Uri): Promise<vscode.Uri | undefined> {
    for (const candidate of projectRunsRootCandidates(workspaceRoot)) {
      const traceDir = vscode.Uri.file(path.join(candidate.rootDir, 'traces'));
      try {
        await vscode.workspace.fs.stat(traceDir);
        return traceDir;
      } catch {
        const accidentalRunsRoot = vscode.Uri.file(candidate.runsDir);
        try {
          await vscode.workspace.fs.stat(accidentalRunsRoot);
          const runs = await TraceStore.listRuns(accidentalRunsRoot.fsPath);
          if (runs.length > 0) return accidentalRunsRoot;
        } catch {
          /* keep looking */
        }
      }
    }

    const traceDir = vscode.Uri.file(this.artifacts.legacyTraceDir(workspaceRoot));
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
