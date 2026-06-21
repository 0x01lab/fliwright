# Changelog

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
