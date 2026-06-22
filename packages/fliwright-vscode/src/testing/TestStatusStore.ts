import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RunResult, TestCaseResult } from '../types.js';
import { testNodeId } from './types.js';
import type { RunArtifactIndexEntry } from './RunArtifactStore.js';

export type TestStatusEntry = RunArtifactIndexEntry;

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
    _workspaceRoot: { fsPath: string },
    result: RunResult,
    relPath: string,
  ): Promise<void> {
    const runDir = join(this.runsDir, runId);
    await mkdir(runDir, { recursive: true });
    await writeFile(join(runDir, 'result.json'), JSON.stringify(result, null, 2), 'utf8');

    const map = await this.loadIndex();
    for (const tc of result.results) {
      const { ancestors, title } = splitName(tc.name);
      const id = testNodeId(relPath, ancestors, title);
      map.set(id, toEntry(runId, ranAt, tc));
    }
    await this.writeIndex(map);
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

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'test';
}
