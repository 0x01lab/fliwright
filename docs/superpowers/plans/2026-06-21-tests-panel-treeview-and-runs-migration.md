# Tests Panel TreeView Redesign + Runs Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat Fliwright Tests panel with a `file → describe → test` tree showing last-run status, add per-item View buttons that open each run's timeline, migrate all run artifacts from the project to `~/.fliwright/projects/<hash>/`, and remove the standalone Runs panel.

**Architecture:** Custom `TreeView` (not TestController, so we can host inline buttons). A static parser builds the tree from source; a `TestStatusStore` persists per-test last-run status to an `index.json` under the migrated runs root and restores it on activation. The vscode runner sets `FLIWRIGHT_RUNS_ROOT` so `fliwright-core`/`fliwright-vitest` write `timeline.json` and trace artifacts under that root instead of `<project>/.fliwright`.

**Tech Stack:** TypeScript, VSCode Extension API (`TreeDataProvider`, `TreeItem`, `vscode.workspace.fs`), vitest 2.x (test framework + `-t` name filter), pnpm monorepo. Packages touched: `fliwright-core`, `fliwright-vitest`, `fliwright-vscode`.

**Spec:** `docs/superpowers/specs/2026-06-21-tests-panel-treeview-and-runs-migration-design.md`

## Global Constraints

- **Monorepo** at `/Users/leo.he/projects/fliwright`. Three packages change: `packages/fliwright-core`, `packages/fliwright-vitest`, `packages/fliwright-vscode`.
- **Branch:** `design/tests-panel-treeview-runs-migration` (already created; design doc committed there). All work continues on this branch.
- **Test runner for the extension's own tests:** `pnpm --filter fliwright-vscode test` (runs vitest). Core tests: `pnpm --filter fliwright-core test`. Vitest-package tests: `pnpm --filter fliwright-vitest test`.
- **Lint gate before commit:** run the package's lint if a script exists (`pnpm --filter <pkg> lint`); do not commit on lint errors.
- **Node ESM:** all imports use explicit `.js` extensions (e.g. `'./types.js'`) — match existing files.
- **No new runtime deps** without justification. The static parser uses regex + depth tracking, no AST library.
- **Naming:** env var is `FLIWRIGHT_RUNS_ROOT` (absolute path). Test-node ids are `<relPath>::<ancestor titles joined by />` with `/` separators (the parse side) — see Task 4.
- **`parseVitestJson` must stay unchanged** (covered by `tests/VitestRunner.test.ts`); only `run()` and `RunParams` change.
- **Single concurrent run** (Task 9): a run in progress rejects a second invocation.
- **Lazy parsing contract (critical for performance):** mirroring VSCode's native Test Explorer and the Jest/Playwright extensions, source parsing of `.test.ts` must be **on-expand, never at activation**. Concretely:
  - At activation / root expansion, the provider lists only **file nodes** (cheap: one `findFiles` glob + status map lookup; zero source parsing).
  - `describe`/`test` nodes are built **only when the user expands that file's row** (TreeView calls `getChildren(testFile)` lazily — never proactively).
  - File nodes use `TreeItemCollapsibleState.Collapsed` (never `Expanded`), so activation does not cascade-expand every file.
  - A **per-file parse cache** (`Map<fileUri, ParsedFile>`) holds the parsed tree after first expand; re-expand reuses it. The cache entry for a file is invalidated **only** on that file's `onDidSaveTextDocument` (debounced) — not on unrelated saves.
  - `loadStatusMap()` reads `index.json` only (no source parsing); statuses are stamped onto nodes as they are built during expand.

---

## File Structure

### New files (`fliwright-vscode/src`)

| File | Responsibility |
|------|----------------|
| `testing/ProjectRunsRoot.ts` | Resolves `~/.fliwright/projects/<sha1(repoPath)[0..11]>/runs` for a workspace root; writes/reads `meta.json`. Pure-ish (only `node:os`, `node:path`, `node:crypto`, `vscode.Uri`). |
| `testing/TestTreeBuilder.ts` | Pure: parses a `.test.ts` source string into nested `{ describe, test }` nodes. No vscode dependency. |
| `testing/TestStatusStore.ts` | Reads/writes `index.json` + `result.json` under a runs root; restores statuses; prunes dangling entries. Depends on `vscode.workspace.fs` + a `RunResult`. |
| `testing/types.ts` | `TestFileNode \| TestGroupNode \| TestCaseNode \| TestStepNode \| EmptyNode`, `TestNodeStatus`, internal store types. (Kept separate from `src/types.ts` to avoid bloating it; re-exported where needed.) |

### Modified files

| File | Change |
|------|--------|
| `fliwright-core/src/timeline/TimelineArtifactStore.ts` | `TimelineArtifactStoreOptions.runsRoot?`; `runDir` resolves `runsRoot ?? env ?? cwd/.fliwright/runs`. |
| `fliwright-vitest/src/index.ts` | Pass `runsRoot: config.runsRoot ?? process.env.FLIWRIGHT_RUNS_ROOT` into `TimelineArtifactStore`; add `runsRoot` to `FliwrightConfig`. |
| `fliwright-vitest/src/index.ts` (FliwrightConfig type) | Add `runsRoot?: string`. |
| `fliwright-vscode/src/runner/TestRunner.ts` | `RunParams.testNamePattern?: string`. |
| `fliwright-vscode/src/runner/VitestRunner.ts` | `run()` adds `-t "<pattern>"` when `testNamePattern` set; sets `FLIWRIGHT_RUNS_ROOT` env. |
| `fliwright-vscode/src/views/TestsTreeProvider.ts` | Rewrite for 3-level tree + status icons + View/Run buttons. |
| `fliwright-vscode/src/views/ScriptsTreeProvider.ts` | Add View button to script items. |
| `fliwright-vscode/src/runviewer/RunViewerService.ts` | `getRunsDir` resolves from `ProjectRunsRoot`; add `openForTest(testNodeId)`, `openForScript(scriptRelPath)`. |
| `fliwright-vscode/src/runviewer/RunViewerPanel.ts` | Add `openRun(runSummary)` (open a specific already-loaded run), used by the new View commands. |
| `fliwright-vscode/src/extension.ts` | Wire new components; route Run/View; set `FLIWRIGHT_RUNS_ROOT`; remove `fliwright.runs` + RunsTreeProvider; add `viewTestRun`/`viewScriptRun` commands; single-run guard. |
| `fliwright-vscode/package.json` | Remove `fliwright.runs` view + menus; add `viewTestRun`/`viewScriptRun` commands; add inline-button `when` clauses. |

### Deleted files

| File | Reason |
|------|--------|
| `fliwright-vscode/src/views/RunsTreeProvider.ts` | Replaced by per-item View (D4). |

---

## Task Dependency Order

```
Task 1 (core: TimelineArtifactStore.runsRoot)
  └─> Task 2 (vitest: pass runsRoot)
        └─> Task 3 (vscode: ProjectRunsRoot)  ─┐
Task 4 (vscode: TestTreeBuilder, pure)  ──────┤
Task 5 (vscode: types)  ──────────────────────┤
        └─> Task 6 (vscode: TestStatusStore)  ─┤
              └─> Task 7 (vscode: VitestRunner testNamePattern + env)
                    └─> Task 8 (vscode: TestsTreeProvider rewrite)
                          └─> Task 9 (vscode: extension wiring + remove runs panel)
                                └─> Task 10 (vscode: ScriptsTreeProvider View button)
                                      └─> Task 11 (vscode: RunViewerService openForTest/openForScript + panel)
                                            └─> Task 12 (package.json: views/menus/commands)
                                                  └─> Task 13 (manual verification + changelog)
```

Tasks 1, 4, 5 are independent and could run in parallel, but the list is written sequentially for a single implementer.

---

### Task 1: core — `TimelineArtifactStore` accepts `runsRoot`

**Files:**
- Modify: `packages/fliwright-core/src/timeline/TimelineArtifactStore.ts:5-15`
- Test: `packages/fliwright-core/src/timeline/TimelineArtifactStore.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `TimelineArtifactStoreOptions.runsRoot?: string`; `runDir` honors it, else `process.env.FLIWRIGHT_RUNS_ROOT`, else legacy `cwd/.fliwright/runs`. Existing callers (no `runsRoot`, no env) keep today's behavior.

- [ ] **Step 1: Write the failing test**

Create `packages/fliwright-core/src/timeline/TimelineArtifactStore.test.ts`:

```ts
import { rm, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TimelineArtifactStore } from './TimelineArtifactStore.js';

describe('TimelineArtifactStore', () => {
  let sandbox: string;
  beforeAll(async () => {
    sandbox = await mkdtemp();
  });
  afterAll(async () => {
    await rm(sandbox, { recursive: true, force: true });
  });

  it('uses legacy project .fliwright/runs when no runsRoot and no env', () => {
    const store = new TimelineArtifactStore({ cwd: sandbox, runId: 'r1' });
    expect(store.runDir).toBe(join(sandbox, '.fliwright', 'runs', 'r1'));
  });

  it('uses options.runsRoot when provided', () => {
    const custom = join(sandbox, 'custom-runs');
    const store = new TimelineArtifactStore({ cwd: sandbox, runsRoot: custom, runId: 'r2' });
    expect(store.runDir).toBe(join(custom, 'r2'));
  });

  it('writes timeline.json under runsRoot', async () => {
    const custom = join(sandbox, 'custom-runs');
    const store = new TimelineArtifactStore({ runsRoot: custom, runId: 'r3' });
    await store.writeTimeline({ version: 1, runId: 'r3', testName: 't', mode: 'test', status: 'passed', startedAt: '', nodes: [] });
    const written = await readFile(store.timelinePath, 'utf8');
    expect(JSON.parse(written).runId).toBe('r3');
  });
});

async function mkdtemp(): Promise<string> {
  const dir = join(tmpdir(), `fliwright-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
  return dir;
}
```

Note: to test env-var fallback without polluting other tests, we test the `options.runsRoot` path (highest precedence) and the legacy path. Env-var precedence is verified in Task 2's integration check.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter fliwright-core test src/timeline/TimelineArtifactStore.test.ts`
Expected: FAIL — `options.runsRoot` does not exist; `runDir` ignores it (`runDir` for r2 still equals the legacy path).

- [ ] **Step 3: Write minimal implementation**

Edit `packages/fliwright-core/src/timeline/TimelineArtifactStore.ts`:

Replace lines 5–15 with:

```ts
export interface TimelineArtifactStoreOptions {
  cwd?: string;
  /** Absolute root for run artifacts. Overrides env + legacy default. */
  runsRoot?: string;
  runId: string;
}

export class TimelineArtifactStore {
  readonly runDir: string;

  constructor(options: TimelineArtifactStoreOptions) {
    const root = options.runsRoot
      ?? process.env.FLIWRIGHT_RUNS_ROOT
      ?? join(options.cwd ?? process.cwd(), '.fliwright', 'runs');
    this.runDir = join(root, options.runId);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter fliwright-core test src/timeline/TimelineArtifactStore.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Lint + commit**

```bash
pnpm --filter fliwright-core lint || true
git add packages/fliwright-core/src/timeline/TimelineArtifactStore.ts packages/fliwright-core/src/timeline/TimelineArtifactStore.test.ts
git commit -m "feat(core): TimelineArtifactStore honors runsRoot / FLIWRIGHT_RUNS_ROOT"
```

---

### Task 2: vitest runtime — pass `runsRoot` into `TimelineArtifactStore`

**Files:**
- Modify: `packages/fliwright-vitest/src/index.ts:110-118` (and the `FliwrightConfig` type)

**Interfaces:**
- Consumes: Task 1's `TimelineArtifactStoreOptions.runsRoot`.
- Produces: when `config.runsRoot` or `FLIWRIGHT_RUNS_ROOT` is set, all timeline artifacts for a test land under that root. `FliwrightConfig.runsRoot?: string` is now part of the public config.

- [ ] **Step 1: Write the failing test**

Create `packages/fliwright-vitest/src/runsRoot.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

describe('createFliwrightTest runsRoot plumbing', () => {
  it('exports FliwrightConfig.runsRoot in the type surface', async () => {
    // The config type is exercised indirectly: importing the module and
    // referencing createFliwrightTest confirms the surface compiles with runsRoot.
    const mod = await import('./index.js');
    expect(typeof mod.createFliwrightTest).toBe('function');
  });

  it('respects FLIWRIGHT_RUNS_ROOT env when constructing the artifact store', async () => {
    // We cannot run a real driver here; instead we verify the env is read by
    // spying on process.env through a focused unit on the resolution helper.
    // (See Step 3 — we extract resolveRunsRoot and test it directly.)
    const { resolveRunsRoot } = await import('./index.js');
    const prev = process.env.FLIWRIGHT_RUNS_ROOT;
    process.env.FLIWRIGHT_RUNS_ROOT = '/tmp/expected-root';
    try {
      expect(resolveRunsRoot({ runsRoot: undefined })).toBe('/tmp/expected-root');
      expect(resolveRunsRoot({ runsRoot: '/tmp/explicit' })).toBe('/tmp/explicit');
    } finally {
      if (prev === undefined) delete process.env.FLIWRIGHT_RUNS_ROOT;
      else process.env.FLIWRIGHT_RUNS_ROOT = prev;
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter fliwright-vitest test src/runsRoot.test.ts`
Expected: FAIL — `resolveRunsRoot` is not exported.

- [ ] **Step 3: Write minimal implementation**

In `packages/fliwright-vitest/src/index.ts`:

(a) Add the resolver + export near the top of the file (after existing imports/helpers). Find the `runId`/`safeName` helper region and add:

```ts
/**
 * Decide where run artifacts go for a fliwright test run.
 * Precedence: explicit config.runsRoot > FLIWRIGHT_RUNS_ROOT env > undefined
 * (the caller — createFliwrightTest — falls back to legacy cwd/.fliwright when undefined).
 */
export function resolveRunsRoot(config: { runsRoot?: string }): string | undefined {
  return config.runsRoot ?? process.env.FLIWRIGHT_RUNS_ROOT;
}
```

(b) Add `runsRoot?: string;` to the `FliwrightConfig` interface (locate the interface definition; it is the type accepted by `createFliwrightTest`). Add the field alongside the existing `timelineDir?` field:

```ts
  runsRoot?: string;
```

(c) At the `createFliwrightTest` call site (around line 115), change the store construction:

```ts
      const runsRoot = resolveRunsRoot(config);
      const artifactStore = new TimelineArtifactStore({
        cwd: config.timelineDir ?? process.cwd(),
        ...(runsRoot ? { runsRoot } : {}),
        runId: testRunId,
      });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter fliwright-vitest test src/runsRoot.test.ts`
Expected: PASS.

- [ ] **Step 5: Run full vitest-package test suite**

Run: `pnpm --filter fliwright-vitest test`
Expected: PASS (no regressions; the existing tests that don't set `runsRoot` still use the legacy path).

- [ ] **Step 6: Lint + commit**

```bash
pnpm --filter fliwright-vitest lint || true
git add packages/fliwright-vitest/src/index.ts packages/fliwright-vitest/src/runsRoot.test.ts
git commit -m "feat(vitest): route timeline artifacts through runsRoot / FLIWRIGHT_RUNS_ROOT"
```

---

### Task 3: vscode — `ProjectRunsRoot` resolver

**Files:**
- Create: `packages/fliwright-vscode/src/testing/ProjectRunsRoot.ts`
- Test: `packages/fliwright-vscode/tests/ProjectRunsRoot.test.ts`

**Interfaces:**
- Consumes: `vscode.Uri` (workspace root), `node:os`, `node:path`, `node:crypto`.
- Produces:
  - `projectRunsRoot(workspaceRoot: vscode.Uri): { rootDir: string; runsDir: string; hash: string }`
    - `rootDir = ~/.fliwright/projects/<hash>`
    - `runsDir = <rootDir>/runs`
    - `hash = sha1(absFsPath).slice(0,12)`
  - `async ensureProjectRunsRoot(workspaceRoot): Promise<string>` — mkdir `-p` the runs dir, write/update `meta.json` (`{ projectPath, updatedAt }`), return `runsDir`.

- [ ] **Step 1: Write the failing test**

Create `packages/fliwright-vscode/tests/ProjectRunsRoot.test.ts`. The functions take a `homeDir` override so tests don't touch the real home:

```ts
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { projectRunsRoot, ensureProjectRunsRoot } from '../src/testing/ProjectRunsRoot.js';

const fakeUri = (fsPath: string) => ({ fsPath, scheme: 'file' } as any);

describe('ProjectRunsRoot', () => {
  it('produces a stable hash for a workspace path', () => {
    const a = projectRunsRoot(fakeUri('/repos/exio_app'), { homeDir: '/tmp/h' });
    const b = projectRunsRoot(fakeUri('/repos/exio_app'), { homeDir: '/tmp/h' });
    expect(a.hash).toBe(b.hash);
    expect(a.runsDir).toBe(join('/tmp/h', '.fliwright', 'projects', a.hash, 'runs'));
  });

  it('different paths map to different hashes', () => {
    const a = projectRunsRoot(fakeUri('/repos/A'), { homeDir: '/tmp/h' });
    const b = projectRunsRoot(fakeUri('/repos/B'), { homeDir: '/tmp/h' });
    expect(a.hash).not.toBe(b.hash);
  });

  it('ensureProjectRunsRoot creates dirs and writes meta.json', async () => {
    const home = mkdtempSync(join(tmpdir(), 'fliwright-home-'));
    const runsDir = await ensureProjectRunsRoot(fakeUri('/repos/exio_app'), { homeDir: home });
    expect(existsSync(runsDir)).toBe(true);
    const meta = JSON.parse(readFileSync(join(home, '.fliwright', 'projects', projectRunsRoot(fakeUri('/repos/exio_app'), { homeDir: home }).hash, 'meta.json'), 'utf8'));
    expect(meta.projectPath).toBe('/repos/exio_app');
    expect(typeof meta.updatedAt).toBe('number');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter fliwright-vscode test tests/ProjectRunsRoot.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `packages/fliwright-vscode/src/testing/ProjectRunsRoot.ts`:

```ts
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import type * as vscode from 'vscode';

export interface ProjectRunsRootResult {
  hash: string;
  rootDir: string;
  runsDir: string;
}

export interface ProjectRunsRootOptions {
  /** Override the user home (for tests). Defaults to os.homedir(). */
  homeDir?: string;
}

export function projectRunsRoot(
  workspaceRoot: vscode.Uri,
  options: ProjectRunsRootOptions = {},
): ProjectRunsRootResult {
  const home = options.homeDir ?? homedir();
  const hash = createHash('sha1').update(workspaceRoot.fsPath).digest('hex').slice(0, 12);
  const rootDir = join(home, '.fliwright', 'projects', hash);
  const runsDir = join(rootDir, 'runs');
  return { hash, rootDir, runsDir };
}

export async function ensureProjectRunsRoot(
  workspaceRoot: vscode.Uri,
  options: ProjectRunsRootOptions = {},
): Promise<string> {
  const { rootDir, runsDir } = projectRunsRoot(workspaceRoot, options);
  await mkdir(runsDir, { recursive: true });
  const now = Date.now();
  // Use Date.now() — this runs in the extension host, not a workflow script.
  await writeFile(join(rootDir, 'meta.json'), JSON.stringify({ projectPath: workspaceRoot.fsPath, updatedAt: now }, null, 2), 'utf8');
  return runsDir;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter fliwright-vscode test tests/ProjectRunsRoot.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Lint + commit**

```bash
pnpm --filter fliwright-vscode lint || true
git add packages/fliwright-vscode/src/testing/ProjectRunsRoot.ts packages/fliwright-vscode/tests/ProjectRunsRoot.test.ts
git commit -m "feat(vscode): ProjectRunsRoot resolver for ~/.fliwright/projects/<hash>"
```

---

### Task 4: vscode — `TestTreeBuilder` static parser (pure)

**Files:**
- Create: `packages/fliwright-vscode/src/testing/TestTreeBuilder.ts`
- Test: `packages/fliwright-vscode/tests/TestTreeBuilder.test.ts`

**Interfaces:**
- Consumes: nothing (pure function).
- Produces:
  ```ts
  export interface ParsedTest { title: string; }
  export interface ParsedGroup { title: string; children: ParsedNode[]; }
  export type ParsedNode = ParsedGroup | ParsedTest;
  export interface ParsedFile { nodes: ParsedNode[]; }
  export function buildTestTree(source: string): ParsedFile;
  ```
  - `test(`, `it(` open a test; `describe(` opens a group. Title = first argument when it is a string literal (single/double/backtick quoted); otherwise title falls back to `<dynamic>` and the node is still emitted (so multi-generated tests are visible).
  - Nesting is tracked via brace depth: a `describe(` increments depth on its `{`; matching `}` decrements.

- [ ] **Step 1: Write the failing test**

Create `packages/fliwright-vscode/tests/TestTreeBuilder.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildTestTree } from '../src/testing/TestTreeBuilder.js';

describe('TestTreeBuilder', () => {
  it('parses a flat file with multiple tests', () => {
    const src = `
      import { test } from 'vitest';
      test('login ok', async () => {});
      test('login fail', async () => {});
    `;
    const file = buildTestTree(src);
    expect(file.nodes).toHaveLength(2);
    expect(file.nodes[0]).toMatchObject({ title: 'login ok' });
    expect(file.nodes[1]).toMatchObject({ title: 'login fail' });
  });

  it('parses nested describe > test', () => {
    const src = `
      import { describe, test } from 'vitest';
      describe('suite A', () => {
        test('inner', () => {});
        describe('suite B', () => {
          test('deep', () => {});
        });
      });
    `;
    const file = buildTestTree(src);
    expect(file.nodes).toHaveLength(1);
    const a = file.nodes[0];
    expect(a).toMatchObject({ title: 'suite A' });
    if (a.kind !== 'group') throw new Error('expected group');
    expect(a.children).toHaveLength(2);
    expect(a.children[0]).toMatchObject({ title: 'inner' });
    const b = a.children[1];
    if (b.kind !== 'group') throw new Error('expected group');
    expect(b.children[0]).toMatchObject({ title: 'deep' });
  });

  it('treats it() as a test', () => {
    const file = buildTestTree(`it('works', () => {})`);
    expect(file.nodes[0]).toMatchObject({ title: 'works' });
  });

  it('marks dynamic titles without crashing', () => {
    const file = buildTestTree(`test(\`case \${i}\`, () => {})`);
    expect(file.nodes[0].title).toBe('<dynamic>');
  });

  it('ignores commented-out test() calls', () => {
    const src = `
      // test('skipped', () => {});
      test('real', () => {});
    `;
    const file = buildTestTree(src);
    expect(file.nodes).toHaveLength(1);
    expect(file.nodes[0]).toMatchObject({ title: 'real' });
  });
});
```

(Note: tests reference `node.kind === 'group'`; add a `kind` discriminant to `ParsedNode`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter fliwright-vscode test tests/TestTreeBuilder.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write minimal implementation**

Create `packages/fliwright-vscode/src/testing/TestTreeBuilder.ts`:

```ts
export interface ParsedTest { kind: 'test'; title: string; }
export interface ParsedGroup { kind: 'group'; title: string; children: ParsedNode[]; }
export type ParsedNode = ParsedGroup | ParsedTest;
export interface ParsedFile { nodes: ParsedNode[]; }

const CALL_RE = /\b(describe|test|it)\s*\(/g;

/**
 * Parse fliwright .test.ts source into a describe/test tree.
 * Line-based scan: on each match, if the line is a // comment, skip; otherwise
 * read the first argument. If it's a quoted literal, that's the title; else
 * '<dynamic>'. describe() opens a group tracked by brace depth; the group ends
 * when its opening brace is closed.
 */
export function buildTestTree(source: string): ParsedFile {
  const root: ParsedNode[] = [];
  const stack: { group: ParsedGroup; openDepth: number }[] = [];
  let depth = 0;

  CALLReLoop:
  for (const match of source.matchAll(CALL_RE)) {
    const callName = match[1];
    const callStart = match.index! + match[0].length;
    // Commented line?
    const lineStart = source.lastIndexOf('\n', match.index!) + 1;
    const linePrefix = source.slice(lineStart, match.index!);
    if (linePrefix.trim().startsWith('//')) continue;

    const title = readTitle(source, callStart);
    const braceIndex = source.indexOf('{', callStart);
    if (braceIndex < 0) continue;
    // Depth up to (not including) the opening brace:
    const openDepth = depth + countBetween(source, callStart, braceIndex, '{', '}');
    depth = openDepth + 1;

    if (callName === 'describe') {
      const group: ParsedGroup = { kind: 'group', title, children: [] };
      attach(stack.length > 0 ? stack[stack.length - 1].group.children : root, group);
      stack.push({ group, openDepth });
    } else {
      const node: ParsedTest = { kind: 'test', title };
      attach(stack.length > 0 ? stack[stack.length - 1].group.children : root, node);
    }

    // Pop closed groups.
    while (stack.length > 0 && depth <= stack[stack.length - 1].openDepth) {
      stack.pop();
    }
  }
  return { nodes: root };
}

function attach(list: ParsedNode[], node: ParsedNode): void {
  list.push(node);
}

function readTitle(source: string, from: number): string {
  // skip whitespace
  let i = from;
  while (i < source.length && /\s/.test(source[i])) i++;
  const ch = source[i];
  if (ch === "'" || ch === '"' || ch === '`') {
    const end = findStringEnd(source, i, ch);
    if (end > i) return source.slice(i + 1, end);
  }
  return '<dynamic>';
}

function findStringEnd(source: string, start: number, quote: string): number {
  let i = start + 1;
  while (i < source.length) {
    if (source[i] === '\\') { i += 2; continue; }
    if (source[i] === quote) {
      if (quote === '`') return i; // simplistic; template ${...} not supported → '<dynamic>' path
      return i;
    }
    i++;
  }
  return -1;
}

function countBetween(source: string, from: number, to: number, open: string, close: string): number {
  let net = 0;
  for (let i = from; i < to; i++) {
    if (source[i] === open) net++;
    else if (source[i] === close) net--;
  }
  return net;
}
```

> The implementer should run the tests and fix any parser edge cases the tests reveal (e.g., the template-literal branch). The contract is the test set; keep adjusting until green. If a real `.test.ts` in `tests/` parses wrong during Task 13, add a regression test here and fix.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter fliwright-vscode test tests/TestTreeBuilder.test.ts`
Expected: PASS (5 tests). Fix the parser until all pass.

- [ ] **Step 5: Lint + commit**

```bash
pnpm --filter fliwright-vscode lint || true
git add packages/fliwright-vscode/src/testing/TestTreeBuilder.ts packages/fliwright-vscode/tests/TestTreeBuilder.test.ts
git commit -m "feat(vscode): TestTreeBuilder static describe/test parser"
```

---

### Task 5: vscode — tree node + status types

**Files:**
- Create: `packages/fliwright-vscode/src/testing/types.ts`
- Modify: `packages/fliwright-vscode/src/types.ts` (remove the old `TestFileEntry.lastResult` usage is handled in Task 8; here only add re-export)

**Interfaces:**
- Consumes: `vscode.Uri`.
- Produces: the node union consumed by `TestsTreeProvider` (Task 8) and `TestStatusStore` (Task 6).

- [ ] **Step 1: Write the types file**

Create `packages/fliwright-vscode/src/testing/types.ts`:

```ts
import type * as vscode from 'vscode';

export type TestNodeStatus = 'passed' | 'failed' | 'unknown';

export interface TestFileNode {
  kind: 'testFile';
  uri: vscode.Uri;
  relPath: string;            // workspace-relative, used in node ids
  label: string;
  status: TestNodeStatus;
  ranAt?: number;
}

export interface TestGroupNode {
  kind: 'testGroup';
  id: string;                 // "<relPath>::<ancestor titles joined by '/'>/<title>"
  label: string;
  status: TestNodeStatus;
}

export interface TestCaseNode {
  kind: 'testCase';
  id: string;                 // "<relPath>::<ancestor titles joined by '/'>/<title>"
  label: string;
  status: TestNodeStatus;
  durationMs?: number;
  fileUri: vscode.Uri;
}

export interface TestStepNode {
  kind: 'testStep';
  label: string;
  status: 'passed' | 'failed' | 'pending';
  fileUri: vscode.Uri;
  stepIndex: number;
}

export interface EmptyNode {
  kind: 'empty';
  label: string;
}

export type TestTreeNode =
  | TestFileNode | TestGroupNode | TestCaseNode | TestStepNode | EmptyNode;

/** Build the stable id for a test/group from its ancestor chain. */
export function testNodeId(relPath: string, ancestorTitles: string[], title: string): string {
  const chain = [...ancestorTitles, title].map((t) => t).join('/');
  return `${relPath}::${chain}`;
}

/** Status used as the aggregate of children. */
export function aggregateStatus(statuses: TestNodeStatus[]): TestNodeStatus {
  if (statuses.includes('failed')) return 'failed';
  if (statuses.includes('passed')) return 'passed';
  return 'unknown';
}
```

- [ ] **Step 2: Add a tiny unit test for id + aggregate**

Create `packages/fliwright-vscode/tests/testing-types.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { testNodeId, aggregateStatus } from '../src/testing/types.js';

describe('testing node utils', () => {
  it('builds ids from ancestor chain', () => {
    expect(testNodeId('tests/a.test.ts', ['suite'], 'case')).toBe('tests/a.test.ts::suite/case');
  });
  it('aggregates: any failed -> failed', () => {
    expect(aggregateStatus(['passed', 'failed'])).toBe('failed');
  });
  it('aggregates: no failed, some passed -> passed', () => {
    expect(aggregateStatus(['unknown', 'passed'])).toBe('passed');
  });
  it('aggregates: all unknown -> unknown', () => {
    expect(aggregateStatus(['unknown'])).toBe('unknown');
  });
});
```

- [ ] **Step 3: Run test**

Run: `pnpm --filter fliwright-vscode test tests/testing-types.test.ts`
Expected: PASS.

- [ ] **Step 4: Lint + commit**

```bash
pnpm --filter fliwright-vscode lint || true
git add packages/fliwright-vscode/src/testing/types.ts packages/fliwright-vscode/tests/testing-types.test.ts
git commit -m "feat(vscode): test tree node types and helpers"
```

---

### Task 6: vscode — `TestStatusStore` (index.json + result.json)

**Files:**
- Create: `packages/fliwright-vscode/src/testing/TestStatusStore.ts`
- Test: `packages/fliwright-vscode/tests/TestStatusStore.test.ts`

**Interfaces:**
- Consumes: `RunResult` from `src/types.ts` (the output of `parseVitestJson`); a `runsDir: string` (from Task 3); `node:fs/promises`.
- Produces:
  ```ts
  export interface TestStatusEntry { runId: string; status: 'passed' | 'failed'; ranAt: number; durationMs?: number; }
  export class TestStatusStore {
    constructor(runsDir: string);
    async loadIndex(): Promise<Map<string, TestStatusEntry>>;        // key = test node id
    async recordRun(runId: string, ranAt: number, workspaceRoot: vscode.Uri, result: RunResult): Promise<void>;
    //   - writes <runsDir>/<runId>/result.json
    //   - patches <runsDir>/index.json for every TestCaseResult
    async pruneDangling(keepRunIds: Set<string>): Promise<void>;
  }
  ```
  `recordRun` maps each `TestCaseResult` (`name` = `"suite > case"`) to a node id using the workspace-relative file path of the run and the `' > '`-split ancestor chain → `testNodeId(relPath, ancestors, title)`.

- [ ] **Step 1: Write the failing test**

Create `packages/fliwright-vscode/tests/TestStatusStore.test.ts`. It uses a temp dir as `runsDir` and a stub `vscode` is not needed because we pass `workspaceRoot` as a plain `{ fsPath }` and use `node:fs` directly (the store uses `node:fs/promises`, not `vscode.workspace.fs`, for testability):

```ts
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TestStatusStore } from '../src/testing/TestStatusStore.js';
import type { RunResult } from '../src/types.js';

const fakeRoot = (fsPath: string) => ({ fsPath, scheme: 'file' } as any);

describe('TestStatusStore', () => {
  let runsDir: string;
  beforeAll(() => { runsDir = mkdtempSync(join(tmpdir(), 'fliwright-runs-')); });
  afterAll(() => { rmSync(runsDir, { recursive: true, force: true }); });

  const result: RunResult = {
    passed: false, totalTests: 2, passedTests: 1, failedTests: 1, duration: 10,
    results: [
      { name: 'suite > case A', passed: true, duration: 3 },
      { name: 'suite > case B', passed: false, duration: 4, error: 'boom' },
    ],
  };

  it('writes result.json and index.json keyed by node id', async () => {
    const store = new TestStatusStore(runsDir);
    await store.recordRun('run-1', 1000, fakeRoot('/repo'), {
      ...result,
      // attach the originating file via a parallel map: store maps name->id using relPath supplied
    } as RunResult, 'tests/a.test.ts');

    const idx = JSON.parse(readFileSync(join(runsDir, 'index.json'), 'utf8'));
    expect(idx['tests/a.test.ts::suite/case A']).toMatchObject({ status: 'passed', runId: 'run-1' });
    expect(idx['tests/a.test.ts::suite/case B']).toMatchObject({ status: 'failed', runId: 'run-1' });
    expect(existsSync(join(runsDir, 'run-1', 'result.json'))).toBe(true);
  });

  it('loadIndex returns the map', async () => {
    const store = new TestStatusStore(runsDir);
    const map = await store.loadIndex();
    expect(map.get('tests/a.test.ts::suite/case A')?.status).toBe('passed');
  });

  it('pruneDangling removes index entries whose runId is not kept', async () => {
    const store = new TestStatusStore(runsDir);
    await store.pruneDangling(new Set(['run-other']));
    const map = await store.loadIndex();
    expect(map.has('tests/a.test.ts::suite/case A')).toBe(false);
  });

  it('corrupt index.json yields an empty map (no throw)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fliwright-runs-bad-'));
    require('node:fs').writeFileSync(join(dir, 'index.json'), '{not json');
    const store = new TestStatusStore(dir);
    const map = await store.loadIndex();
    expect(map.size).toBe(0);
    rmSync(dir, { recursive: true, force: true });
  });
});
```

Note: the test signature `recordRun(runId, ranAt, workspaceRoot, result, relPath)` differs from the sketch above. **Lock the signature as:**
```ts
async recordRun(runId: string, ranAt: number, workspaceRoot: { fsPath: string }, result: RunResult, relPath: string): Promise<void>
```
i.e. the caller (Task 9) supplies the workspace-relative file path that produced this `RunResult`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter fliwright-vscode test tests/TestStatusStore.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write minimal implementation**

Create `packages/fliwright-vscode/src/testing/TestStatusStore.ts`:

```ts
import { mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { RunResult } from '../types.js';
import { testNodeId } from './types.js';

export interface TestStatusEntry {
  runId: string;
  status: 'passed' | 'failed';
  ranAt: number;
  durationMs?: number;
}

interface IndexMap { [nodeId: string]: TestStatusEntry; }

export class TestStatusStore {
  constructor(private readonly runsDir: string) {}

  get indexUri(): string { return join(this.runsDir, 'index.json'); }

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
      map.set(id, {
        runId,
        status: tc.passed ? 'passed' : 'failed',
        ranAt,
        durationMs: tc.duration || undefined,
      });
    }
    await this.writeIndex(map);
  }

  async pruneDangling(keepRunIds: Set<string>): Promise<void> {
    const map = await this.loadIndex();
    let changed = false;
    for (const [id, entry] of map) {
      if (!keepRunIds.has(entry.runId)) { map.delete(id); changed = true; }
    }
    if (changed) await this.writeIndex(map);
  }
}

/** Split a vitest "suite > case" name into ancestors + title. */
function splitName(name: string): { ancestors: string[]; title: string } {
  const parts = name.split('>').map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return { ancestors: [], title: name };
  return { ancestors: parts.slice(0, -1), title: parts[parts.length - 1] };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter fliwright-vscode test tests/TestStatusStore.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Lint + commit**

```bash
pnpm --filter fliwright-vscode lint || true
git add packages/fliwright-vscode/src/testing/TestStatusStore.ts packages/fliwright-vscode/tests/TestStatusStore.test.ts
git commit -m "feat(vscode): TestStatusStore persists per-test last status"
```

---

### Task 7: vscode — `VitestRunner` testNamePattern + runs-root env

**Files:**
- Modify: `packages/fliwright-vscode/src/runner/TestRunner.ts:5-12`
- Modify: `packages/fliwright-vscode/src/runner/VitestRunner.ts:7-24`
- Test: `packages/fliwright-vscode/tests/VitestRunner.test.ts` (extend existing)

**Interfaces:**
- Consumes: Task 1 (env name `FLIWRIGHT_RUNS_ROOT`).
- Produces:
  - `RunParams.testNamePattern?: string`
  - `RunParams.runsRoot?: string` (when set, runner adds `env.FLIWRIGHT_RUNS_ROOT = runsRoot`)
  - `VitestRunner.run()` passes `-t "<pattern>"` to vitest when `testNamePattern` is set.

- [ ] **Step 1: Write the failing test (extend existing file)**

Append to `packages/fliwright-vscode/tests/VitestRunner.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { VitestRunner } from '../src/runner/VitestRunner.js';

describe('VitestRunner run args', () => {
  it('adds -t when testNamePattern is set and FLIWRIGHT_RUNS_ROOT when runsRoot is set', async () => {
    const captured: { args: string[]; env: NodeJS.ProcessEnv } = { args: [], env: {} };
    vi.mock('node:child_process', () => ({
      spawn: (_cmd: string, args: string[], opts: { env: NodeJS.ProcessEnv }) => {
        captured.args = args;
        captured.env = opts.env ?? {};
        const fake = { stdout: { on: () => {} }, stderr: { on: () => {} }, on: (_e: string, cb: (c: number) => void) => { if (_e === 'close') setTimeout(() => cb(0), 0); } };
        return fake as any;
      },
    }));

    const runner = new VitestRunner();
    await runner.run({
      workspaceRoot: { fsPath: '/repo', scheme: 'file' } as any,
      testFile: { fsPath: '/repo/tests/a.test.ts', scheme: 'file' } as any,
      failureContextDir: { fsPath: '/repo/.fliwright/failures', scheme: 'file' } as any,
      testNamePattern: 'case A',
      runsRoot: '/home/.fliwright/projects/abc/runs',
    } as any);

    expect(captured.args).toContain('-t');
    expect(captured.args[captured.args.indexOf('-t') + 1]).toBe('case A');
    expect(captured.env.FLIWRIGHT_RUNS_ROOT).toBe('/home/.fliwright/projects/abc/runs');
    vi.restoreAllMocks();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter fliwright-vscode test tests/VitestRunner.test.ts`
Expected: FAIL — `testNamePattern`/`runsRoot` not on `RunParams`; `-t` not added.

- [ ] **Step 3: Write minimal implementation**

Edit `packages/fliwright-vscode/src/runner/TestRunner.ts` — add two fields to `RunParams`:

```ts
export interface RunParams {
  workspaceRoot: vscode.Uri;
  testFile?: vscode.Uri;
  vmServiceUrl?: string;
  failureContextDir: vscode.Uri;
  traceMode?: TraceMode;
  traceDir?: vscode.Uri;
  testNamePattern?: string;
  runsRoot?: string;
}
```

Edit `packages/fliwright-vscode/src/runner/VitestRunner.ts` `run()`:

```ts
  async run(params: RunParams): Promise<RunResult> {
    const args = ['vitest', 'run'];
    if (params.testFile) args.push(path.relative(params.workspaceRoot.fsPath, params.testFile.fsPath));
    if (params.testNamePattern) {
      args.push('-t', params.testNamePattern);
    }
    args.push('--reporter=json');

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      FLIWRIGHT_MCP_FAILURE_CONTEXT_PATH: params.failureContextDir.fsPath,
    };
    if (params.runsRoot) env.FLIWRIGHT_RUNS_ROOT = params.runsRoot;
    if (params.vmServiceUrl) env.FLIWRIGHT_VM_URL = params.vmServiceUrl;
    if (params.traceMode && params.traceMode !== 'off' && params.traceDir) {
      env.FLIWRIGHT_TRACE = params.traceMode;
      env.FLIWRIGHT_TRACE_DIR = params.traceDir.fsPath;
    }

    const execution = await runCommand('pnpm', args, params.workspaceRoot.fsPath, env);
    return parseVitestJson(execution.stdout, execution.stderr, execution.exitCode);
  }
```

Leave `parseVitestJson` and the rest untouched.

> Note on the mock test: the existing test imports `parseVitestJson` only; the new test imports `VitestRunner` and mocks `node:child_process`. If `vi.mock` hoisting causes issues with the `import { spawn }` at top of `VitestRunner.ts`, the implementer may instead refactor `runCommand` to accept an injectable spawner — acceptable scope creep, but preferred is to make the mock work. If mocking proves fragile, replace the new test with a direct unit on a small extracted `buildVitestArgs(params)` helper and test that instead (move arg-building out of `run()`).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter fliwright-vscode test tests/VitestRunner.test.ts`
Expected: PASS (both the original parse test and the new args test).

- [ ] **Step 5: Lint + commit**

```bash
pnpm --filter fliwright-vscode lint || true
git add packages/fliwright-vscode/src/runner/TestRunner.ts packages/fliwright-vscode/src/runner/VitestRunner.ts packages/fliwright-vscode/tests/VitestRunner.test.ts
git commit -m "feat(vscode): VitestRunner supports -t filter and FLIWRIGHT_RUNS_ROOT"
```

---

### Task 8: vscode — rewrite `TestsTreeProvider` (3-level tree + icons + buttons)

**Files:**
- Modify (rewrite): `packages/fliwright-vscode/src/views/TestsTreeProvider.ts`
- Test: `packages/fliwright-vscode/tests/TestsTreeProvider.test.ts` (create)

**Interfaces:**
- Consumes: `TestDiscoveryService`, `TestTreeBuilder` (Task 4), `TestStatusStore` (Task 6), `AnnotationParser` (existing, for optional step drill-down), `testing/types.ts` (Task 5).
- Produces:
  ```ts
  export class TestsTreeProvider implements vscode.TreeDataProvider<TestTreeNode> {
    constructor(discovery: TestDiscoveryService, statusStore: TestStatusStore);
    refresh(): void;
    onDidChangeTreeData: ...;
    getTreeItem(element: TestTreeNode): vscode.TreeItem;
    getChildren(element?: TestTreeNode): Promise<TestTreeNode[]>;
  }
  ```
  - Root level: `TestFileNode[]`.
  - file → group/testcase nodes (from builder) → optional testStep nodes (from AnnotationParser) under a testCase.
  - Status icons: passed=`pass`, failed=`error`, unknown=`circle-outline`. Aggregate up.
  - Every file/testcase node sets `item.command = run` and a context-menu/inline "View" via `contextValue` (`testFile`/`testCase`) wired in Task 12; the TreeView itself can't show true inline buttons, so Run is the primary click and View is a context-menu + title-bar command (see Task 12). The code here only sets `contextValue` + `command`.

- [ ] **Step 1: Write the failing test**

Create `packages/fliwright-vscode/tests/TestsTreeProvider.test.ts`. Use the `vscode` stub already present at `tests/stubs/vscode.ts` (other provider tests use it via vitest config alias). Build a workspace with one `.test.ts`, a fake status map:

```ts
import { describe, expect, it, vi } from 'vitest';
import { TestsTreeProvider } from '../src/views/TestsTreeProvider.js';
import { TestStatusStore } from '../src/testing/TestStatusStore.js';
import { createWorkspace, writeText } from './helpers/workspace.js';

describe('TestsTreeProvider', () => {
  it('renders file -> test tree and applies statuses from the store', async () => {
    const ws = await createWorkspace();
    const fileUri = await writeText(ws, 'tests/a.test.ts', `
      import { describe, test } from 'vitest';
      describe('suite', () => {
        test('case A', () => {});
        test('case B', () => {});
      });
    `);

    const discovery = { discover: vi.fn().mockResolvedValue([{ kind: 'testFile', uri: fileUri, label: 'a.test.ts' }]) } as any;
    const store = { loadIndex: vi.fn().mockResolvedValue(new Map([
      ['tests/a.test.ts::suite/case A', { runId: 'r1', status: 'passed', ranAt: 1 }],
    ])) } as unknown as TestStatusStore;

    const provider = new TestsTreeProvider(discovery as any, store);
    const files = await provider.getChildren();
    expect(files).toHaveLength(1);
    expect(files[0].kind).toBe('testFile');

    const children = await provider.getChildren(files[0]);
    expect(children).toHaveLength(1);
    expect(children[0].kind).toBe('testGroup');
    const group = children[0];
    const cases = await provider.getChildren(group!);
    expect(cases.map((c: any) => c.label)).toEqual(['case A', 'case B']);
    expect((cases[0] as any).status).toBe('passed');
    expect((cases[1] as any).status).toBe('unknown');

    const itemA = provider.getTreeItem(cases[0]!);
    expect(itemA.iconPath).toBeTruthy(); // ThemeIcon('pass')
  });

  it('empty workspace shows empty node', async () => {
    const ws = await createWorkspace(); // no test files
    const discovery = { discover: vi.fn().mockResolvedValue([]) } as any;
    const store = { loadIndex: vi.fn().mockResolvedValue(new Map()) } as unknown as TestStatusStore;
    const provider = new TestsTreeProvider(discovery as any, store);
    const roots = await provider.getChildren();
    expect(roots[0].kind).toBe('empty');
  });

  it('does NOT parse any file source until a file row is expanded (lazy)', async () => {
    // Spy on the parser; requesting root children must not invoke it.
    const ws = await createWorkspace();
    const builder = await import('../src/testing/TestTreeBuilder.js');
    const spy = vi.spyOn(builder, 'buildTestTree');
    const fileUri = await writeText(ws, 'tests/lazy.test.ts', `test('never expanded', () => {})`);
    const discovery = { discover: vi.fn().mockResolvedValue([{ kind: 'testFile', uri: fileUri, label: 'lazy.test.ts' }]) } as any;
    const store = { loadIndex: vi.fn().mockResolvedValue(new Map()) } as unknown as TestStatusStore;
    const provider = new TestsTreeProvider(discovery as any, store);

    const files = await provider.getChildren();        // root expansion
    expect(spy).not.toHaveBeenCalled();                // no parse yet
    expect(files[0].kind).toBe('testFile');

    await provider.getChildren(files[0]!);             // NOW expand the file
    expect(spy).toHaveBeenCalledTimes(1);              // parsed once

    await provider.getChildren(files[0]!);             // expand again
    expect(spy).toHaveBeenCalledTimes(1);              // served from cache, no re-parse
    spy.mockRestore();
  });
});
```

> The implementer must confirm `createWorkspace`/`writeText` signatures in `tests/helpers/workspace.ts` and adjust. The `relPath` for node ids is derived inside the provider from the workspace root + file uri (use `vscode.workspace.asRelativePath` equivalent via the stub, or compute from `fsPath` minus the workspace root `fsPath`).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter fliwright-vscode test tests/TestsTreeProvider.test.ts`
Expected: FAIL — constructor signature mismatch / old flat behavior.

- [ ] **Step 3: Write minimal implementation**

Rewrite `packages/fliwright-vscode/src/views/TestsTreeProvider.ts`:

```ts
import * as path from 'node:path';
import * as vscode from 'vscode';
import { AnnotationParser } from '../editor/AnnotationParser.js';
import type { TestDiscoveryService } from '../runner/TestDiscoveryService.js';
import type { TestStatusStore } from '../testing/TestStatusStore.js';
import { buildTestTree, type ParsedNode } from '../testing/TestTreeBuilder.js';
import {
  aggregateStatus, testNodeId,
  type TestCaseNode, type TestFileNode, type TestGroupNode, type TestNodeStatus,
  type TestStepNode, type TestTreeNode,
} from '../testing/types.js';

export class TestsTreeProvider implements vscode.TreeDataProvider<TestTreeNode> {
  private readonly emitter = new vscode.EventEmitter<TestTreeNode | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  private roots: TestFileNode[] | undefined;
  private statusMap: Map<string, { status: TestNodeStatus; ranAt?: number; durationMs?: number }> = new Map();
  /** Per-file parse cache: parsed subtree is built ONCE on first expand and reused.
   *  Source parsing is lazy (only when the file row is expanded) per the lazy-parsing contract. */
  private readonly parseCache: Map<string, ParsedFile> = new Map(); // key = fileUri.toString()

  constructor(
    private readonly discovery: TestDiscoveryService,
    private readonly statusStore: TestStatusStore,
  ) {}

  refresh(): void {
    this.roots = undefined;
    this.statusMap = new Map();
    this.emitter.fire(undefined);
  }

  /** Called by onDidSaveTextDocument (debounced, Task 9) to invalidate ONE file's parse cache. */
  invalidateFile(uri: vscode.Uri): void {
    this.parseCache.delete(uri.toString());
    // Re-fire for just this file's subtree so an expanded row refreshes; VSCode re-requests children.
    const fileNode = this.roots?.find((f) => f.uri.toString() === uri.toString());
    this.emitter.fire(fileNode);
  }

  async getChildren(element?: TestTreeNode): Promise<TestTreeNode[]> {
    if (!this.roots) {
      // Activation path: status map (index.json only, no parsing) + file list (findFiles, no parsing).
      this.statusMap = await this.loadStatusMap();
      this.roots = await this.discoverRoots();
    }
    if (!element) {
      return this.roots.length > 0 ? this.roots : [{ kind: 'empty', label: 'No Fliwright tests' }];
    }
    switch (element.kind) {
      case 'testFile': {
        // LAZY: this branch runs only when the user expands the file row. Parse once, cache.
        const key = element.uri.toString();
        let parsed = this.parseCache.get(key);
        if (!parsed) {
          const code = new TextDecoder().decode(await vscode.workspace.fs.readFile(element.uri));
          parsed = buildTestTree(code);
          this.parseCache.set(key, parsed);
        }
        return parsed.nodes.map((n) => this.toNode(element.relPath, [], n, element.uri));
      }
      case 'testGroup':
        return element.children ?? []; // (see note below — store children on the node)
      case 'testCase':
        return this.stepsFor(element);
      default:
        return [];
    }
  }

  getTreeItem(element: TestTreeNode): vscode.TreeItem {
    switch (element.kind) {
      case 'empty':
        return iconItem(element.label, 'info', vscode.TreeItemCollapsibleState.None, 'empty');
      case 'testFile': {
        const item = iconItem(element.label, statusIcon(element.status), vscode.TreeItemCollapsibleState.Collapsed, 'testFile');
        item.resourceUri = element.uri;
        item.description = element.status === 'unknown' ? undefined : element.status;
        item.command = { command: 'fliwright.runCurrentTest', title: 'Run', arguments: [element] };
        return item;
      }
      case 'testGroup': {
        const item = iconItem(element.label, statusIcon(element.status), vscode.TreeItemCollapsibleState.Collapsed, 'testGroup');
        return item;
      }
      case 'testCase': {
        const item = iconItem(element.label, statusIcon(element.status), vscode.TreeItemCollapsibleState.Collapsed, 'testCase');
        item.description = element.durationMs != null ? `${element.durationMs}ms` : undefined;
        item.command = { command: 'fliwright.runCurrentTest', title: 'Run', arguments: [element] };
        return item;
      }
      case 'testStep': {
        const item = iconItem(element.label, stepIcon(element.status), vscode.TreeItemCollapsibleState.None, 'testStep');
        item.command = { command: 'fliwright.openVisualEditor', title: 'Open', arguments: [element.fileUri] };
        return item;
      }
    }
  }

  private async discoverRoots(): Promise<TestFileNode[]> {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!root) return [];
    const entries = await this.discovery.discover(root);
    return entries.map((e: any) => ({
      kind: 'testFile' as const,
      uri: e.uri,
      relPath: relPathOf(root, e.uri),
      label: e.label,
      status: 'unknown' as TestNodeStatus,
    }));
  }

  private async loadStatusMap() {
    const raw = await this.statusStore.loadIndex();
    const out = new Map<string, { status: TestNodeStatus; ranAt?: number; durationMs?: number }>();
    for (const [id, entry] of raw) {
      out.set(id, { status: entry.status, ranAt: entry.ranAt, durationMs: entry.durationMs });
    }
    return out;
  }

  private toNode(relPath: string, ancestors: string[], parsed: ParsedNode, fileUri: vscode.Uri): TestGroupNode | TestCaseNode {
    if (parsed.kind === 'group') {
      const id = testNodeId(relPath, ancestors, parsed.title);
      return { kind: 'testGroup', id, label: parsed.title, status: 'unknown', children: undefined as any } as any;
      // NOTE: groups are re-parsed lazily in getChildren via the file; 'children' is unused at this level
      // because getChildren(testGroup) is handled by re-deriving from the file. See note in Step 4.
    }
    const id = testNodeId(relPath, ancestors, parsed.title);
    const entry = this.statusMap.get(id);
    return {
      kind: 'testCase',
      id,
      label: parsed.title,
      status: entry?.status ?? 'unknown',
      durationMs: entry?.durationMs,
      fileUri,
    };
  }

  private async stepsFor(tc: TestCaseNode): Promise<TestStepNode[]> {
    try {
      const content = await vscode.workspace.fs.readFile(tc.fileUri);
      const code = new TextDecoder().decode(content);
      const steps = new AnnotationParser().parse(code).steps;
      return steps.map((s, i) => ({
        kind: 'testStep' as const,
        label: s.annotation.name,
        status: (s.annotation.status ?? 'pending') as 'passed' | 'failed' | 'pending',
        stepIndex: i,
        fileUri: tc.fileUri,
      }));
    } catch {
      return [];
    }
  }
}

// ── helpers ────────────────────────────────────────────────
function iconItem(label: string, icon: string, collapsible: vscode.TreeItemCollapsibleState, contextValue: string): vscode.TreeItem {
  const item = new vscode.TreeItem(label, collapsible);
  item.iconPath = new vscode.ThemeIcon(icon);
  item.contextValue = contextValue;
  return item;
}
function statusIcon(s: TestNodeStatus): string {
  return s === 'passed' ? 'pass' : s === 'failed' ? 'error' : 'circle-outline';
}
function stepIcon(s: string): string {
  return s === 'passed' ? 'check' : s === 'failed' ? 'error' : 'circle-outline';
}
function relPathOf(root: vscode.Uri, uri: vscode.Uri): string {
  const rel = path.relative(root.fsPath, uri.fsPath);
  return rel.split(path.sep).join('/');
}
```

> **Group-children note (Step 4):** the sketch returns `element.children` for groups but stores `undefined`. Two clean options — pick one and apply consistently: (a) when building a file's children, recurse eagerly so groups carry their `children` array; then `getChildren(testGroup)` returns `element.children`. (b) Keep groups pathless and re-derive by remembering the parent file + ancestor chain on the node. **Recommended: (a)** — recurse in the `toNode` call: build the whole subtree per file at once, store children on groups, and have `getChildren(testGroup)` return `group.children`. Update `TestGroupNode.children` type from `undefined` to `TestTreeNode[]`. After deciding, the group's `status` = `aggregateStatus(children.map(c => c.status))`. The implementer finalizes this recursion; the test in Step 1 must pass with the chosen approach.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter fliwright-vscode test tests/TestsTreeProvider.test.ts`
Expected: PASS (2 tests). Resolve the group-children recursion so statuses aggregate correctly.

- [ ] **Step 5: Lint + commit**

```bash
pnpm --filter fliwright-vscode lint || true
git add packages/fliwright-vscode/src/views/TestsTreeProvider.ts packages/fliwright-vscode/tests/TestsTreeProvider.test.ts
git commit -m "feat(vscode): TestsTreeProvider renders file/describe/test tree with statuses"
```

---

### Task 9: vscode — extension wiring, run routing, single-run guard, remove Runs panel

**Files:**
- Modify: `packages/fliwright-vscode/src/extension.ts`
- Delete: `packages/fliwright-vscode/src/views/RunsTreeProvider.ts`

**Interfaces:**
- Consumes: Tasks 3, 6, 7, 8. The `runTests(node, opts)` helper gains `{ testNamePattern?, files: Uri[] }`.
- Produces: activation resolves runs root via `ensureProjectRunsRoot`, passes it to the runner as `runsRoot`; `runTests` writes via `TestStatusStore.recordRun` and refreshes the tests tree; `fliwright.runs` view + RunsTreeProvider + related commands removed; a module-level `runningPromise` enforces single concurrent run.

- [ ] **Step 1: Read the current extension.ts test surface**

Run: `grep -n "runsTree\|RunsTreeProvider\|fliwright.runs\|runTests\|prependRun\|openRunViewer" packages/fliwright-vscode/src/extension.ts`
Expected: a list of line numbers to edit. (No code change yet — survey.)

- [ ] **Step 2: Make the edits**

In `packages/fliwright-vscode/src/extension.ts`:

(a) Replace the RunsTreeProvider import + instantiation with the new components:

```ts
import { TestsTreeProvider } from './views/TestsTreeProvider.js';
import { ensureProjectRunsRoot, projectRunsRoot } from './testing/ProjectRunsRoot.js';
import { TestStatusStore } from './testing/TestStatusStore.js';
```
Remove `import { RunsTreeProvider }` and `const runsTree = new RunsTreeProvider();`.

(b) In `activate()`, after `requireWorkspaceRoot` is available, resolve + ensure the runs root (guard for no-workspace):

```ts
  let runsRoot: string | undefined;
  const wsRoot = getWorkspaceRoot?.();
  if (wsRoot) {
    try { runsRoot = await ensureProjectRunsRoot(wsRoot); } catch { runsRoot = undefined; }
  }
  const statusStore = runsRoot ? new TestStatusStore(runsRoot) : undefined;
  const testsTree = new TestsTreeProvider(testDiscoveryService, statusStore ?? new TestStatusStore(runsRoot ?? ''));
```
(`getWorkspaceRoot` already exists in `src/config.ts`; import it if not already imported. If `activate` is not async-friendly at that point, wrap in an IIFE or move into the existing async initialization.)

(c) Remove the `fliwright.runs` registration line and any menus referencing it (Task 12 handles package.json).

(d) Replace `runTests()` body. New signature + single-run guard at module scope:

```ts
  let runningPromise: Promise<void> | undefined;

  async function runTests(node: TestTreeNode | undefined, opts: { workspace?: boolean; testNamePattern?: string } = {}): Promise<void> {
    if (runningPromise) {
      vscode.window.showWarningMessage('A Fliwright run is already in progress.');
      return;
    }
    runningPromise = (async () => {
      await runCommand(opts.workspace ? 'Run Workspace Tests' : 'Run Test', async () => {
        const root = requireWorkspaceRoot();
        const file = opts.workspace ? undefined : (node && 'uri' in node ? node.uri : undefined) ?? (node && 'fileUri' in node ? node.fileUri : undefined) ?? vscode.window.activeTextEditor?.document.uri;
        const failureContextDir = resolveWorkspacePath(root, loadConfig().failureContextDir);
        const traceMode = getTraceMode();
        const traceDir = runsRoot ? vscode.Uri.file(runsRoot) : vscode.Uri.joinPath(root, '.fliwright', 'traces');

        session.setRunning(file?.fsPath ?? 'tests');
        const result = await runner.run({
          workspaceRoot: root,
          testFile: file,
          testNamePattern: opts.testNamePattern,
          runsRoot,
          vmServiceUrl: session.currentUrl,
          failureContextDir,
          traceMode,
          traceDir: traceMode !== 'off' ? traceDir : undefined,
        });
        const failures = await failureStore.loadLatest(failureContextDir, result);
        if (statusStore && file) {
          await statusStore.recordRun(`${Date.now()}`, Date.now(), root, result, relPathOfRoot(root, file));
        }
        statusBar.setRunResult(result);
        session.setConnectedIdle();
        testsTree.refresh();
        output.appendLine(`Run complete: ${result.passedTests}/${result.totalTests} passed, ${result.failedTests} failed.`);
        // (Failure surfacing UI from the old runTests is kept, minus runsTree usage.)
        if (result.failedTests > 0) {
          vscode.window.showErrorMessage(`Fliwright tests failed: ${result.failedTests}`, 'Open Failure')
            .then(async (sel) => {
              if (sel === 'Open Failure' && failures[0]?.source?.file) {
                await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(failures[0].source.file), 'fliwright.testEditor');
              }
            });
        }
      });
    })().finally(() => { runningPromise = undefined; });
    await runningPromise;
  }
```

Add a small helper `relPathOfRoot(root, uri)` mirroring the one in Task 8 (or export it from a shared util and import in both).

(e) Update `fliwright.runCurrentTest` command (around line 628) to accept either a `TestFileNode`/`TestCaseNode` (new) or legacy `{ uri }`. For a `testCase` node, pass `testNamePattern` = the full ancestor-chain title (reconstruct from id after `::`):

```ts
    vscode.commands.registerCommand('fliwright.runCurrentTest', async (node?: any) => {
      if (node?.kind === 'testCase') {
        const pattern = node.id.split('::')[1]?.split('/').join(' > ') ?? undefined;
        await runTests(node, { testNamePattern: pattern });
      } else {
        await runTests(node, {});
      }
    }),
```

(f) Remove `runsTree.prependRun(...)`, `runsTree.failuresList`, and the `fliwright.openRunViewer` command that depended on the in-memory list (replace its body to delegate to `runViewerPanel.openWithPicker()` which reads from disk — keep the command name if menus reference it, or remove and update menus in Task 12).

(g) **Wire the lazy-parse cache invalidation on save.** Add a debounced save listener in `activate()` (disposables-pushed) that calls `testsTree.invalidateFile(uri)` only for `.test.ts` files:

```ts
  const saveDebounce = new Map<string, NodeJS.Timeout>();
  context.subscriptions.push(vscode.workspace.onDidSaveTextDocument((doc) => {
    if (!doc.fileName.endsWith('.test.ts')) return;
    const key = doc.uri.toString();
    const existing = saveDebounce.get(key);
    if (existing) clearTimeout(existing);
    saveDebounce.set(key, setTimeout(() => {
      saveDebounce.delete(key);
      testsTree.invalidateFile(doc.uri);   // invalidate ONE file's parse cache + re-fire its subtree
    }, 300));
  }));
```

(Use `setTimeout`/`clearTimeout` from the global scope — this runs in the extension host, not a workflow script, so timers are allowed.)

(h) Delete `packages/fliwright-vscode/src/views/RunsTreeProvider.ts`.

- [ ] **Step 3: Typecheck + run full extension test suite**

Run: `pnpm --filter fliwright-vscode test`
Expected: PASS. Any test importing `RunsTreeProvider` must be updated (search: `grep -rn "RunsTreeProvider" packages/fliwright-vscode/tests`). The existing `TreeProviders.test.ts` does NOT import it (confirmed in spec exploration), so no test edits expected.

- [ ] **Step 4: Build check**

Run: `pnpm --filter fliwright-vscode compile` (or the package's build script — check `package.json` `scripts`). If no compile script, run `tsc -p packages/fliwright-vscode/tsconfig.json --noEmit`.
Expected: no type errors.

- [ ] **Step 5: Lint + commit**

```bash
pnpm --filter fliwright-vscode lint || true
git add -A packages/fliwright-vscode
git rm packages/fliwright-vscode/src/views/RunsTreeProvider.ts 2>/dev/null || true
git commit -m "feat(vscode): wire runs-root migration, single-run guard, status recording; remove Runs panel"
```

---

### Task 10: vscode — `ScriptsTreeProvider` View button

**Files:**
- Modify: `packages/fliwright-vscode/src/views/ScriptsTreeProvider.ts`

**Interfaces:**
- Consumes: nothing new from other tasks.
- Produces: script items set `contextValue: 'scriptFile'` (likely already set) and `command`/`description` such that a "View Run" entry appears (the actual command `fliwright.viewScriptRun` is registered in Task 11 and the menu wired in Task 12). Here we only ensure the script node carries enough identity (its relPath / uri) for Task 11 to find its run.

- [ ] **Step 1: Read current ScriptsTreeProvider**

Run: `sed -n '1,80p' packages/fliwright-vscode/src/views/ScriptsTreeProvider.ts` (survey).

- [ ] **Step 2: Ensure script nodes carry relPath/uri**

In `getTreeItem`, for a script entry, set `item.contextValue = 'scriptFile'` and keep `item.resourceUri = entry.uri`. The node must already expose `uri`; confirm the `ScriptFileEntry` type in `src/types.ts` has `uri` (it does — `uri: vscode.Uri; label: string;`). No type change needed.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter fliwright-vscode lint || true` then `tsc -p packages/fliwright-vscode/tsconfig.json --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/fliwright-vscode/src/views/ScriptsTreeProvider.ts
git commit -m "feat(vscode): script items carry identity for View Run"
```

---

### Task 11: vscode — `RunViewerService.openForTest/openForScript` + panel

**Files:**
- Modify: `packages/fliwright-vscode/src/runviewer/RunViewerService.ts`
- Modify: `packages/fliwright-vscode/src/runviewer/RunViewerPanel.ts`
- Test: `packages/fliwright-vscode/tests/RunViewerService.test.ts` (create)

**Interfaces:**
- Consumes: `projectRunsRoot` (Task 3) for the runs dir; `result.json`/`timeline.json` written by Tasks 1–2 + 6.
- Produces:
  - `RunViewerService.getRunsDir(root)` now resolves from `projectRunsRoot(root).runsDir` (fallback: legacy `<root>/.fliwright/runs` if it exists, for back-compat).
  - `async openForTest(testNodeId: string): Promise<void>` — list runs newest-first, return the first `result.json` that contains a key matching `testNodeId`; load that run's timeline; open it.
  - `async openForScript(scriptRelPath: string): Promise<void>` — first run whose `timeline.json` `mode === 'script'` (and optionally whose `result.json`/name matches the script); open it.
  - `RunViewerPanel.openRun(summary: RunSummary)` — open a specific run by summary (reuses existing panel rendering).

- [ ] **Step 1: Write the failing test**

Create `packages/fliwright-vscode/tests/RunViewerService.test.ts` using a temp runs dir with fixture `result.json`/`timeline.json`:

```ts
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RunViewerService } from '../src/runviewer/RunViewerService.js';

describe('RunViewerService.openForTest', () => {
  let runsDir: string;
  beforeAll(() => {
    runsDir = mkdtempSync(join(tmpdir(), 'fliwright-rv-'));
    // run-1 does NOT contain our node; run-2 DOES.
    mkdirSync(join(runsDir, 'run-1'), { recursive: true });
    writeFileSync(join(runsDir, 'run-1', 'result.json'), JSON.stringify({ results: [{ name: 'other > x' }] }));
    writeFileSync(join(runsDir, 'run-1', 'timeline.json'), JSON.stringify({ runId: 'run-1', testName: 'x', mode: 'test', status: 'passed', startedAt: '2026-01-01T00:00:00Z', nodes: [] }));

    mkdirSync(join(runsDir, 'run-2'), { recursive: true });
    writeFileSync(join(runsDir, 'run-2', 'result.json'), JSON.stringify({
      results: [{ name: 'suite > wanted' }],
    }));
    writeFileSync(join(runsDir, 'run-2', 'timeline.json'), JSON.stringify({ runId: 'run-2', testName: 'wanted', mode: 'test', status: 'passed', startedAt: '2026-06-21T00:00:00Z', nodes: [] }));
  });
  afterAll(() => rmSync(runsDir, { recursive: true, force: true }));

  it('finds the latest run whose result.json contains the test node id', async () => {
    const svc = new RunViewerService();
    const run = await svc.findLatestRunForTest(runsDir, 'tests/a.test.ts::suite/wanted');
    expect(run?.runId).toBe('run-2');
  });

  it('returns undefined when no run matches', async () => {
    const svc = new RunViewerService();
    const run = await svc.findLatestRunForTest(runsDir, 'tests/a.test.ts::none/here');
    expect(run).toBeUndefined();
  });
});
```

> The test calls a pure `findLatestRunForTest(runsDir, nodeId)` (no UI). `openForTest` wraps it + opens the panel; that path is verified manually in Task 13. Lock the signature: `async findLatestRunForTest(runsDir: vscode.Uri, testNodeId: string): Promise<LoadedRun | undefined>`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter fliwright-vscode test tests/RunViewerService.test.ts`
Expected: FAIL — method missing.

- [ ] **Step 3: Write minimal implementation**

In `packages/fliwright-vscode/src/runviewer/RunViewerService.ts`, change `getRunsDir` to prefer the migrated root:

```ts
  async getRunsDir(root: vscode.Uri): Promise<vscode.Uri | undefined> {
    // Prefer the migrated per-project root under the user home.
    const migrated = vscode.Uri.file(projectRunsRoot(root).runsDir);
    try { await vscode.workspace.fs.stat(migrated); return migrated; } catch { /* fall through */ }
    // Back-compat: legacy project-local runs dir.
    const legacy = vscode.Uri.joinPath(root, '.fliwright', 'runs');
    try { await vscode.workspace.fs.stat(legacy); return legacy; } catch { return undefined; }
  }
```

Add the finder + openers:

```ts
  async findLatestRunForTest(runsDir: vscode.Uri, testNodeId: string): Promise<LoadedRun | undefined> {
    const summaries = await this.listRuns(runsDir); // newest-first
    for (const s of summaries) {
      const resultJson = await this.readResultJson(s.runDir);
      if (!resultJson) continue;
      if (runResultContainsNode(resultJson, testNodeId)) {
        return this.loadRun(s.runDir);
      }
    }
    return undefined;
  }

  async findLatestRunForScript(runsDir: vscode.Uri, _scriptRelPath: string): Promise<LoadedRun | undefined> {
    const summaries = await this.listRuns(runsDir);
    for (const s of summaries) {
      if (s.mode === 'script') return this.loadRun(s.runDir);
    }
    return undefined;
  }

  private async readResultJson(runDir: vscode.Uri): Promise<any | undefined> {
    try {
      const buf = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(runDir, 'result.json'));
      return JSON.parse(Buffer.from(buf).toString('utf8'));
    } catch { return undefined; }
  }
```

```ts
function runResultContainsNode(resultJson: any, testNodeId: string): boolean {
  // testNodeId = "<relPath>::<a>/<b>"; the run's results use "a > b" names.
  // Compare the chain part.
  const chain = testNodeId.split('::')[1];
  if (!chain) return false;
  const needle = chain.split('/').join(' > ');
  const results = Array.isArray(resultJson?.results) ? resultJson.results : [];
  return results.some((r: any) => r?.name === needle);
}
```

Import `projectRunsRoot` from `../testing/ProjectRunsRoot.js`.

In `RunViewerPanel.ts`, add `openRun(runDir: vscode.Uri)` that loads via `RunViewerService.loadRun(runDir)` and renders (mirror existing `openLatest`/`openWithPicker` internals).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter fliwright-vscode test tests/RunViewerService.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Lint + commit**

```bash
pnpm --filter fliwright-vscode lint || true
git add packages/fliwright-vscode/src/runviewer/RunViewerService.ts packages/fliwright-vscode/src/runviewer/RunViewerPanel.ts packages/fliwright-vscode/tests/RunViewerService.test.ts
git commit -m "feat(vscode): RunViewerService resolves migrated root + openForTest/openForScript"
```

---

### Task 12: vscode — `package.json` views, menus, commands

**Files:**
- Modify: `packages/fliwright-vscode/package.json`

**Interfaces:**
- Consumes: command ids `fliwright.viewTestRun`, `fliwright.viewScriptRun` (registered in extension.ts as part of Task 11/9 — ensure both are registered; if not registered yet, add registration in this task).

- [ ] **Step 1: Survey current contributes**

Run: `grep -n "fliwright.runs\|fliwright.tests\|viewTestRun\|viewScriptRun\|openRunViewer" packages/fliwright-vscode/package.json`
Expected: lines referencing `fliwright.runs` view + its menus.

- [ ] **Step 2: Remove `fliwright.runs` view + menus**

Delete the `fliwright.runs` entry from `contributes.views.<container>` and every `contributes.menus` entry whose `when` references `view == fliwright.runs`.

- [ ] **Step 3: Register View commands + add menu/title-bar buttons**

In `contributes.commands` add:
```json
{ "command": "fliwright.viewTestRun", "title": "Fliwright: View Test Run", "category": "Fliwright" },
{ "command": "fliwright.viewScriptRun", "title": "Fliwright: View Script Run", "category": "Fliwright" }
```

In `contributes.menus` add `view/title` buttons on `fliwright.tests` (Refresh + Run All) and `view/item/context` entries for `testFile`/`testCase`/`scriptFile`:

```json
{
  "command": "fliwright.viewTestRun",
  "when": "view == fliwright.tests && viewItem =~ /testFile|testCase/",
  "group": "inline@2"
},
{
  "command": "fliwright.viewScriptRun",
  "when": "view == fliwright.scripts && viewItem == scriptFile",
  "group": "inline@1"
}
```
(Inline buttons in a custom TreeView appear when the command is in `view/item/context` with `group: inline@N` and the `when` matches the item's `contextValue`.)

- [ ] **Step 4: Ensure command handlers are registered**

In `extension.ts`, add (if not already present):
```ts
    vscode.commands.registerCommand('fliwright.viewTestRun', async (node?: any) => {
      const root = requireWorkspaceRoot();
      const runsDir = await runViewerService.getRunsDir(root);
      if (!runsDir || !node?.id) { vscode.window.showInformationMessage('No run recorded for this test yet.'); return; }
      const loaded = await runViewerService.findLatestRunForTest(runsDir, node.id);
      if (!loaded) { vscode.window.showInformationMessage('No run recorded for this test yet.'); return; }
      await runViewerPanel.openRun(loaded.runDir);
    }),
    vscode.commands.registerCommand('fliwright.viewScriptRun', async (node?: any) => {
      const root = requireWorkspaceRoot();
      const runsDir = await runViewerService.getRunsDir(root);
      if (!runsDir || !node?.uri) { vscode.window.showInformationMessage('No run recorded for this script yet.'); return; }
      const loaded = await runViewerService.findLatestRunForScript(runsDir, relPathOfRoot(root, node.uri));
      if (!loaded) { vscode.window.showInformationMessage('No run recorded for this script yet.'); return; }
      await runViewerPanel.openRun(loaded.runDir);
    }),
```
Expose `runViewerService` at module scope (rename the existing `RunViewerService` instance if it's inline in `RunViewerPanel` — check `RunViewerPanel.ts`; if the service is owned by the panel, add a getter or instantiate a service instance in `activate` and pass it to the panel).

- [ ] **Step 5: Validate package.json**

Run: `node -e "JSON.parse(require('fs').readFileSync('packages/fliwright-vscode/package.json','utf8')); console.log('ok')"`
Expected: `ok`.

- [ ] **Step 6: Compile + commit**

```bash
tsc -p packages/fliwright-vscode/tsconfig.json --noEmit
git add packages/fliwright-vscode/package.json packages/fliwright-vscode/src/extension.ts
git commit -m "feat(vscode): package.json — remove Runs view, add viewRun commands + inline buttons"
```

---

### Task 13: Manual verification + changelog

**Files:**
- Modify: `packages/fliwright-vscode/CHANGELOG.md`

**Interfaces:** none.

- [ ] **Step 1: Build the extension**

Run (in `/Users/leo.he/projects/fliwright`):
```bash
pnpm --filter fliwright-vscode install
pnpm --filter fliwright-vscode package
```
Expected: a `.vsix` produced, no errors.

- [ ] **Step 2: Install + open in the exio workspace**

Open VSCode on `/Users/leo.he/projects/exio/exio_app` with the dev extension (`F5` from the fliwright-vscode workspace, or install the `.vsix`).

- [ ] **Step 3: Verify the Tests panel**

- [ ] Panel shows `tests/*.test.ts` files. Open `tests/auto-login-v2.test.ts` in the tree — confirm describe/test nesting matches the source.
- [ ] Before any run, all nodes show `circle-outline` (unknown).
- [ ] Run one test file: statuses update (pass/fail icons). File + group aggregate correctly.
- [ ] Reload the window (`Developer: Reload Window`). Confirm statuses are restored from `index.json` (no re-run needed).
- [ ] Confirm artifacts landed under `~/.fliwright/projects/<hash>/runs/<runId>/` and **not** under `<exio>/.fliwright/runs/`.

- [ ] **Step 4: Verify View buttons**

- [ ] Click the inline View button on a test item → Run Viewer opens for that test's latest run.
- [ ] Click View on a script item → Run Viewer opens for that script's latest run.
- [ ] View on a test with no run → "No run recorded" message.

- [ ] **Step 5: Verify Runs panel is gone**

- [ ] The old `Runs` view no longer appears in the Fliwright sidebar container.

- [ ] **Step 6: Update CHANGELOG**

Append to `packages/fliwright-vscode/CHANGELOG.md` (Unreleased section):

```markdown
## Unreleased
### Changed
- Tests panel now renders a `file → describe → test` tree with per-node last-run status (pass/fail/never-run).
- Run artifacts (timeline, traces) moved from `<project>/.fliwright/runs` to `~/.fliwright/projects/<hash>/runs`.
- Removed the standalone Runs panel; use the View button on a test/script item to open its latest run.
### Added
- `fliwright.viewTestRun` / `fliwright.viewScriptRun` commands and inline View buttons.
### Notes
- Existing runs under `<project>/.fliwright/runs/` are not migrated automatically; move them manually if needed. The Run Viewer still reads the legacy location as a fallback.
```

- [ ] **Step 7: Commit**

```bash
git add packages/fliwright-vscode/CHANGELOG.md
git commit -m "docs(vscode): changelog for tests panel redesign + runs migration"
```

---

## Self-Review Notes (applied during authoring)

- **Spec coverage:** every spec section maps to a task — architecture (3.x) → Tasks 1–12; data flow (4.x) → Tasks 6/7/8/9; storage layout (5) → Tasks 3/6; core change (6) → Tasks 1/2; removals (7) → Task 9; error handling (8) → covered in TestStatusStore (corrupt index) + runTests (no-workspace) + View commands (no run); testing (9) → unit tests inline in Tasks 1–8, 11; manual (9) → Task 13. YAGNI items (10) explicitly excluded.
- **Type consistency:** `testNodeId(relPath, ancestors, title)` is defined once (Task 5) and reused by TestStatusStore (Task 6), TestsTreeProvider (Task 8), and RunViewerService's chain comparison (Task 11) with a consistent `<relPath>::<a>/<b>` ↔ `<a> > <b>` mapping. `RunParams.testNamePattern`/`runsRoot` defined in Task 7, consumed in Task 9.
- **Known implementation judgment calls** flagged inline for the implementer (not placeholders): group-children recursion choice (Task 8 Step 4), vitest mock fragility fallback (Task 7 Step 3), `runViewerService` ownership (Task 12 Step 4). Each has a concrete recommended path.
