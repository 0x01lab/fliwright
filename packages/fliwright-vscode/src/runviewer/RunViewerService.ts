// packages/fliwright-vscode/src/runviewer/RunViewerService.ts
import * as vscode from 'vscode';
import {
  parseTimelineData,
  summarizeTimeline,
  type TimelineData,
  type FliwrightLogEvent,
  type TraceData,
} from '@fliwright/core';
import { resolveProjectConfig } from '@fliwright/cli';
import { RunArtifactStore, type RunArtifactIndexEntry } from '../testing/RunArtifactStore.js';
import {
  TIMELINE_FILE_NAME,
  TIMELINE_LOG_EVENTS_FILE,
  TIMELINE_LOGS_DIR,
  TIMELINE_TRACE_DIR,
  TIMELINE_TRACE_FILE,
} from '../viewer/timelineConstants.js';
import type { RunManifest } from '@fliwright/core';

export interface RunSummary {
  runDir: vscode.Uri;
  runId: string;
  testName: string;
  mode: string;
  status: string;
  startedAt: string;
  endedAt?: string;
  nodeCount: number;
  manifest?: RunManifest;
  attemptCount?: number;
  testId?: string;
  attemptId?: string;
}

export interface RunSelection {
  testId?: string;
  attemptId?: string;
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
 * Reads the configured project runsRoot; defaults to <workspace>/.fliwright/runs.
 * Attempts own their timeline, logs, trace and evidence. Historical roots are
 * never selected implicitly.
 */
export class RunViewerService {
  private readonly artifacts = new RunArtifactStore();

  getWorkspaceRoot(): vscode.Uri | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri;
  }

  /** Return the configured run history when it exists. */
  async getRunsDir(root: vscode.Uri): Promise<vscode.Uri | undefined> {
    const config = await resolveProjectConfig(root.fsPath);
    const directory = vscode.Uri.file(config.runsRoot!);
    try {
      await vscode.workspace.fs.stat(directory);
      return directory;
    } catch { return undefined; }
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
      const manifest = await this.loadManifest(runDir);
      if (timeline) {
        const summary = summarizeTimeline(timeline);
        summaries.push({
          runDir,
          runId: timeline.runId ?? name,
          testName: timeline.testName ?? name,
          mode: timeline.mode,
          status: timeline.status,
          startedAt: timeline.startedAt,
          endedAt: timeline.endedAt,
          nodeCount: summary.nodeCount,
          ...(manifest ? { manifest, attemptCount: manifest.tests.reduce((count, test) => count + test.attempts.length, 0) } : {}),
        });
        continue;
      }
      // A canonical run directory can contain only run.json and per-test
      // timeline directories. Keep it visible even before a timeline is
      // available so multi-test/attempt runs are inspectable in the viewer.
      if (manifest) {
        for (const test of manifest.tests) {
          for (const attempt of test.attempts) {
            const attemptDir = vscode.Uri.joinPath(runDir, attempt.resultPath, '..');
            const attemptTimeline = await this.loadTimeline(attemptDir);
            if (attemptTimeline) {
              const summary = summarizeTimeline(attemptTimeline);
              summaries.push({
                runDir,
                runId: manifest.runId,
                testName: attemptTimeline.testName ?? test.testId,
                mode: attemptTimeline.mode,
                status: attemptTimeline.status,
                startedAt: attemptTimeline.startedAt,
                endedAt: attemptTimeline.endedAt,
                nodeCount: summary.nodeCount,
                manifest,
                attemptCount: test.attempts.length,
                testId: test.testId,
                attemptId: attempt.attemptId,
              });
            } else {
              summaries.push({
                runDir,
                runId: manifest.runId,
                testName: test.testId,
                mode: 'test',
                status: manifest.status,
                startedAt: '',
                nodeCount: 0,
                manifest,
                attemptCount: test.attempts.length,
                testId: test.testId,
                attemptId: attempt.attemptId,
              });
            }
          }
        }
      }
    }

    summaries.sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''));
    return summaries;
  }

  /**
   * Load the timeline + logs for a single run directory.
   * Returns undefined if there is no readable timeline.json.
   */
  async loadRun(runDir: vscode.Uri, selection: RunSelection = {}): Promise<LoadedRun | undefined> {
    const resolvedDir = await this.resolveTimelineDir(runDir, selection);
    const timeline = resolvedDir ? await this.loadTimeline(resolvedDir) : undefined;
    if (!resolvedDir || !timeline) return undefined;
    const logs = await this.loadLogs(resolvedDir);
    const trace = await this.loadRunTrace(resolvedDir);
    return { timeline, logs, ...(trace ? { trace } : {}), runDir: resolvedDir };
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

    // Canonical runs carry the stable file/suite/test identity in run.json.
    // Resolve that identity before considering legacy title-only layouts, so
    // two files with the same test title cannot select each other's evidence.
    for (const summary of summaries) {
      if (!summary.manifest) continue;
      if (summary.testId !== testNodeId) {
        const test = summary.manifest.tests.find(test => test.testId === summary.testId);
        const attempt = test?.attempts.find(attempt => attempt.attemptId === summary.attemptId);
        if (!attempt || !sourceMatchesNode(await this.readResultJson(
          vscode.Uri.joinPath(summary.runDir, attempt.resultPath, '..')), testNodeId)) continue;
      }
      const loaded = await this.loadRun(summary.runDir, {
        testId: summary.testId,
        ...(summary.attemptId ? { attemptId: summary.attemptId } : {}),
      });
      if (loaded) return loaded;
    }

    for (const s of summaries) {
      // A canonical run that did not match the exact test identity must not
      // fall back to title matching. This is what prevents same-name tests
      // from being attributed to the wrong source file.
      if (s.manifest) continue;
      if (timelineSummaryMatchesNode(s, testNodeId)) {
        return this.loadRun(s.runDir, s);
      }
      const resultJson = await this.readResultJson(s.runDir);
      if (!resultJson) continue;
      if (runResultContainsNode(resultJson, testNodeId)) {
        return this.loadRun(s.runDir, s);
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
      // A canonical run contains multiple tests/attempts. Carry the exact
      // test identity from the index so resolveTimelineDir does not reject a
      // valid run merely because it has more than one attempt.
      const loaded = await this.loadRun(vscode.Uri.joinPath(runsDir, entry.runId), { testId: testNodeId });
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

  /** Find the newest canonical attempt belonging to this exact script file. */
  async findLatestRunForScript(
    runsDir: vscode.Uri,
    scriptRelPath: string,
  ): Promise<LoadedRun | undefined> {
    const summaries = await this.listRuns(runsDir);
    const file = scriptRelPath.split('\\').join('/');
    for (const summary of summaries) {
      if (summary.mode !== 'script' || !summary.manifest || !summary.testId || !summary.attemptId) continue;
      const test = summary.manifest.tests.find(test => test.testId === summary.testId);
      const attempt = test?.attempts.find(attempt => attempt.attemptId === summary.attemptId);
      if (!attempt) continue;
      const result = await this.readResultJson(vscode.Uri.joinPath(summary.runDir, attempt.resultPath, '..'));
      if (result?.testFile !== file) continue;
      const loaded = await this.loadRun(summary.runDir, {
        testId: summary.testId, attemptId: summary.attemptId,
      });
      if (!loaded) continue;
      return loaded;
    }
    return undefined;
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

  private async loadManifest(runDir: vscode.Uri): Promise<RunManifest | undefined> {
    try {
      const buf = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(runDir, 'run.json'));
      const parsed = JSON.parse(Buffer.from(buf).toString('utf8')) as RunManifest;
      if (parsed?.schemaVersion !== 1 || !Array.isArray(parsed.tests)) return undefined;
      return parsed;
    } catch {
      return undefined;
    }
  }

  private async resolveTimelineDir(runDir: vscode.Uri, selection: RunSelection): Promise<vscode.Uri | undefined> {
    if (await this.loadTimeline(runDir)) return runDir;
    const manifest = await this.loadManifest(runDir);
    if (!manifest) return undefined;
    let tests = selection.testId
      ? manifest.tests.filter((test) => test.testId === selection.testId)
      : manifest.tests;
    if (selection.testId && tests.length === 0) {
      tests = [];
      for (const test of manifest.tests) {
        const attempts = [];
        for (const attempt of test.attempts) {
          const result = await this.readResultJson(vscode.Uri.joinPath(runDir, attempt.resultPath, '..'));
          if (sourceMatchesNode(result, selection.testId)) attempts.push(attempt);
        }
        if (attempts.length) tests.push({ ...test, attempts });
      }
    }
    const attempts = tests.flatMap((test) => test.attempts
      .filter((attempt) => !selection.attemptId || attempt.attemptId === selection.attemptId)
      .map((attempt) => vscode.Uri.joinPath(runDir, attempt.resultPath, '..')));
    if (attempts.length !== 1) return undefined;
    return (await this.loadTimeline(attempts[0])) ? attempts[0] : undefined;
  }

  private async loadTimeline(runDir: vscode.Uri): Promise<TimelineData | undefined> {
    const uri = vscode.Uri.joinPath(runDir, TIMELINE_FILE_NAME);
    try {
      const buf = await vscode.workspace.fs.readFile(uri);
      return parseTimelineData(Buffer.from(buf).toString('utf8'));
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

function sourceMatchesNode(result: { testFile?: string; testPath?: string[] } | undefined, nodeId: string): boolean {
  return typeof result?.testFile === 'string' && Array.isArray(result.testPath)
    && `${result.testFile}::${result.testPath.join('/')}` === nodeId;
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
