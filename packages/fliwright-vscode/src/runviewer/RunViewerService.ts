// packages/fliwright-vscode/src/runviewer/RunViewerService.ts
import * as vscode from 'vscode';
import type { TimelineData, FliwrightLogEvent, TraceData } from '@fliwright/core';
import { projectRunsRootCandidates } from '../testing/ProjectRunsRoot.js';
import { RunArtifactStore, type RunArtifactIndexEntry } from '../testing/RunArtifactStore.js';
import {
  TIMELINE_FILE_NAME,
  TIMELINE_LOG_EVENTS_FILE,
  TIMELINE_LOGS_DIR,
  TIMELINE_TRACE_DIR,
  TIMELINE_TRACE_FILE,
} from '../viewer/timelineConstants.js';

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
  trace?: TraceData;
  runDir: vscode.Uri;
}

/**
 * Reads timeline run data from run directories.
 *
 * The runs root resolves per-project-first (`~/.fliwright/projects/<project>/runs`,
 * from projectRunsRoot) with a legacy fallback to the project-local
 * `<workspaceRoot>/.fliwright/runs`. Within that root each run directory holds:
 *   - timeline.json           (TimelineData — the source of truth)
 *   - logs/events.jsonl       (one FliwrightLogEvent per line)
 *   - artifacts/screenshots/* (PNGs referenced by node artifacts[])
 *
 * Unlike traces, core does not export a reader store for timeline runs, so this
 * service reads the files directly via vscode.workspace.fs. New runs live under
 * `~/.fliwright/projects/<project>/runs`; project-local `.fliwright/runs` is
 * read only as a legacy fallback.
 */
export class RunViewerService {
  private readonly artifacts = new RunArtifactStore();

  getWorkspaceRoot(): vscode.Uri | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri;
  }

  /**
   * Resolve the runs directory for a workspace root.
   *
   * Prefers the per-project root under the user home
   * (`~/.fliwright/projects/<project>/runs`, from projectRunsRoot); falls back to
   * the legacy project-local `<root>/.fliwright/runs` for back-compat. Returns
   * undefined when neither exists.
   */
  async getRunsDir(root: vscode.Uri): Promise<vscode.Uri | undefined> {
    for (const candidate of projectRunsRootCandidates(root)) {
      const migrated = vscode.Uri.file(candidate.runsDir);
      try {
        await vscode.workspace.fs.stat(migrated);
        return migrated;
      } catch {
        /* keep looking */
      }
    }
    const legacy = vscode.Uri.file(this.artifacts.legacyRunsDir(root));
    try {
      await vscode.workspace.fs.stat(legacy);
      return legacy;
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
    const trace = await this.loadRunTrace(runDir);
    return { timeline, logs, ...(trace ? { trace } : {}), runDir };
  }

  /**
   * Scan runs newest-first and return the first run whose timeline or result
   * matches `testNodeId`. Pure find — no UI.
   *
   * The test node id has the form `<relPath>::<anc1>/<anc2>/.../<title>`. The
   * Timeline directories are written per test by `@fliwright/vitest` under the
   * project runs root and often do not have a sibling result.json. Therefore
   * timeline.json's `testName` is the primary lookup; result.json remains a
   * legacy fallback for older run layouts.
   */
  async findLatestRunForTest(
    runsDir: vscode.Uri,
    testNodeId: string,
  ): Promise<LoadedRun | undefined> {
    const summaries = await this.listRuns(runsDir); // newest-first
    for (const s of summaries) {
      if (timelineSummaryMatchesNode(s, testNodeId)) {
        return this.loadRun(s.runDir);
      }
      const resultJson = await this.readResultJson(s.runDir);
      if (!resultJson) continue;
      if (runResultContainsNode(resultJson, testNodeId)) {
        return this.loadRun(s.runDir);
      }
    }
    return undefined;
  }

  /**
   * Index-first variant of `findLatestRunForTest` for the View button.
   *
   * `index.json` (maintained by `TestStatusStore.recordRun`) already knows the
   * exact latest runId keyed by test node id, so we prefer it as the primary
   * lookup — re-scanning every run's result.json is O(runs×tests) and can
   * return a stale run if timeline/result clocks differ. The scan
   * (`findLatestRunForTest`) remains the fallback when the indexed run's
   * directory has been pruned (loadRun returns undefined for a missing
   * timeline.json) or the index has no entry for the node.
   *
   * Takes the index map explicitly so the lookup is unit-testable without
   * constructing a `TestStatusStore`.
   */
  async findLatestRunForTestIndexed(
    runsDir: vscode.Uri,
    testNodeId: string,
    index: Map<string, { runId: string; resultRunId?: string }>,
  ): Promise<LoadedRun | undefined> {
    const entry = index.get(testNodeId);
    if (entry?.runId) {
      const loaded = await this.loadRun(vscode.Uri.joinPath(runsDir, entry.runId));
      if (loaded) return loaded;
      const derivedRunId = deriveTimelineRunId(entry, testNodeId, this.artifacts);
      if (derivedRunId && derivedRunId !== entry.runId) {
        const derived = await this.loadRun(vscode.Uri.joinPath(runsDir, derivedRunId));
        if (derived) return derived;
      }
      const leafRunId = deriveLeafTimelineRunId(entry, testNodeId, this.artifacts);
      if (leafRunId && leafRunId !== entry.runId && leafRunId !== derivedRunId) {
        const leaf = await this.loadRun(vscode.Uri.joinPath(runsDir, leafRunId));
        if (leaf) return leaf;
      }
      // Indexed run dir is gone (pruned) — fall through to the scan.
    }
    return this.findLatestRunForTest(runsDir, testNodeId);
  }

  /**
   * Scan runs newest-first and return the first script-mode run.
   *
   * For v1, relPath matching is best-effort: we accept the newest run whose
   * timeline.json has `mode === 'script'`. If a script run's testName matches
   * the script's basename we prefer that; otherwise the newest script run wins.
   */
  async findLatestRunForScript(
    runsDir: vscode.Uri,
    scriptRelPath: string,
  ): Promise<LoadedRun | undefined> {
    const summaries = await this.listRuns(runsDir); // newest-first
    const scriptBasename = scriptRelPath.split('/').pop();
    let fallback: LoadedRun | undefined;
    for (const s of summaries) {
      if (s.mode !== 'script') continue;
      const loaded = await this.loadRun(s.runDir);
      if (!loaded) continue;
      // Prefer a script run whose testName matches the script basename.
      if (scriptBasename && loaded.timeline.testName === scriptBasename) {
        return loaded;
      }
      // First (newest) script run is the fallback.
      if (!fallback) fallback = loaded;
    }
    return fallback;
  }

  screenshotUri(runDir: vscode.Uri, relPath: string): vscode.Uri {
    return vscode.Uri.joinPath(runDir, relPath);
  }

  private async readResultJson(runDir: vscode.Uri): Promise<any | undefined> {
    try {
      const buf = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(runDir, 'result.json'));
      return JSON.parse(Buffer.from(buf).toString('utf8'));
    } catch {
      return undefined;
    }
  }

  private async loadTimeline(runDir: vscode.Uri): Promise<TimelineData | undefined> {
    const uri = vscode.Uri.joinPath(runDir, TIMELINE_FILE_NAME);
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
    const uri = vscode.Uri.joinPath(runDir, TIMELINE_LOGS_DIR, TIMELINE_LOG_EVENTS_FILE);
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

  private async loadRunTrace(runDir: vscode.Uri): Promise<TraceData | undefined> {
    const uri = vscode.Uri.joinPath(runDir, TIMELINE_TRACE_DIR, TIMELINE_TRACE_FILE);
    try {
      const buf = await vscode.workspace.fs.readFile(uri);
      const parsed = JSON.parse(Buffer.from(buf).toString('utf8')) as TraceData;
      if (!parsed || !Array.isArray(parsed.steps)) return undefined;
      return parsed;
    } catch {
      return undefined;
    }
  }
}

function deriveTimelineRunId(
  entry: Pick<RunArtifactIndexEntry, 'runId'> & Partial<Pick<RunArtifactIndexEntry, 'resultRunId'>>,
  testNodeId: string,
  artifacts: RunArtifactStore,
): string | undefined {
  const resultRunId = entry.resultRunId ?? entry.runId;
  const chain = testNodeId.split('::')[1];
  if (!chain) return undefined;
  const testName = chain.split('/').join(' > ');
  return artifacts.timelineRunId(resultRunId, testName);
}

function deriveLeafTimelineRunId(
  entry: Pick<RunArtifactIndexEntry, 'runId'> & Partial<Pick<RunArtifactIndexEntry, 'resultRunId'>>,
  testNodeId: string,
  artifacts: RunArtifactStore,
): string | undefined {
  const resultRunId = entry.resultRunId ?? entry.runId;
  const chain = testNodeId.split('::')[1];
  const title = chain?.split('/').filter(Boolean).at(-1);
  if (!title) return undefined;
  return artifacts.timelineRunId(resultRunId, title);
}

function timelineSummaryMatchesNode(summary: Pick<RunSummary, 'testName'>, testNodeId: string): boolean {
  const chain = testNodeId.split('::')[1];
  if (!chain) return false;
  const parts = chain.split('/').filter(Boolean);
  const fullName = parts.join(' > ');
  const leafName = parts.at(-1);
  return summary.testName === fullName || summary.testName === leafName;
}

/**
 * Check whether a run's result.json contains a test matching a Tests-panel
 * node id (`<relPath>::<a>/<b>`). The result names use the vitest full-name
 * form `<a> > <b>`, so the chain after `::` is joined with ` > `.
 */
function runResultContainsNode(resultJson: any, testNodeId: string): boolean {
  const chain = testNodeId.split('::')[1];
  if (!chain) return false;
  const needle = chain.split('/').join(' > ');
  const results = Array.isArray(resultJson?.results) ? resultJson.results : [];
  return results.some((r: any) => r?.name === needle);
}
