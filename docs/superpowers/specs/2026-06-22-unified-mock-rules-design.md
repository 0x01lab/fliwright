# Unified Mock Rules — Single-State Design

- **Date:** 2026-06-22
- **Status:** Approved (pending spec review)
- **Scope:** `packages/fliwright-vscode` (primary), light touch on `packages/fliwright-core`
- **Branch context:** `design/tests-panel-treeview-runs-migration`

## Problem

Mock rules reach the Flutter app through several channels (VSCode plugin UI, the test
`mock` fixture / `driver.mock`, the CLI mock controller, and Hive cold-start rehydration),
and they all bottom out at the **same** Dart `MockRuleStore` keyed by `"${METHOD} ${path}"`
(last writer wins per key). That convergence is correct in principle, but the VSCode plugin
maintains a **second, competing state** on top of the Dart store:

- `SandboxService.applied` — a local map of "what VSCode thinks it applied".
- `SandboxService.reconcileFromFlutter` — an autonomous reconcile that, on every connect /
  reload, prunes routes lacking a `fliwright-vscode:` id prefix and nukes the entire store
  when it sees any "unmatched" route.

This second state fights the test harness and the Dart store. Symptoms (confirmed in the
existing test suite and git history — four back-to-back fix commits `625e2e0`, `18ee0a5`,
`f3de7ce`, `d5fde1d` all patching the same class of "VSCode vs. the store" divergence):

- Rules set in VSCode appear to stop working because reconcile pruned/overrode them.
- Stale rules from a previous session resurrect via Hive and are either silently "adopted"
  (single-rule endpoints, `resolveFlutterRoute` `singleRule` fallback) or trigger a full
  store clear (`sync.unmatched.length > 0`).

The root cause is architectural, not a regression: **multiple autonomous writers to one
mutable store with no single owner.** Patching symptom N produces symptom N+1.

## Goal

One unified, singleton mock-rule state per connected app, managed through one API, with the
VSCode plugin acting as a **purely reactive** view + controller — never a competing owner.

### Non-goals

- Cross-process in-memory sharing of a TS object. (Impossible: the VSCode extension host and
  the vitest worker are separate processes.) The shared boundary is the Flutter app.
- Simultaneous-coexistence precedence rules when VSCode and a test write the **same**
  method+path in one session. Last-writer-wins at the store is accepted; the user's primary
  pain is cross-session resurrection, not live contention.
- Replacing `MockManager`. It already is the unified TS API; we reuse it.

## Architecture

### Where the singleton lives

The only state shared by the VSCode process and the test process is the running Flutter app.
Therefore:

- **Single state** = the connected app's Dart `MockRuleStore` (+ Hive persistence). One per
  app session — different apps are independent, which matches intuition.
- **Single TS API** = `MockManager` (`driver.mock`) in `fliwright-core`. The test `mock`
  fixture already wraps it; VSCode will now route through it too, instead of through a
  competing `SandboxService` layer.
- **VSCode holds no competing state.** Everything VSCode believes about mocks comes from a
  live read of `MockManager.listFlutterRoutes()`.

### Unification principle

Remove VSCode's "second state" entirely. `SandboxService` becomes a thin, UI-facing adapter
over `driver.mock`: apply / stop / clear / list. No `applied` map, no reconcile, no prune, no
ownership-by-id-prefix.

```
VSCode click ──────┐
test mock.route ───┤──> MockManager (driver.mock) ──> ext.fliwright.mock.* ──> Dart MockRuleStore (single) ──> Hive
CLI mock:start ────┘                                                                     │
                                                                                        ▼
                  VSCode tree / test assertions  <────  MockManager.listFlutterRoutes()  <──── read
```

## Detailed Design

### Dart side — no functional change

`MockRuleStore`, both interception backends (`MockServerExtension` / `DioMockExtension`),
and `HiveMockRuleStorage` stay as-is. They are the single state. This is deliberate: the
fix is on the consumer side (VSCode), not the store side.

### Persistence policy — keep as-is

Hive continues to persist **all** routes and reload them on cold start. Rationale:

1. It supports "mock needed at app boot" scenarios (APIs called during startup).
2. In a unified, reactive model there is no ownership distinction to encode, so persisting
   everything is the coherent choice.
3. Resurrection stops being a divergence bug: VSCode faithfully displays whatever the store
   holds, so a rehydrated route is visible and explicitly clearable via "Stop All" — never a
   silent surprise.

Cold-start behaviour: load from Hive as today. No session-scoped clearing.

### `fliwright-core` — `MockManager` clarified, not rebuilt

`MockManager` is already the unified API. Add JSDoc declaring it the single mock-management
entry point. No behavioural change.

### `packages/fliwright-vscode`

#### `src/sandbox/SandboxService.ts` — gut to a reactive client

**Remove:**

- The `applied` map and all its derived methods (`getAppliedRules`, `isApplied` reading the
  map).
- `reconcileFromFlutter` (the whole method).
- `syncFromFlutter`'s `unmatched` / stale classification; it becomes a pure read.
- The `resolveFlutterRoute` `singleRule` adoption path and the `singleRule` helper — they
  existed to classify routes for prune/adopt, which is gone.
- Dead stubs `getControllerUrl` / `ensureController` (already no-ops).

**Keep / simplify:**

- `applyRule(entry)` → `routeFlutter` + `assertFlutterMockReady`. No local-map write.
- `stopRule(entry)` → `removeFlutterRoute` + verify gone (existing logic, unchanged).
- `clear()` ("Stop All") → `clearFlutterRoutes`. Semantics now: clear the **entire unified
  store** (this is the desired unified behaviour).
- New `getActiveRules(driver)` → wraps `driver.mock.listFlutterRoutes()` and best-effort maps
  each route to a known endpoint/rule for display. Routes that don't map to a configured rule
  are returned as "active, unclassified" (the tree shows them as active without a rule badge).
- `applyDefaultMocks(...)` stays as an **explicit user command** (not auto-on-connect).

`isApplied(rule)` / "which rule is active for this endpoint" is answered by reading the store
via `getActiveRules`, not by a local map.

#### `src/sandbox/MockRuleSelectionStore.ts` — delete

Purely reactive means no auto-restore on reconnect, which was this store's only purpose.
Delete the file and all call sites (see Migration).

#### `src/views/MockApiTreeProvider.ts` — read active state from the store

The "active" / "default" badges are derived from `SandboxService.getActiveRules()`
(`listRoutes`), refreshed after every apply / stop / clear and on connect. Unclassified
foreign/test routes show as active without a rule badge.

#### `src/extension.ts` — connect handler becomes read-only

Replace the reconcile orchestration chain with a single read-only tree refresh:

- `configureMocksAfterConnect` (`:1180`) → drops `requestMockStateSync({ restoreSelections: true })`;
  becomes "refresh the mock tree once the session is ready".
- `synchronizeMockStateAfterConnect` (`:1192`) and the `reconcileFromFlutter` call (`:1224`)
  are removed.
- `requestMockStateSync` (`:201`), `waitForFlutterMockExtension` (`:1944`) — remove the
  reconcile-specific branches. Keep only what's needed for a single read pass to populate the
  tree (e.g. waiting for the mock extension to register so `listRoutes` responds).
- `reloadMocks` (`:381`) → drops `restoreSelections`; refreshes tree + discovery only.
- Remove all `MockRuleSelectionStore` usage: `:68` (instantiation), `:501`, `:551`, `:1271`,
  `:1283` (`saveAppliedRule`), and the `restoreSelections` plumbing at `:203/:242/:382/:1196/:1205`.
- Keep explicit commands: `applyMockRule`, `stopMockRule`, `stopSandbox` (Stop All),
  `applyDefaultMocks`, `reloadMocks`, `createMockConfig`, `openMockConfig`, copy commands.

## Error Handling

- **Keep `assertFlutterMockReady`** as the apply-time guard. Registering a route in the store
  does not guarantee traffic interception: in Dio mode the interceptor must be injected
  (`interceptorInjected === true`) and the HTTP server must be running in HTTP mode. Surface
  these failures loudly at apply time (existing behaviour) — this is the other major cause of
  "settings don't work" and is independent of unification.
- apply / stop failures propagate to the user (existing error surfacing). No silent no-ops.

## Testing

### `tests/SandboxService.test.ts` — rewrite

Delete the tests that encode the **old competing behaviour** (these assert the exact logic we
are removing):

- `:66` treats non-prefixed ids as stale for multi-rule endpoints.
- `:83` adopts non-prefixed ids for single-rule endpoints.
- `:108` rebuilds stale cache from defaults.
- `:221` removes suppressed routes; `:251` adopts VSCode-managed routes; `:275` prunes foreign
  routes; `:301` / `:323` reconcile selection over cached rule.

Replace with **reactive** cases:

- `applyRule` adds a route visible via `listFlutterRoutes`.
- `stopRule` removes it; `listFlutterRoutes` no longer returns it.
- `clear` empties the store.
- On "connect", the service performs a read-only refresh and does **not** mutate the store
  (no apply, no prune, no clear) — assert `routeFlutter` / `removeFlutterRoute` /
  `clearFlutterRoutes` are not called by the connect path.
- A pre-existing foreign route (no `fliwright-vscode:` id) survives connect unchanged and is
  surfaced via `getActiveRules` as active-unclassified.
- `assertFlutterMockReady` still rejects applies when the Dio interceptor is missing (keep the
  existing `:568` case).

### `packages/fliwright-core`

`MockManager` / `MockRuleController` tests are unchanged — the unified API is not altered.

## Migration / Breaking Changes

Behavioural changes visible to users:

1. **Reconnect no longer auto-restores or auto-applies defaults.** Users re-apply explicitly.
   (Accepted: user chose purely reactive.)
2. **"Stop All" clears the whole store**, including routes VSCode did not create. (Desired
   unified semantics.)
3. Per-endpoint "last selection" memory is gone (selection store deleted).

Internal removals (all in `packages/fliwright-vscode`):

- `SandboxService`: `applied`, `reconcileFromFlutter`, stale/unmatched classification,
  `singleRule` helper, controller stubs.
- `MockRuleSelectionStore.ts` (file) + all call sites in `extension.ts`.
- `extension.ts` reconcile orchestration (`synchronizeMockStateAfterConnect`, reconcile branch
  of `requestMockStateSync` / `waitForFlutterMockExtension`, `restoreSelections` plumbing).

## Out of Scope

- Live same-session contention between VSCode and a test writing the same method+path (last
  writer wins; address later if it becomes a real pain).
- Any Dart-side schema or wire-format change.
- A new TS service class wrapping `MockManager` (redundant ceremony).

## Decisions Log

- **Reactive on connect** (vs. auto-restore-without-prune): chosen. Simplest unified model;
   VSCode never mutates the store unless the user acts.
- **Delete `MockRuleSelectionStore`**: confirmed — purely reactive removes its purpose.
- **Hive persistence kept as-is**: confirmed — supports boot-time mock scenarios; unified
   display makes resurrection visible-and-clearable rather than a silent divergence.
