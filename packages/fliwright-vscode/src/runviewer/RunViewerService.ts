// packages/fliwright-vscode/src/runviewer/RunViewerService.ts
import * as vscode from 'vscode';
import type { TimelineData, FliwrightLogEvent } from '@fliwright/core';

export interface RunSummary {
  runDir: vscode.Uri;
  runId: string;
  testName: string;
  mode: string;
  status: string;
  startedAt: string;
  endedAt?: string;
  nodeCount: number;
}

export interface LoadedRun {
  timeline: TimelineData;
  logs: FliwrightLogEvent[];
  runDir: vscode.Uri;
}

/**
 * Reads timeline run data from <workspaceRoot>/.fliwright/runs/<runId>/.
 *
 * Each run directory holds:
 *   - timeline.json           (TimelineData — the source of truth)
 *   - logs/events.jsonl       (one FliwrightLogEvent per line)
 *   - artifacts/screenshots/* (PNGs referenced by node artifacts[])
 *
 * Unlike traces, core does not export a reader store for timeline runs, so this
 * service reads the files directly via vscode.workspace.fs.
 */
export class RunViewerService {
  getWorkspaceRoot(): vscode.Uri | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri;
  }

  /**
   * Resolve the <root>/.fliwright/runs directory, or undefined if it does not exist.
   */
  async getRunsDir(root: vscode.Uri): Promise<vscode.Uri | undefined> {
    const runsDir = vscode.Uri.joinPath(root, '.fliwright', 'runs');
    try {
      await vscode.workspace.fs.stat(runsDir);
      return runsDir;
    } catch {
      return undefined;
    }
  }

  /**
   * List all runs that have a timeline.json, newest first (by startedAt).
   * Runs without timeline.json (e.g. an in-progress run that only has logs/) are skipped.
   */
  async listRuns(runsDir: vscode.Uri): Promise<RunSummary[]> {
    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(runsDir);
    } catch {
      return [];
    }

    const summaries: RunSummary[] = [];
    for (const [name, type] of entries) {
      if (type !== vscode.FileType.Directory) continue;
      const runDir = vscode.Uri.joinPath(runsDir, name);
      const timeline = await this.loadTimeline(runDir);
      if (!timeline) continue;
      summaries.push({
        runDir,
        runId: timeline.runId ?? name,
        testName: timeline.testName ?? name,
        mode: timeline.mode,
        status: timeline.status,
        startedAt: timeline.startedAt,
        endedAt: timeline.endedAt,
        nodeCount: timeline.nodes?.length ?? 0,
      });
    }

    summaries.sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''));
    return summaries;
  }

  /**
   * Load the timeline + logs for a single run directory.
   * Returns undefined if there is no readable timeline.json.
   */
  async loadRun(runDir: vscode.Uri): Promise<LoadedRun | undefined> {
    const timeline = await this.loadTimeline(runDir);
    if (!timeline) return undefined;
    const logs = await this.loadLogs(runDir);
    return { timeline, logs, runDir };
  }

  screenshotUri(runDir: vscode.Uri, relPath: string): vscode.Uri {
    return vscode.Uri.joinPath(runDir, relPath);
  }

  private async loadTimeline(runDir: vscode.Uri): Promise<TimelineData | undefined> {
    const uri = vscode.Uri.joinPath(runDir, 'timeline.json');
    try {
      const buf = await vscode.workspace.fs.readFile(uri);
      const parsed = JSON.parse(Buffer.from(buf).toString('utf8')) as TimelineData;
      if (!parsed || !Array.isArray(parsed.nodes)) return undefined;
      return parsed;
    } catch {
      return undefined;
    }
  }

  private async loadLogs(runDir: vscode.Uri): Promise<FliwrightLogEvent[]> {
    const uri = vscode.Uri.joinPath(runDir, 'logs', 'events.jsonl');
    let buf: Uint8Array;
    try {
      buf = await vscode.workspace.fs.readFile(uri);
    } catch {
      return [];
    }
    const text = Buffer.from(buf).toString('utf8');
    const logs: FliwrightLogEvent[] = [];
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        logs.push(JSON.parse(trimmed) as FliwrightLogEvent);
      } catch {
        // Skip malformed lines rather than failing the whole run.
      }
    }
    return logs;
  }
}
