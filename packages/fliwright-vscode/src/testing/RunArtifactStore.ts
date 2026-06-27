import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import type * as vscode from 'vscode';
import { TraceStore } from '@fliwright/core';
import type { RunResult, TestCaseResult } from '../types.js';
import { testNodeId } from './types.js';
import {
  ensureProjectRunsRoot,
  projectRunsRoot,
  sanitizeProjectPathName,
} from './ProjectRunsRoot.js';

export interface RunArtifactIndexEntry {
  runId: string;
  resultRunId: string;
  status: 'passed' | 'failed';
  ranAt: number;
  durationMs?: number;
  mode?: 'test' | 'script';
}

export interface RunArtifactStoreOptions {
  homeDir?: string;
}

interface IndexMap {
  [nodeId: string]: RunArtifactIndexEntry;
}

export class RunArtifactStore {
  constructor(private readonly options: RunArtifactStoreOptions = {}) {}

  projectRoot(workspaceRoot: vscode.Uri): string {
    return projectRunsRoot(workspaceRoot, this.options).rootDir;
  }

  runsDir(workspaceRoot: vscode.Uri): string {
    return projectRunsRoot(workspaceRoot, this.options).runsDir;
  }

  traceDir(workspaceRoot: vscode.Uri): string {
    return join(this.projectRoot(workspaceRoot), 'traces');
  }

  async ensureRunsDir(workspaceRoot: vscode.Uri): Promise<string> {
    return ensureProjectRunsRoot(workspaceRoot, this.options);
  }

  legacyRunsDir(workspaceRoot: vscode.Uri): string {
    return join(workspaceRoot.fsPath, '.fliwright', 'runs');
  }

  legacyTraceDir(workspaceRoot: vscode.Uri): string {
    return join(workspaceRoot.fsPath, '.fliwright', 'traces');
  }

  indexPath(workspaceRoot: vscode.Uri): string {
    return join(this.runsDir(workspaceRoot), 'index.json');
  }

  generateBaseRunId(): string {
    return TraceStore.generateRunId();
  }

  timelineRunId(baseRunId: string, testName: string): string {
    return `${baseRunId}-${safeName(testName)}`;
  }

  async loadIndex(workspaceRoot: vscode.Uri): Promise<Map<string, RunArtifactIndexEntry>> {
    try {
      const raw = await readFile(this.indexPath(workspaceRoot), 'utf8');
      const parsed = JSON.parse(raw) as IndexMap;
      return new Map(Object.entries(parsed));
    } catch {
      return new Map();
    }
  }

  async writeIndex(
    workspaceRoot: vscode.Uri,
    map: Map<string, RunArtifactIndexEntry>,
  ): Promise<void> {
    const obj: IndexMap = {};
    for (const [k, v] of map) obj[k] = v;
    const runsDir = await this.ensureRunsDir(workspaceRoot);
    await writeFile(join(runsDir, 'index.json'), JSON.stringify(obj, null, 2), 'utf8');
  }

  async recordTestRun(
    workspaceRoot: vscode.Uri,
    result: RunResult,
    relPath: string,
    options: { baseRunId: string; ranAt: number },
  ): Promise<void> {
    const runsDir = await this.ensureRunsDir(workspaceRoot);
    const resultRunId = options.baseRunId;
    const resultRunDir = join(runsDir, resultRunId);
    await mkdir(resultRunDir, { recursive: true });
    await writeFile(join(resultRunDir, 'result.json'), JSON.stringify(result, null, 2), 'utf8');

    const map = await this.loadIndex(workspaceRoot);
    for (const tc of result.results) {
      const { ancestors, title } = splitName(tc.name);
      const tcRelPath = relPathForTestCase(workspaceRoot, relPath, tc);
      const id = testNodeId(tcRelPath, ancestors, title);
      map.set(id, toEntry(options.baseRunId, options.ranAt, tc));
    }
    await this.writeIndex(workspaceRoot, map);
    await this.pruneUnreferencedTestRunDirs(workspaceRoot, map);
  }

  async pruneDangling(workspaceRoot: vscode.Uri, keepRunIds: Set<string>): Promise<void> {
    const map = await this.loadIndex(workspaceRoot);
    let changed = false;
    for (const [id, entry] of map) {
      if (!keepRunIds.has(entry.runId) && !keepRunIds.has(entry.resultRunId)) {
        map.delete(id);
        changed = true;
      }
    }
    if (changed) await this.writeIndex(workspaceRoot, map);
  }

  async pruneUnreferencedTestRunDirs(
    workspaceRoot: vscode.Uri,
    index?: Map<string, RunArtifactIndexEntry>,
  ): Promise<number> {
    const runsDir = this.runsDir(workspaceRoot);
    const keepRunIds = runIdsReferencedByIndex(index ?? await this.loadIndex(workspaceRoot));
    let deleted = 0;
    let entries: string[];
    try {
      entries = await readdir(runsDir);
    } catch {
      return 0;
    }

    for (const entry of entries) {
      if (keepRunIds.has(entry)) continue;
      const runDir = join(runsDir, entry);
      let dirStat;
      try {
        dirStat = await stat(runDir);
      } catch {
        continue;
      }
      if (!dirStat.isDirectory()) continue;
      if (!await isPrunableTestRunDir(runDir)) continue;
      await rm(runDir, { recursive: true, force: true });
      deleted += 1;
    }
    return deleted;
  }
}

export { sanitizeProjectPathName };

function toEntry(
  baseRunId: string,
  ranAt: number,
  tc: TestCaseResult,
): RunArtifactIndexEntry {
  const runId = `${baseRunId}-${safeName(tc.name)}`;
  return {
    runId,
    resultRunId: baseRunId,
    status: tc.passed ? 'passed' : 'failed',
    ranAt,
    durationMs: tc.duration || undefined,
    mode: 'test',
  };
}

function runIdsReferencedByIndex(index: Map<string, RunArtifactIndexEntry>): Set<string> {
  const out = new Set<string>();
  for (const entry of index.values()) {
    out.add(entry.runId);
    out.add(entry.resultRunId);
  }
  return out;
}

async function isPrunableTestRunDir(runDir: string): Promise<boolean> {
  const timeline = await readJson(join(runDir, 'timeline.json'));
  if (timeline) return timeline.mode !== 'script';
  return Boolean(await readJson(join(runDir, 'result.json')));
}

async function readJson(filePath: string): Promise<any | undefined> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return undefined;
  }
}

function splitName(name: string): { ancestors: string[]; title: string } {
  const parts = name.split(' > ').map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return { ancestors: [], title: name };
  return { ancestors: parts.slice(0, -1), title: parts[parts.length - 1] };
}

function relPathForTestCase(
  workspaceRoot: vscode.Uri,
  fallbackRelPath: string,
  tc: TestCaseResult,
): string {
  if (!tc.filePath) return fallbackRelPath;
  if (!isAbsolute(tc.filePath) && !tc.filePath.includes('/') && fallbackRelPath.endsWith(`/${tc.filePath}`)) {
    return fallbackRelPath;
  }
  return normalizeRelPath(
    isAbsolute(tc.filePath)
      ? relative(workspaceRoot.fsPath, tc.filePath)
      : tc.filePath,
  );
}

function normalizeRelPath(value: string): string {
  return value.replace(/\\/g, '/');
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'test';
}
