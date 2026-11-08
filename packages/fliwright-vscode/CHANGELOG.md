# Changelog

## 0.2.2

- Open test source files directly from file and test case rows in the Tests panel,
  including while tests are running.
- Preserve missing coverage and evidence from all visual review comparison sources,
  forward custom tolerances, and handle PNG transparency in pixel comparisons.
- Keep each visual review run in a unique artifact directory and propagate Figma
  capture cancellation to active requests.

## 0.2.1

- Discover test groups and parameterized cases through isolated Vitest collection,
  with cancellable per-file caching and refresh when test dependencies change.
- Preserve individual test results and assertion history across focused runs, and
  open each test's latest artifacts in Run Viewer.
- Bundle the test catalog worker in the VSIX and retain exact test-name filters
  when running a collected case.

- Local and Item acceptance workflows share the configured run history with
  Run Viewer; Item directories keep plans and summaries. Roots overridden only
  in a CLI invocation are not discovered automatically. Remove unused legacy
  project-local run and trace path helpers; no legacy-root fallback is active.
- Separate authored `.fliwright` assets from machine-local runtime data. Runs,
  caches, raw recordings, review evidence, VM metadata, sessions and temporary
  runner configs default to `~/.fliwright/<project-path>/`, replacing every slash
  in the complete path with `-` and preserving the leading dash.
- Preserve explicit storage settings, support `~/` paths and
  `FLIWRIGHT_RUNTIME_ROOT` / `FLIWRIGHT_CACHE_ROOT`, and store shared Flow targets
  as project-relative paths. Existing data is preserved without automatic migration.

## 0.2.0

### Changed
- Tests panel now renders a `file → describe → test` tree with per-node last-run status (pass / fail / never-run). Source files are parsed lazily — only when a file row is expanded — and cached per file.
- Run artifacts (timeline, traces) moved out of the project to `~/.fliwright/projects/<hash>/runs/`, keyed by a hash of the workspace path. The project tree no longer carries a `.fliwright/runs/` directory.
- Removed the standalone Runs panel (`fliwright.runs`). Use the View button on a test or script item to open that item's latest run in the Run Viewer.
- `TimelineArtifactStore` (fliwright-core) and the vitest runtime now honor `FLIWRIGHT_RUNS_ROOT` / `config.runsRoot`, so a run's timeline + trace artifacts land together under the migrated root.

### Added
- `fliwright.viewTestRun` and `fliwright.viewScriptRun` commands, exposed as inline buttons on test and script items, opening the most recent run for that item.
- Per-test last-run status is persisted to an `index.json` under the migrated runs root and restored on activation (no re-run needed after reload).
- Single-test runs via the vitest `-t` name filter.

### Notes
- Existing runs left under `<project>/.fliwright/runs/` are not migrated automatically; the Run Viewer still reads that legacy location as a fallback. Move them manually under `~/.fliwright/projects/<hash>/runs/` if you want them to appear.

## 0.1.0

- Added Fliwright Activity Bar views for Devices, Mock APIs, and Form Data.
- Added Flutter VM Service connect, disconnect, and local discovery commands.
- Added runtime mock rule apply, default mock apply, and clear route commands.
- Added current-screen form analysis and selected-field fill workflows.
- Added Vitest coverage for extension services and tree provider behavior.
