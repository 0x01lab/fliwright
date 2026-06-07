# E2E Agent Optimization Plan

> **For agentic workers:** implement this plan task-by-task. Keep changes scoped, add regression tests for every protocol/tool behavior, and update `docs/features/` after the implementation is stable.

**Goal:** Upgrade Fliwright's E2E experience from selector-only remote control to an agent-friendly, ref-based live-app automation loop with stronger actionability checks, better MCP ergonomics, and faster edit-verify workflows.

**Context:** Fliwright already has a strong authored-test foundation: Vitest integration, form auto-fill, mock API control, Riverpod state access, recording/codegen, self-healing, screenshots, and failure context. Dusk's strongest ideas are complementary: Semantics snapshot refs, re-resolvable query handles, actionability gates, observe-style candidate discovery, and unified CLI/MCP operation surfaces.

**Architecture:** Add a ref registry and snapshot protocol to the Dart bridge, expose it through core SDK `Page`/`Locator`, then route MCP and CLI interaction tools through the same contracts. Keep Vitest tests and existing selectors working while adding `ref` as the preferred agent target.

**Compatibility Constraint:** Do not replace or weaken the existing FormHelper element discovery path. `ext.fliwright.extractForm`, `FormHelper.analyze()`, `FormHelper.fill()`, and `FormHelper.fillFields()` are already precise and must remain the canonical form automation pipeline. New snapshot/ref/observe features may reuse FormHelper metadata as enrichment, but must not make FormHelper depend on the new ref registry or lower its selector accuracy.

**Capability Ownership Constraint:** The CLI package is the shared capability owner for human and agent workflows. MCP Server and VS Code integration should be thin adapters over CLI capability modules/commands instead of duplicating core interaction logic. Current implementation exposes `packages/fliwright-cli/src/capabilities/interaction.ts` for live-app interaction workflows and `packages/fliwright-cli/src/capabilities/form.ts` for the existing precise FormHelper workflow; MCP interaction tools and VS Code FormHelper integration now route through those capability modules.

**Semantics Constraint:** Semantics data is currently used as enrichment for labels, roles, stable `semanticsId` refs, and selector fallbacks. `ext.fliwright.snap` still walks the on-stage Element tree and extracts Semantics metadata from widgets; it is not yet a pure Semantics tree traversal. Treat Semantics as an important signal, not the only source of truth, until a later Semantics-first mapping can preserve action targets without weakening FormHelper.

**Tech Stack:** Dart VM Service extensions, Flutter Semantics/RenderObject tree, TypeScript core SDK, MCP tools, Vitest, Dart tests

---

## Priority Roadmap

| Priority | Theme | Outcome |
|----------|-------|---------|
| P0 | Ref-based snapshot + actionability | Agents can inspect the running app, receive stable refs, and act with fewer flaky taps |
| P1 | Observe + hot reload loop | Agents can discover candidate actions and validate UI changes in one round-trip |
| P2 | CLI/MCP parity + extra actions | Human and agent surfaces share the same tool contract and more Playwright-style verbs |
| P3 | Documentation + install hardening | Easier onboarding, safer debug-only bridge setup, and better AI-consumable docs |

---

## Task 1: Add Ref Registry to Dart Bridge

**Goal:** Introduce stable `e<N>` snapshot refs and re-resolvable `q<N>` query handles in the Dart bridge.

**Files:**
- Create: `packages/fliwright-bridge/lib/src/ref_registry.dart`
- Create: `packages/fliwright-bridge/test/ref_registry_test.dart`
- Modify: `packages/fliwright-bridge/lib/fliwright_bridge.dart`

**Implementation Notes:**
- `e<N>` refs represent snapshot-time widget entries: Element, RenderObject, Rect, optional SemanticsNode, group id, role, label.
- `q<N>` refs represent query predicates and re-resolve against the live tree on every action.
- Keep the two token spaces disjoint.
- Add `disposeGroup(groupId)` and `resetForTesting()`.
- Cache `e<N>` by SemanticsNode id where possible so stable widgets keep stable refs across snapshots.

**Steps:**
- [x] Define `RefEntry`, `QueryRef`, and `RefRegistry`.
- [x] Add tests for token generation, node-id dedupe, group disposal, q-ref persistence, and reset.
- [x] Ensure no production API depends on test-only helpers.

**Acceptance Criteria:**
- `RefRegistry.registerEntry()` returns stable `e<N>` for repeated snapshots of the same SemanticsNode.
- `RefRegistry.registerQuery()` returns unique `q<N>` handles.
- Disposing an old snapshot group does not invalidate entries refreshed by a newer group.

---

## Task 2: Implement Semantics Snapshot Extension

**Goal:** Add `ext.fliwright.snap`, returning a compact, agent-readable Semantics snapshot with refs.

**Files:**
- Create: `packages/fliwright-bridge/lib/src/extensions/snap.dart`
- Create: `packages/fliwright-bridge/test/snap_test.dart`
- Modify: `packages/fliwright-bridge/lib/src/bridge.dart`
- Modify: `packages/fliwright-core/src/Page.ts`
- Modify: `packages/fliwright-core/src/types.ts`

**Protocol Draft:**

```json
{
  "snapshot": "- button \"提交\" [ref=e4]\n- textbox \"手机号\" [ref=e5]\n",
  "groupId": "snapshot-1780000000000",
  "refs": [
    {
      "ref": "e4",
      "role": "button",
      "label": "提交",
      "rect": { "x": 16, "y": 520, "width": 343, "height": 48 },
      "enabled": true,
      "textField": false
    }
  ]
}
```

**Implementation Notes:**
- Walk Semantics tree first; fall back to Element tree where Semantics is sparse.
- Return both YAML-like text and structured `refs`.
- Support options: `depth`, `includeRects`, `includeProperties`, `includeEnrichers`.
- Keep payload compact by default.
- Keep this extension independent from `ext.fliwright.extractForm`. Snapshot is for agent observation and ref actions; FormHelper continues to use its existing extraction logic.

**Steps:**
- [x] Build candidate refs from on-stage Element/RenderObject metadata.
- [x] Walk the on-stage widget tree and reuse extracted semantics/widget metadata.
- [x] Map Semantics/widget flags to roles: button, textbox, checkbox, link, heading, text.
- [x] Register interactive nodes in `RefRegistry`.
- [x] Add `Page.snapshot(options?)` in TS.
- [x] Add unit/widget tests for buttons, rect omission, empty tree registration, and ref action.

**Acceptance Criteria:**
- A running Flutter screen can be snapshotted without a test harness.
- Snapshot output includes refs for actionable widgets.
- Existing `ext.fliwright.snapshot` remains available for self-healing and failure collection.
- Existing form E2E tests still pass without changing FormHelper selectors or generated field metadata.

---

## Task 3: Add Actionability Gate

**Goal:** Make every gesture/text action verify that the target can actually receive the action before dispatching events.

**Files:**
- Create: `packages/fliwright-bridge/lib/src/actionability_gate.dart`
- Create: `packages/fliwright-bridge/test/actionability_gate_test.dart`
- Modify: `packages/fliwright-bridge/lib/src/extensions/gesture.dart`
- Modify: `packages/fliwright-bridge/lib/src/extensions/type_extension.dart`
- Modify: `packages/fliwright-bridge/lib/src/extensions/inspect.dart`

**Gate Order:**
1. Defunct: target Element/RenderObject is still mounted.
2. Enabled: Semantics does not mark the node disabled.
3. Non-zero rect: width and height are positive.
4. Viewport: target overlaps viewport; try `showOnScreen()` first.
5. Stable: rect drift stays under threshold across two frames.
6. Receives events: hit-test path includes the target or descendant.

**Steps:**
- [x] Implement typed `ActionabilityException` with stable reason strings.
- [x] Add `ensureActionable(entry, ref, options)` for `e<N>` refs.
- [x] Add q-ref resolution path before the gate.
- [x] Route ref-backed `tap`, `drag`, `type`, and `fill` through the gate.
- [x] Preserve the current FormHelper fast path: `fillWithResolved()` keeps accepting pre-resolved `WidgetInfo` and is not forced through a less precise ref lookup.
- [x] Include gate diagnostics in RPC responses.

**Acceptance Criteria:**
- Tapping a hidden, disabled, zero-size, animated, off-screen, or obscured widget fails with a specific reason.
- Off-screen widgets inside scrollables are auto-scrolled before action.
- Existing selector actions still work, but internally resolve to a target entry and pass through the gate.
- FormHelper can still fill fields discovered by `extractForm` with the same or better precision than before.

---

## Task 4: Support Ref Targets in Core SDK

**Goal:** Let SDK users and MCP tools act by `ref`, while preserving existing selectors.

**Files:**
- Modify: `packages/fliwright-core/src/Page.ts`
- Modify: `packages/fliwright-core/src/Locator.ts`
- Modify: `packages/fliwright-core/src/types.ts`
- Modify: `packages/fliwright-core/tests/Page.test.ts`
- Modify: `packages/fliwright-core/tests/Locator.test.ts`

**API Draft:**

```typescript
const snap = await page.snapshot();
await page.ref('e4').click();
await page.findRef({ text: '提交' }).click();
```

**Steps:**
- [x] Add `RefTarget` type.
- [x] Add `Page.ref(ref: string): Locator`.
- [x] Add `Page.findRef(query): Promise<Locator>` using current `Page.snapshot()` refs.
- [x] Update `Locator` to serialize either selector input or ref target.
- [x] Add tests for ref locator actions and backwards-compatible selector locators.

**Acceptance Criteria:**
- `page.ref('e1').click()` calls bridge action by ref.
- Existing `page.getByText('提交').click()` behavior is unchanged.

---

## Task 5: Add MCP Snapshot, Find, Observe, and Ref Actions

**Goal:** Make MCP interactions agent-first: inspect, choose ref, act, verify.

**Files:**
- Create: `packages/fliwright-mcp/src/tools/snap.ts`
- Create: `packages/fliwright-mcp/src/tools/find.ts`
- Create: `packages/fliwright-mcp/src/tools/observe.ts`
- Modify: `packages/fliwright-mcp/src/tools/tap.ts`
- Modify: `packages/fliwright-mcp/src/tools/type.ts`
- Modify: `packages/fliwright-mcp/src/tools/drag.ts`
- Modify: `packages/fliwright-mcp/src/tools/wait.ts`
- Modify: `packages/fliwright-mcp/src/server.ts`
- Create/Modify tests under `packages/fliwright-mcp/tests/`

**Tool Drafts:**
- `fliwright_snap({ depth?, includeRects?, includeProperties? })`
- `fliwright_find({ text?, containsText?, key?, semanticsLabel?, role? })`
- `fliwright_observe({ intent?, roles?, limit?, includeDiagnostics? })`
- `fliwright_tap({ ref? , key?, text?, type? })`
- `fliwright_type({ ref?, key?, text?, type?, value, replace? })`
- `fliwright_wait({ ref?, text?, key?, type?, timeout? })`

**Steps:**
- [x] Register new tools.
- [x] Route MCP handlers through CLI interaction capability functions.
- [x] Validate MCP handler parameters with zod schemas, including object-level `ref/key/text/type` and action-specific requirements.
- [x] Make ref the preferred parameter in action tools.
- [x] Preserve existing key/text/type fallbacks.
- [x] Return post-action snapshot optionally via `includeSnapshot`.
- [x] Add unit tests with mocked driver/page.

**Acceptance Criteria:**
- An MCP agent can run: connect -> snap -> tap by ref -> snap.
- Existing MCP text/key/type interaction tools remain compatible.

---

## Task 6: Add Observe Candidate Pipeline

**Goal:** Return concise actionable candidates instead of forcing the agent to parse a full tree every time.

**Files:**
- Create: `packages/fliwright-core/src/Observe.ts`
- Create: `packages/fliwright-core/tests/Observe.test.ts`
- Create: `packages/fliwright-bridge/lib/src/extensions/observe.dart`
- Create: `packages/fliwright-bridge/test/observe_test.dart`
- Modify: `packages/fliwright-bridge/lib/src/bridge.dart`

**Candidate Shape:**

```typescript
interface ObserveCandidate {
  ref: string;
  role: 'button' | 'textbox' | 'checkbox' | 'link' | 'heading' | 'image' | 'text';
  label?: string;
  value?: string;
  selector?: string;
  rect?: { x: number; y: number; width: number; height: number };
  enabled?: boolean;
  diagnostics?: Record<string, unknown>;
}
```

**Steps:**
- [x] Build candidates from current snapshot refs in MCP `fliwright_observe`.
- [x] Filter by role and limit.
- [x] Include selector suggestions already present in snapshot refs.
- [ ] Optionally enrich form fields with semantic type from `FormHelper`.
- [ ] Optionally include route and mock diagnostics when available.
- [x] Treat FormHelper enrichment as read-only metadata. Do not route FormHelper discovery through observe candidates.

**Acceptance Criteria:**
- `fliwright_observe({ roles: 'button,textbox' })` returns a small ordered candidate list.
- Candidates include refs suitable for immediate `fliwright_tap` or `fliwright_type`.
- Form field candidates can include semantic hints, but FormHelper remains the source of truth for actual form fill workflows.

---

## Task 6.5: FormHelper Regression Guardrail

**Goal:** Protect the current precise Flutter form element discovery while adding the new agent observation layer.

**Files:**
- Modify: `packages/fliwright-core/tests/FormHelper.test.ts`
- Modify: `packages/fliwright-core/tests/form-helper-comprehensive.test.ts`
- Modify: `packages/fliwright-core/tests/form-helper-integration.test.ts`
- Modify: `packages/fliwright-bridge/test/form_extract_test.dart`
- Modify: `e2e/form-fill-e2e.test.ts`
- Modify: `e2e/form-mock-e2e.test.ts`

**Steps:**
- [x] Add regression assertions for current form field count, semantic type, selector, key, hint, label, and control type.
- [x] Add a fixture with similar labels such as `邮箱地址` and `地址` to prevent substring collision regressions.
- [x] Verify `fillWithResolved()` still targets the exact field returned by `extractForm`.
- [x] Verify password/obscure field skip behavior remains unchanged.
- [x] Verify `fillFields(['手机号', '验证码'])` fills only requested fields.
- [x] Run FormHelper tests before and after every ref/actionability change touching locator or bridge action paths.

**Acceptance Criteria:**
- No FormHelper API changes are required for existing users.
- No generated selector becomes less specific than before.
- Form fill E2E behavior remains unchanged except for explicitly improved diagnostics.

---

## Task 7: Hot Reload + Verify Round Trip

**Goal:** Give coding agents a single command to validate UI changes after editing code.

**Files:**
- Create: `packages/fliwright-mcp/src/tools/hotReloadAndSnap.ts`
- Modify: `packages/fliwright-mcp/src/server.ts`
- Optional create: `packages/fliwright-cli/src/commands/hotReloadAndSnap.ts`

**Response Draft:**

```json
{
  "reloaded": true,
  "durationMs": 180,
  "snapshot": "...",
  "screenshot": "<base64 png>",
  "exceptions": []
}
```

**Implementation Notes:**
- This may need to call VM Service `reloadSources` from the tool side, not inside the Flutter isolate.
- If screenshot fails, still return snapshot and exception diagnostics.
- If reload fails, return compile error and recent exceptions.

**Steps:**
- [x] Add VM Service reload helper in core or MCP.
- [x] Chain reload -> snap -> screenshot -> exceptions.
- [x] Add tests around success, reload failure, screenshot failure.

**Acceptance Criteria:**
- Agent can edit code, call one MCP tool, and receive reload status plus visual/semantic verification data.

---

## Task 8: Expand Playwright-Style Action Surface

**Goal:** Fill common interaction gaps after the ref/actionability foundation is stable.

**Files:**
- Modify bridge extensions as needed.
- Modify `packages/fliwright-core/src/Locator.ts`
- Modify `packages/fliwright-mcp/src/server.ts`
- Add tests in relevant packages.

**Actions:**
- [x] `hover`
- [x] `doubleClick`
- [x] `rightClick`
- [x] `tripleClick`
- [x] `focus`
- [x] `blur`
- [x] `clear`
- [x] `pressKey`
- [x] `setCheckbox`
- [x] `selectOption`
- [x] `dismissModal`
- [x] `waitForNetworkIdle`
- [x] `console` and `exceptions` diagnostics via buffered VM Service diagnostic events

**Acceptance Criteria:**
- Each action is available through SDK and MCP.
- Each action has a bridge-level unit/widget test and MCP schema test.

---

## Task 9: Install, Doctor, and Debug-Only Hardening

**Goal:** Make setup safer and easier for real projects.

**Files:**
- Modify/create CLI package commands.
- Modify `packages/fliwright-bridge/lib/src/bridge.dart`
- Create docs under `docs/superpowers/specs/` if behavior needs a design doc.

**Steps:**
- [x] Add `fliwright doctor` checks: VM Service reachable, bridge installed, core extensions available, mock server status, Riverpod observer status.
- [x] Add installer guidance or command to patch `main.dart` with debug-only bridge setup.
- [x] Add runtime warning when bridge is initialized outside debug mode.
- [x] Add hot restart safe registration behavior for extensions.
- [x] Add CLI interaction/form capability modules as the shared ownership boundary for MCP and VS Code adapters.

**Acceptance Criteria:**
- New project setup failures are diagnosed before test execution.
- Release builds can tree-shake bridge setup when guarded by `kDebugMode`.

---

## Task 10: Documentation and Feature Index Refresh

**Goal:** Make the new agent loop discoverable and maintainable.

**Files:**
- Modify: `docs/features/`
- Create: `docs/superpowers/specs/2026-06-06-e2e-agent-optimization-design.md`
- Optional create: `llms.txt`
- Optional create: `.agents/skills/fliwright-e2e-agent/SKILL.md`

**Steps:**
- [x] Document the ref grammar: `e<N>` snapshot refs and `q<N>` query refs.
- [x] Document actionability reason strings.
- [x] Add MCP tool quick reference.
- [x] Add typical agent workflow: connect -> snap -> observe -> act -> verify.
- [x] Refresh affected `docs/features/` files after code lands.

**Acceptance Criteria:**
- A new agent can understand the tool workflow from docs alone.
- Feature docs map every new public API and MCP tool.

---

## Implementation Order

1. Ref registry.
2. Snapshot extension.
3. Actionability gate.
4. Core SDK ref target support.
5. MCP snap/find/observe/ref action tools.
6. Observe enrichments.
7. Hot reload + snap.
8. Additional actions.
9. Install/doctor hardening.
10. Docs refresh.

---

## Non-Goals

- Do not replace Vitest integration. The live-agent loop complements authored tests.
- Do not remove selector-based APIs. Existing tests must keep working.
- Do not replace FormHelper's existing element discovery with Semantics snapshot refs. Ref-based observation is an additional agent-facing layer, not the form automation source of truth.
- Do not copy Dusk's all-Dart CLI architecture wholesale. Fliwright remains a mixed TypeScript/Dart workspace with TS-first SDK and MCP.
- Do not delay P0 on CDP/device emulation. Responsive web emulation is useful but secondary.

---

## Success Metrics

- MCP agent can complete a basic flow without user-provided selectors: connect -> snap -> observe -> tap/type by ref -> verify.
- Action failures produce structured, actionable reasons rather than generic tap/type errors.
- Existing E2E examples still pass.
- New bridge tests cover hidden/disabled/offscreen/obscured/animated action targets.
- Feature docs include all new APIs and tools.
