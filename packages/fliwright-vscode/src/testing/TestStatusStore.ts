import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import type { RunResult, TestCaseResult } from '../types.js';
import { testNodeId } from './types.js';
import type { RunArtifactIndexEntry } from './RunArtifactStore.js';

export type TestStatusEntry = RunArtifactIndexEntry;

export type AssertionStatus = 'passed' | 'failed' | 'running' | 'skipped';

export interface AssertionStatusEntry {
  id: string;
  label: string;
  status: AssertionStatus;
  assertionIndex: number;
  durationMs?: number;
  error?: string;
}

interface IndexMap {
  [nodeId: string]: TestStatusEntry;
}

/**
 * Persists per-test last-run status:
 *  - `<runsDir>/<runId>/result.json` — full RunResult for a run.
 *  - `<runsDir>/index.json` — map keyed by test node id → latest entry.
 *
 * Uses `node:fs/promises` (NOT `vscode.workspace.fs`) for testability.
 */
export class TestStatusStore {
  constructor(private readonly runsDir: string) {}

  get indexUri(): string {
    return join(this.runsDir, 'index.json');
  }

  async loadIndex(): Promise<Map<string, TestStatusEntry>> {
    try {
      const raw = await readFile(this.indexUri, 'utf8');
      const parsed = JSON.parse(raw) as IndexMap;
      return new Map(Object.entries(parsed));
    } catch {
      return new Map();
    }
  }

  private async writeIndex(map: Map<string, TestStatusEntry>): Promise<void> {
    const obj: IndexMap = {};
    for (const [k, v] of map) obj[k] = v;
    await mkdir(this.runsDir, { recursive: true });
    await writeFile(this.indexUri, JSON.stringify(obj, null, 2), 'utf8');
  }

  async recordRun(
    runId: string,
    ranAt: number,
    workspaceRoot: { fsPath: string },
    result: RunResult,
    relPath: string,
  ): Promise<void> {
    const runDir = join(this.runsDir, runId);
    await mkdir(runDir, { recursive: true });
    await writeFile(join(runDir, 'result.json'), JSON.stringify(result, null, 2), 'utf8');

    const map = await this.loadIndex();
    for (const tc of result.results) {
      const { ancestors, title } = splitName(tc.name);
      const tcRelPath = relPathForTestCase(workspaceRoot, relPath, tc);
      const id = testNodeId(tcRelPath, ancestors, title);
      map.set(id, toEntry(runId, ranAt, tc));
    }
    await this.writeIndex(map);
  }


  async loadAssertions(testId: string): Promise<AssertionStatusEntry[]> {
    const index = await this.loadIndex();
    const entry = index.get(testId);
    if (!entry) return [];

    const timeline = await readJson(join(this.runsDir, entry.runId, 'timeline.json'))
      ?? await readJson(join(this.runsDir, entry.resultRunId, 'timeline.json'));
    const nodes: unknown[] = Array.isArray(timeline?.nodes) ? timeline.nodes : [];

    return nodes
      .filter(isTimelineAssertionNode)
      .map((node: TimelineAssertionNode, index: number) => ({
        id: typeof node.id === 'string' ? node.id : `${testId}::assertion-${index + 1}`,
        label: node.title,
        status: node.status,
        assertionIndex: index,
        durationMs: durationMs(node.startedAt, node.endedAt),
        error: typeof node.error?.message === 'string' ? node.error.message : undefined,
      }));
  }

  async pruneDangling(keepRunIds: Set<string>): Promise<void> {
    const map = await this.loadIndex();
    let changed = false;
    for (const [id, entry] of map) {
      if (!keepRunIds.has(entry.runId) && !keepRunIds.has(entry.resultRunId)) {
        map.delete(id);
        changed = true;
      }
    }
    if (changed) await this.writeIndex(map);
  }
}

function toEntry(runId: string, ranAt: number, tc: TestCaseResult): TestStatusEntry {
  return {
    runId: `${runId}-${safeName(tc.name)}`,
    resultRunId: runId,
    status: tc.passed ? 'passed' : 'failed',
    ranAt,
    durationMs: tc.duration || undefined,
    mode: 'test',
  };
}

/**
 * Split a vitest `"suite > case"` name into ancestor titles + the leaf title.
 * Returns `{ ancestors: [], title: name }` when the name has no `' > '` separator.
 */
function splitName(name: string): { ancestors: string[]; title: string } {
  const parts = name.split(' > ').map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return { ancestors: [], title: name };
  return { ancestors: parts.slice(0, -1), title: parts[parts.length - 1] };
}

function relPathForTestCase(
  workspaceRoot: { fsPath: string },
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


interface TimelineAssertionNode {
  id?: unknown;
  kind: 'assertion';
  title: string;
  status: AssertionStatus;
  startedAt?: unknown;
  endedAt?: unknown;
  error?: { message?: unknown };
}


function isTimelineAssertionNode(node: unknown): node is TimelineAssertionNode {
  if (typeof node !== 'object' || node === null) return false;
  const candidate = node as Record<string, unknown>;
  return candidate.kind === 'assertion'
    && typeof candidate.title === 'string'
    && isAssertionStatus(candidate.status);
}

async function readJson(filePath: string): Promise<any | undefined> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return undefined;
  }
}

function isAssertionStatus(value: unknown): value is AssertionStatus {
  return value === 'passed' || value === 'failed' || value === 'running' || value === 'skipped';
}

function durationMs(startedAt: unknown, endedAt: unknown): number | undefined {
  if (typeof startedAt !== 'string' || typeof endedAt !== 'string') return undefined;
  const start = Date.parse(startedAt);
  const end = Date.parse(endedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return undefined;
  return end - start;
}
