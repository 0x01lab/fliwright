# Tests Panel Redesign + Runs Migration — Design

- **Date:** 2026-06-21
- **Scope:** `packages/fliwright-vscode` (primary) + `packages/fliwright-core` (run-root plumbing)
- **Status:** Design (pending approval)

## 1. Goal

Redesign the Fliwright VSCode **Tests** panel so it behaves like Jest/Playwright test explorers:

1. Each test file row shows the **last-run outcome** (pass / fail / never-run), clearly distinguished.
2. A test file with multiple `test()` calls renders as a **file → describe → test tree**, where every node has a status icon.
3. Each test item (and the file title row) has a **View** button to open the run's timeline (Run Viewer) for *that* test — replacing the hard-to-navigate global Runs panel.

Secondary goals, raised during brainstorming:

4. Stop storing run artifacts under the project directory. Move them to `~/.fliwright/projects/<hash>/`.
5. Remove the standalone **Runs** panel (`fliwright.runs` / `RunsTreeProvider`); per-run viewing moves onto the test/script items themselves.
6. Scripts panel (`fliwright.scripts`) gets a per-item **View** button to open that script's latest run timeline.

## 2. Key Decisions (confirmed with user)

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | Use **custom TreeView**, NOT VSCode TestController | Need custom inline buttons + custom title-row buttons on items; `TestItem` cannot host either. |
| D2 | Tree discovery = **static parse** of `test()`/`it()`/`describe()` | Never-run tests must be visible; describes must nest. Run results later *update* node status. |
| D3 | Last-run status bridged via **vscode-side persisted `result.json`** | `timeline.json` (written by core) carries only `testName`, no file/`test()` identity. The vitest JSON output has file + per-test identity but was in-memory only. Persisting it gives an accurate, restorable source. |
| D4 | Storage migrates to **`~/.fliwright/projects/<hash>/`** | Keep the project tree clean; runs no longer tracked in git or polluting the workspace. |
| D5 | **Modify fliwright-core** so it writes run artifacts to the new location (one spec/plan, both packages) | Cleaner than vscode-side post-run relocation; no stray artifacts left in the project. |
| D6 | Run granularity = **file + single-test + multi-select** | Standard test-explorer UX; requires per-test filtering in the runner. |
| D7 | `[👁 View]` opens **Run Viewer (timeline)**, not the visual editor | "View a run" means inspecting what happened during the run, which is the timeline. The visual editor (editing the test itself) stays on its existing entry points. |
| D8 | Single concurrent run only | Multiple vitest processes would contend for the shared VM service URL. |

## 3. Architecture

### 3.1 Components

All under `packages/fliwright-vscode/src` unless noted.

| File | Role | New / Changed |
|------|------|---------------|
| `views/TestsTreeProvider.ts` | Rewrite: emits a 3-level `file → describe → test` tree with per-node status icons and View/Run buttons. | **Rewritten** |
| `testing/TestTreeBuilder.ts` | Static parse of `.test.ts` into nested `describe/test` nodes. | **New** |
| `testing/TestStatusStore.ts` | Owns `index.json` (per-test last status) + writes/reads `result.json` under the migrated runs root. Lazy-loads `result.json` bodies. | **New** |
| `testing/ProjectRunsRoot.ts` | Resolves `~/.fliwright/projects/<hash>/runs` from a workspace root (hash = SHA1(repoPath)[0..11]); writes `meta.json`. | **New** |
| `runner/VitestRunner.ts` | Add optional `testNamePattern` → `vitest -t "<pattern>"`. `parseVitestJson` unchanged (covered by existing unit test). | **Changed** |
| `runner/TestRunner.ts` | `RunParams` gains `testNamePattern?: string`. | **Changed** |
| `runviewer/RunViewerService.ts` | Read root becomes the migrated runs root (injected). Add `openForTest(testItemId)` / `openForScript(scriptId)` that pick the latest run matching that id. | **Changed** |
| `views/ScriptsTreeProvider.ts` | Script items gain a View button. | **Changed** |
| `extension.ts` | Wire new components; route Run/View commands; **remove** `fliwright.runs` registration + RunsTreeProvider; pass runs root to runner via env. | **Changed** |
| `config.ts` | Add `runsRoot` resolution helper; keep `testGlob`. | **Changed** |
| `package.json` | Remove `fliwright.runs` view + menus; add `fliwright.viewTestRun` / `fliwright.viewScriptRun` commands + inline-button `when` clauses on test/script items. | **Changed** |
| **core:** `packages/fliwright-core/src/timeline/TimelineArtifactStore.ts` | `runDir` resolves from `options.runsRoot` (env-backed) before falling back to `cwd/.fliwright/runs`. | **Changed** |

### 3.2 Tree node model

Extend `types.ts` test nodes to a nested discriminated union:

```ts
type TestNodeStatus = 'passed' | 'failed' | 'unknown';

interface TestFileNode {
  kind: 'testFile';
  uri: vscode.Uri;
  label: string;
  status: TestNodeStatus;            // aggregate of children's last results
  ranAt?: number;
}
interface TestGroupNode {            // describe()
  kind: 'testGroup';
  id: string;                        // "<relPath>::祖先链/标题"
  label: string;
  status: TestNodeStatus;
}
interface TestCaseNode {             // test() / it()
  kind: 'testCase';
  id: string;                        // "<relPath>::祖先链/标题"
  label: string;
  status: TestNodeStatus;
  durationMs?: number;
  fileUri: vscode.Uri;
}
interface TestStepNode {             // optional drill-down from AnnotationParser
  kind: 'testStep';
  label: string;
  status: 'passed' | 'failed' | 'pending';
  fileUri: vscode.Uri;
  stepIndex: number;
}
type TestTreeNode = TestFileNode | TestGroupNode | TestCaseNode | TestStepNode
                  | { kind: 'empty'; label: string };
```

`TestItem`-style stable ids (`<relPath>::祖先链/标题`) are the join key between parsed tree and `index.json` / `result.json`.

### 3.3 Status icon mapping (TreeView)

| Status | ThemeIcon |
|--------|-----------|
| passed | `pass` (filled) |
| failed | `error` |
| unknown / never-run | `circle-outline` |

File/group nodes aggregate: any child failed → failed; else any child passed → passed; else unknown.

## 4. Data Flow

### 4.1 Discovery + restore on activation

1. `TestDiscoveryService` (unchanged) finds `tests/**/*.test.ts` via `testGlob`.
2. `TestTreeBuilder.parse(fileUri)` → nested nodes, cached per file.
3. `TestStatusStore.loadIndex()` reads **one** `index.json` (per-test last status) into a map.
4. `TestsTreeProvider` stamps each node's status from the map; nodes absent from the index stay `unknown`.

Performance: O(test count) memory lookup, **zero run-directory scan** on activation.

### 4.2 Incremental on save

- `onDidSaveTextDocument` (300 ms debounce) re-parses only the saved file and replaces its subtree; statuses re-applied from the in-memory index.
- `createFileSystemWatcher(testGlob)` handles add/delete of test files.

### 4.3 Run (live update)

1. User invokes Run on file / single test / multi-select / Run All.
2. `runTests(node, opts)` resolves the affected file(s) and optional `testNamePattern` (single-test → exact title; multi-select → `|`-joined).
3. `VitestRunner.run({ ..., testNamePattern })` spawns `pnpm vitest run [file] [-t "pattern"] --reporter=json`.
4. `parseVitestJson` (unchanged) → `RunResult` with per-assertion `name` (`"suite > title"`), `passed`, `duration`, `error`.
5. `TestStatusStore.recordRun(runResult)`:
   - Writes `<runsRoot>/<runId>/result.json` (full detail).
   - Patches `index.json` for every test in this run (status, runId, ranAt, duration).
6. `TestsTreeProvider` updates **only the affected nodes** (matched by file + ancestor-chain title), not the whole tree.
7. Old runs pruned (keep last N); dangling `index.json` entries pointing at pruned runs are removed.

Serial: a run in progress rejects/queues a second invocation (D8).

### 4.4 View entry points

- `fliwright.viewTestRun` (arg: `TestCaseNode | TestFileNode`) → `RunViewerService.openForTest(id)` opens the latest run whose result.json contains that test id.
- `fliwright.viewScriptRun` (arg: script node) → `openForScript(scriptRelPath)` opens the latest `mode: 'script'` run for that script.
- Inline buttons: title row + each `testCase`/`testFile` show [▶ Run] and [👁 View]; `testStep` rows keep the existing "open visual editor" command.

## 5. Storage layout

```
~/.fliwright/
  projects/
    <sha1(repoPath)[0..11]>/
      meta.json                 # { "projectPath": "<abs>", "updatedAt": <ms> }
      runs/
        index.json              # { "<testNodeId>": { runId, status, ranAt, durationMs } }
        <runId>/
          timeline.json         # written by fliwright-core (nodes tree)
          result.json           # written by vscode: filePath + per-test status + error + stdout
          logs/
          artifacts/...
```

- `index.json` is the **only** file read at activation.
- `result.json` / `timeline.json` are read lazily on View.
- Hash keeps runs isolated per project; `meta.json` makes the mapping human-readable and lets a "forget project" cleanup later.

## 6. fliwright-core change (D5)

`TimelineArtifactStore` constructor currently hard-codes `join(cwd, '.fliwright', 'runs', runId)`. Change to:

```ts
constructor(options: TimelineArtifactStoreOptions) {
  const root = options.runsRoot
    ?? process.env.FLIWRIGHT_RUNS_ROOT
    ?? join(options.cwd ?? process.cwd(), '.fliwright', 'runs');
  this.runDir = join(root, options.runId);
}
```

- `TimelineArtifactStoreOptions` gains `runsRoot?: string`.
- The vscode runner sets `FLIWRIGHT_RUNS_ROOT=<projectRunsRoot>` in the child env (alongside the existing `FLIWRIGHT_MCP_FAILURE_CONTEXT_PATH` / `FLIWRIGHT_VM_URL`).
- **Design intent:** all of a run's artifacts (timeline + screenshots/trace) live together under the migrated root. `TraceCollector`'s `traceRoot` (separate code path for screenshot/trace artifacts) therefore also resolves to `<projectRunsRoot>`; the vscode runner's trace-dir wiring (`runTests()` builds `traceDir = root/.fliwright/traces` today) is updated to point at the migrated root. The implementation plan will specify the exact `TraceCollector`/env plumbing; the *behavioral* commitment — one run, one root directory — is fixed here.
- Backward compat: callers that don't pass `runsRoot` / env get today's behavior — no breakage to existing core consumers.

## 7. Removals

- `fliwright.runs` TreeView registration, `RunsTreeProvider`, its commands (`fliwright.openRunViewer` picker entry that depended on the in-memory list is replaced by per-item View), and related `package.json` menus.
- `runsTree.prependRun` / `setRuns` / `failuresList` call sites in `extension.ts` — failure surfacing now flows through the per-test status + View path. (The failure store / `FailureContextStore` itself stays; only the Runs-panel consumption is removed.)
- `RunEntry` in-memory history is no longer the source of truth (the on-disk `result.json` is).

## 8. Error handling / fallbacks

| Scenario | Handling |
|----------|----------|
| `index.json` missing/corrupt | Treat as empty index; all nodes `unknown`; activation unaffected. |
| `result.json` test names don't match parsed `test()` (renamed test) | Match by ancestor-chain title; unmatched results are kept in run history but don't pollute tree status. |
| vitest missing / non-zero / timeout | Reuse existing `fallbackResult`; node → `failed` with stderr as message. |
| Workspace has no `.test.ts` | Empty state node "No Fliwright tests" (TreeView still needs a row). |
| View requested but no run exists for that test | Information message "No run recorded for this test yet"; no panel opened. |
| Run triggered while another run is in progress | Reject with status-bar message; no queuing in v1. |

## 9. Testing

- **Unit (vitest, existing harness):**
  - `TestTreeBuilder`: parse flat file, nested `describe`, `it` alias, quoted/escaped titles, unbalanced nesting. (Property: parser is pure, no vscode dep → easy to test.)
  - `TestStatusStore`: write `result.json` + patch `index.json`; restore statuses from index; prune dangling entries; corrupt-index tolerance.
  - `ProjectRunsRoot`: stable hash for a path; `meta.json` round-trip; idempotent.
  - `VitestRunner`: extend existing test — `testNamePattern` adds `-t`; `parseVitestJson` unchanged (existing assertion still green).
  - `RunViewerService.openForTest/openForScript`: picks latest matching run id from the migrated root.
- **Existing tests to keep green:** `VitestRunner.test.ts`, `TreeProviders.test.ts` (does not cover TestsTreeProvider; other providers unaffected), `RecordingPanel`/`AnnotationParser` etc.
- **Manual / integration:** run a file with 3 `test()`; verify tree shows 3 leaves with correct statuses after run; View opens correct run; status survives window reload (re-read from `index.json`); artifacts appear under `~/.fliwright/projects/<hash>/runs/`, not under the project.

## 10. Out of scope (YAGNI)

- Real-time AST watch (only onSave).
- Reading any `result.json` body at activation (lazy only).
- Cross-workspace / global run history.
- Parallel runs.
- Migrating historical runs already on disk under `<project>/.fliwright/runs/` (one-time; users can manually move or just start fresh). A small migration note in the changelog.
- Debug profile (only Run profile; Run-only matches current runner capability).
