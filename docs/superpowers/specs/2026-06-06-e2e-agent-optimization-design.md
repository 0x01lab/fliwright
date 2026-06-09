# E2E Agent Optimization Design

## Status

Implemented through P1 live-agent loop plus part of P2/P3:

- Ref registry and `e<N>` snapshot refs in the Dart bridge.
- `ext.fliwright.snap` agent snapshot extension.
- Ref-backed action path with actionability diagnostics.
- Core SDK `Page.snapshot()`, `Page.ref()`, `Page.findRef()`.
- MCP `snap`, `find`, `observe`, ref-based `tap/type/wait`, and `hot_reload_and_snap`.
- Playwright-style SDK/MCP/bridge actions: hover, multi-click, right click, focus/blur, clear, pressKey, setCheckbox, selectOption, dismissModal, and mock-backed waitForNetworkIdle.
- CLI `capabilities/interaction` and `capabilities/form` modules that centralize reusable operations for CLI/MCP/VS Code integration.
- MCP `fliwright_diagnostics` for buffered VM Service diagnostic events.
- CLI `fliwright run --reporter ai-json` and MCP `fliwright_run` now share `@fliwright/cli/run`, producing persisted `.fliwright/runs/<runId>/report.json` reports with failures, screenshots, diagnostics, artifacts, and reproduce commands.
- `@fliwright/vitest` exposes both `page` and `driver` fixtures, supports `FLIWRIGHT_VM_URL` plus legacy `FLIWRIGHT_VM_SERVICE_URL`, and captures richer failure context for AI repair loops.
- E2E examples are fixture-first where possible, with the Exio live app script intentionally kept on the raw driver path for older bridge compatibility.
- FormHelper regression guardrails preserving `ext.fliwright.extractForm` as the canonical form discovery path.

Remaining P2/P3 items include making the snapshot bridge more Semantics-first without losing the live Element action target required by ref actions.

## AI Run Report Loop

The authored-test loop is now:

```text
AI agent -> bash/CLI or MCP fliwright_run
  -> @fliwright/cli/run
  -> Vitest + @fliwright/vitest fixture
  -> sidecar failure context
  -> .fliwright/runs/<runId>/report.json
  -> AI summary/fix/re-run
```

The report includes per-test results, structured failures, widget tree snapshots, recent VM Service diagnostics, failure screenshots, artifact paths, and a reproduce command. MCP stores the same `RunResult` in server state, so `fliwright_get_failure` and the `test_report` resource can be used after the run without re-parsing shell output.

## Capability Ownership

The intended system boundary is:

```text
Flutter bridge + @fliwright/core protocol
  -> @fliwright/cli capability modules and commands
  -> MCP server / VS Code extension adapters
```

The CLI package now exposes `capabilities/interaction` as the shared source for interaction workflows such as snap/find/observe/tap/type/action/wait/hotReloadAndSnap/diagnostics, and `capabilities/form` as the shared source for FormHelper analyze/fill/fillFields. MCP interaction handlers are thin adapters over the interaction capability. VS Code FormHelper commands are thin adapters over the form capability while preserving the original `ext.fliwright.extractForm` discovery path.

## Ref Model

- `e<N>` refs are snapshot-time references to live Flutter elements. They store the `Element`, render rect, group id, role, label, enabled state, and optional semantics id.
- `q<N>` query refs are represented in `RefRegistry` but are not the primary action path yet.
- `q<N>` query refs re-resolve against the live widget tree before actionability checks when passed to `ext.fliwright.action`.
- Snapshot refs are preferred for agent interactions because MCP agents can inspect once, choose a visible target, then act by ref.

## Snapshot And Observe

`ext.fliwright.snap` walks the on-stage widget tree and reuses `InspectExtension.extractWidgetInfo()` to build compact text plus structured refs. Semantics currently contributes labels, hints, roles, identifiers, selector fallbacks, and stable ref reuse through `semanticsId`; it is not yet the sole traversal source. The TS/MCP `find` and `observe` layers filter these snapshot refs instead of adding a second Dart observe extension. This keeps the first live-agent loop small and avoids duplicating form discovery logic.

## MCP Parameter Validation

MCP tools use zod schemas for field-level validation and defaults. Handlers also call `ParamsSchema.parse()` before invoking CLI capabilities so object-level refinements are enforced outside the MCP SDK registration boundary, including `ref/key/text/type` one-of constraints and action-specific fields such as `keyboardKey`, `checked`, and `value`.

## Actionability

Ref actions pass through `ensureActionable()` before dispatch:

1. Defunct element/render object.
2. Disabled metadata.
3. Zero rect.
4. Off-viewport, with `showOnScreen()` attempt.
5. Rect drift across a scheduled frame.
6. Optional hit-test receives-events check.

The gate is wired for ref actions first. Selector actions and FormHelper flows remain compatible.

Widget tests may pass `checkStable=false` to `ext.fliwright.action` because Flutter test fake async does not always advance `endOfFrame`/timer-based waits without an explicit pump. Production action calls keep the stable check enabled by default.

## FormHelper Guardrail

FormHelper still calls `ext.fliwright.extractForm` and does not depend on snapshots or refs. `fillFields()` now prefers exact hint matches before substring matches, preventing similar-label collisions such as `邮箱地址` versus `地址`. `fillWithResolved()` continues to preserve exact `targetId`.

VS Code uses the CLI form capability wrapper for analyze/fill/fillFields, but that wrapper delegates directly to `driver.page.formHelper`. This keeps CLI as the capability owner without changing the underlying precise Flutter element discovery behavior.

## Hot Reload Verification

`FliwrightDriver.reloadSources()` calls VM Service `reloadSources` for the main isolate. MCP `fliwright_hot_reload_and_snap` chains:

```text
reloadSources -> Page.snapshot() -> Page.screenshot()
```

Reload failures return diagnostics immediately. Screenshot failures still return the semantic snapshot.
