# Unified Mock Rules — Reactive VSCode Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the VSCode mock-rules layer a purely reactive view+controller of the single Dart `MockRuleStore`, removing the competing local state and reconcile logic that fights the test harness.

**Architecture:** The Dart `MockRuleStore` (+ Hive) is the single source of truth; `MockManager` (`driver.mock`) is the single TS API. `SandboxService` loses its `applied` map, `reconcileFromFlutter`, and stale/unmatched classification, gaining one store-backed read (`getActiveRules`). VSCode connect/reload becomes read-only (refresh tree from `listFlutterRoutes`); apply/stop/clear/default remain explicit user actions. `MockRuleSelectionStore` and the suppression-state machinery (which existed only to serve reconcile) are deleted.

**Tech Stack:** TypeScript, VSCode Extension API, Vitest. Package: `@fliwright/vscode` (depends on `@fliwright/core`).

## Global Constraints

- All store mutations go through `driver.mock` (`MockManager`): `routeFlutter`, `removeFlutterRoute`, `clearFlutterRoutes`. The only store read is `listFlutterRoutes`.
- VSCode must never mutate the store on connect/reload — only read + reflect.
- Hive persistence stays as-is (persist everything; supports boot-time mock scenarios).
- `assertFlutterMockReady` stays as the apply-time guard (register ≠ intercept).
- Each task leaves the repo compiling and the unit suite green.
- Typecheck command: `pnpm --filter @fliwright/vscode lint` (= `tsc --noEmit`).
- Unit test command: `pnpm --filter @fliwright/vscode test` (= `vitest run`).
- Conventional-commit messages, matching repo style (e.g. `refactor(vscode): ...`).

## File Structure

- **Modify** `packages/fliwright-vscode/src/sandbox/SandboxService.ts` — gut to reactive; add `getActiveRules`.
- **Modify** `packages/fliwright-vscode/src/extension.ts` — reactive connect path, reactive commands, remove selection-store + suppression wiring.
- **Delete** `packages/fliwright-vscode/src/sandbox/MockRuleSelectionStore.ts` — no longer used (purely reactive = no auto-restore).
- **Rewrite** `packages/fliwright-vscode/tests/SandboxService.test.ts` — drop reconcile/ownership tests; assert via `getActiveRules`.
- No change to `packages/fliwright-core` (`MockManager` is already the unified API), `MockApiTreeProvider.ts` (keeps its `setAppliedRules` seam; just fed from the store), or the Dart side.

## Interfaces

- **Consumes (from core):** `driver.mock.listFlutterRoutes(): Promise<Array<{ id: string; method?: string; path: string }>>` — already exists on `MockManager` (`MockManager.ts:128`). `driver.mock.routeFlutter`, `removeFlutterRoute`, `clearFlutterRoutes` — already exist.
- **Produces:** `SandboxService.getActiveRules(driver): Promise<AppliedMockRule[]>` — reads the store and maps each route to an `AppliedMockRule`. Foreign routes (no `fliwright-vscode:` id) map to `ruleName: '(external)'`.

---

### Task 1: Add store-backed `getActiveRules` to SandboxService

**Files:**
- Modify: `packages/fliwright-vscode/src/sandbox/SandboxService.ts` (add method + helper near `appliedKey` at `:346`)
- Test: `packages/fliwright-vscode/tests/SandboxService.test.ts` (add a case)

**Interfaces:**
- Produces: `SandboxService.getActiveRules(driver: FliwrightDriver): Promise<AppliedMockRule[]>` — for every route returned by `driver.mock.listFlutterRoutes()`, returns `{ endpoint, method, ruleName, filePath: '', appliedAt: 0 }`. `ruleName` comes from the `fliwright-vscode:` route id when present, else `'(external)'`.

- [ ] **Step 1: Write the failing test**

Append to the `describe('SandboxService', ...)` block in `tests/SandboxService.test.ts`:

```ts
  it('reads active rules from the Flutter store, marking foreign routes as external', async () => {
    const service = new SandboxService();
    const listFlutterRoutes = vi.fn().mockResolvedValue([
      { id: 'fliwright-vscode:GET:%2Fv1%2Ftoken:success', method: 'GET', path: '/v1/token' },
      { id: 'test-script-route', method: 'POST', path: '/v1/profile' },
    ]);

    const active = await service.getActiveRules({ mock: { listFlutterRoutes } } as any);

    expect(listFlutterRoutes).toHaveBeenCalledOnce();
    expect(active).toMatchObject([
      { endpoint: '/v1/token', method: 'GET', ruleName: 'success' },
      { endpoint: '/v1/profile', method: 'POST', ruleName: '(external)' },
    ]);
  });

  it('getActiveRules skips routes with no resolvable method', async () => {
    const service = new SandboxService();
    const listFlutterRoutes = vi.fn().mockResolvedValue([
      { id: 'no-method', path: '/v1/whatever' },
    ]);

    const active = await service.getActiveRules({ mock: { listFlutterRoutes } } as any);

    expect(active).toEqual([]);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @fliwright/vscode test`
Expected: FAIL — `service.getActiveRules is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add this method inside `class SandboxService` in `src/sandbox/SandboxService.ts` (e.g. right after `applyRule`, before `syncFromFlutter`):

```ts
  /**
   * Read the current active mock rules straight from the Flutter store.
   * Unified/reactive: VSCode reflects store truth rather than tracking a
   * local "applied" set. Foreign routes (no fliwright-vscode: id) are surfaced
   * with ruleName '(external)' so the tree still shows their endpoint as active.
   */
  async getActiveRules(driver: FliwrightDriver): Promise<AppliedMockRule[]> {
    const routes = await mockRuleController.listFlutterRoutes(driver.mock);
    const active: AppliedMockRule[] = [];
    for (const route of routes) {
      const parsed = parseRouteId(route.id);
      const method = (parsed?.method ?? route.method)?.toUpperCase();
      if (!method) continue;
      active.push({
        endpoint: parsed?.endpoint ?? route.path,
        method,
        ruleName: parsed?.ruleName ?? '(external)',
        filePath: '',
        appliedAt: 0,
      });
    }
    return active;
  }
```

Add the helper next to `appliedKey` (`:346`) — note `parseRouteId` already exists locally at `:396`:

```ts
// (parseRouteId is already defined at the bottom of this file; reuse it.)
```

(No new helper is actually required — `parseRouteId`, `mockRuleController`, `AppliedMockRule`, and `FliwrightDriver` are all already imported.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @fliwright/vscode test`
Expected: PASS — both new cases green; all existing cases still green.

- [ ] **Step 5: Commit**

```bash
git add packages/fliwright-vscode/src/sandbox/SandboxService.ts packages/fliwright-vscode/tests/SandboxService.test.ts
git commit -m "feat(vscode): add store-backed getActiveRules to SandboxService"
```

---

### Task 2: Make the connect/reload path reactive

**Files:**
- Modify: `packages/fliwright-vscode/src/extension.ts:201-252` (`requestMockStateSync`), `:1180-1190` (`configureMocksAfterConnect`), `:1192-1298` (`synchronizeMockStateAfterConnect` — delete), `:378-394` (`reloadMocks` caller)

**Interfaces:**
- Consumes: `SandboxService.getActiveRules` (Task 1).
- Produces: `requestMockStateSync(reason: string): Promise<void>` — new signature, no options. Read-only: refresh tree, wait for extension readiness, read active rules, reflect in tree. Never apply/prune/clear.

- [ ] **Step 1: Replace `requestMockStateSync` (`extension.ts:201-252`)**

Replace the entire function body (keep the `mockSyncInFlight`/`mockSyncQueued` closure vars it uses) with this read-only version:

```ts
  const requestMockStateSync = async (reason: string): Promise<void> => {
    if (mockSyncInFlight) {
      mockSyncQueued = true;
      output.appendLine(`Mock state refresh queued (${reason}); another refresh is running.`);
      await mockSyncInFlight;
      return;
    }

    mockSyncInFlight = (async () => {
      do {
        mockSyncQueued = false;
        if (!isActiveSessionState(session.state.status)) {
          output.appendLine(
            `Mock state refresh skipped (${reason}): VM Service is not connected `
            + `(status=${session.state.status}).`,
          );
          mockTree.setAppliedRules([]);
          return;
        }

        if (!mockTree.currentResult) {
          output.appendLine(`Mock state refresh (${reason}): loading workspace mock configs.`);
          await mockTree.refresh();
        }
        const discovery = mockTree.currentResult;
        if (!discovery) {
          output.appendLine(`Mock state refresh skipped (${reason}): no workspace mock discovery result.`);
          return;
        }

        try {
          await waitForFlutterMockExtension(session.connectedDriver, reason);
        } catch (error) {
          output.appendLine(
            `Mock state refresh skipped (${reason}): `
            + `${error instanceof Error ? error.message : String(error)}`,
          );
          return;
        }

        // Purely reactive: read the unified store and reflect it. Never apply,
        // prune, or clear on connect — the store owns the truth.
        const activeRules = await sandboxService.getActiveRules(session.connectedDriver);
        output.appendLine(
          `[MockStateSync] reactive read (${reason}): ${activeRules.length} active route(s) in store.`,
        );
        mockTree.setAppliedRules(activeRules);
      } while (mockSyncQueued);
    })().finally(() => {
      mockSyncInFlight = undefined;
    });

    await mockSyncInFlight;
  };
```

- [ ] **Step 2: Delete `synchronizeMockStateAfterConnect` (`extension.ts:1192-1298`)**

Delete the entire function. Its only caller was the line `await synchronizeMockStateAfterConnect(discovery, options);` removed in Step 1.

- [ ] **Step 3: Simplify `configureMocksAfterConnect` (`extension.ts:1180-1190`)**

Replace with:

```ts
  async function configureMocksAfterConnect(): Promise<void> {
    if (!mockTree.currentResult) await mockTree.refresh();
    await requestMockStateSync('VM Service connected');
  }
```

If `loadConfig` (previously used here for `autoStartMockController`) becomes unused after this change, remove its import too. Check with: `grep -n "loadConfig" src/extension.ts`. If only the import line remains, delete that import.

- [ ] **Step 4: Fix the `reloadMocks` caller (`extension.ts:378-394`)**

Find the `requestMockStateSync('mock configs reloaded', { restoreSelections: true })` call inside `reloadMocks` and change it to the new signature:

```ts
        await requestMockStateSync('mock configs reloaded');
```

(Leave the surrounding `await mockTree.refresh();` etc. as-is.)

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @fliwright/vscode lint`
Expected: PASS with no errors. If `synchronizeMockStateAfterConnect`/`MockDiscoveryResult`/`options` show as unused, remove the now-dead references (e.g. the `MockDiscoveryResult` import if no longer used — re-run the grep to confirm before deleting).

- [ ] **Step 6: Run unit tests**

Run: `pnpm --filter @fliwright/vscode test`
Expected: PASS (no unit tests cover `extension.ts` orchestration directly; the `SandboxService` suite must remain green).

- [ ] **Step 7: Commit**

```bash
git add packages/fliwright-vscode/src/extension.ts
git commit -m "refactor(vscode): make mock connect/reload path purely reactive"
```

---

### Task 3: Make command handlers reactive; retire resetController call sites

**Files:**
- Modify: `packages/fliwright-vscode/src/extension.ts:494-606` (apply/stop/applyDefault/stopSandbox commands) and the `sandboxService.resetController()` call sites at `:192, :220, :418, :1085, :1099, :1118, :1142`

**Interfaces:**
- Consumes: `SandboxService.getActiveRules`.

- [ ] **Step 1: Strip selection-store + suppression from `applyMockRule` (`:494-507`)**

Replace with:

```ts
    vscode.commands.registerCommand('fliwright.applyMockRule', async (node?: MockRuleEntry) => {
      await runCommand('Apply Mock Rule', async () => {
        if (!node || node.kind !== 'rule') throw new Error('Select a mock rule to apply.');
        output.appendLine(`Applying mock ${formatMockRuleDebug(node)}`);
        const applied = await sandboxService.applyRule(session.connectedDriver, node);
        mockTree.setAppliedRules(await sandboxService.getActiveRules(session.connectedDriver));
        output.appendLine(`Applied mock ${applied.method} ${applied.endpoint} -> ${applied.ruleName}`);
        await appendMockControllerDebug('Flutter mock routes after apply:');
        vscode.window.showInformationMessage(`Applied ${applied.method} ${applied.endpoint} -> ${applied.ruleName}`);
      });
    }),
```

- [ ] **Step 2: Strip selection-store + suppression from `stopMockRule` (`:508-525`)**

Replace with:

```ts
    vscode.commands.registerCommand('fliwright.stopMockRule', async (node?: MockRuleEntry) => {
      await runCommand('Stop Mock Rule', async () => {
        if (!node || node.kind !== 'rule') throw new Error('Select an active mock rule to stop.');
        const stopped = await sandboxService.stopRule(session.connectedDriver, node);
        mockTree.setAppliedRules(await sandboxService.getActiveRules(session.connectedDriver));
        if (!stopped) {
          output.appendLine(`Skipped stopping inactive mock ${formatMockRuleDebug(node)}`);
          await appendMockControllerDebug('Flutter mock routes remain:');
          vscode.window.showWarningMessage(`Mock rule is not active: ${node.method} ${node.endpoint} -> ${node.rule.name}`);
          return;
        }
        output.appendLine(`Stopped mock ${node.method} ${node.endpoint} -> ${node.rule.name}`);
        await appendMockControllerDebug('Flutter mock routes after stop:');
        vscode.window.showInformationMessage(`Stopped ${node.method} ${node.endpoint} -> ${node.rule.name}`);
      });
    }),
```

- [ ] **Step 3: Strip selection-store + suppression from `applyDefaultMocks` (`:526-558`)**

Replace with:

```ts
    vscode.commands.registerCommand('fliwright.applyDefaultMocks', async () => {
      await runCommand('Apply Default Mocks', async () => {
        if (!mockTree.currentResult) await mockTree.refresh();
        const discovery = mockTree.currentResult;
        if (!discovery) throw new Error('Open a workspace to use Fliwright.');
        for (const endpoint of discovery.endpoints) {
          const rule = endpoint.defaultRule
            ? endpoint.endpointFile.rules.find((candidate) => candidate.name === endpoint.defaultRule) ?? endpoint.endpointFile.rules[0]
            : endpoint.endpointFile.rules[0];
          if (rule) {
            output.appendLine(`Applying default mock ${formatMockRuleDebug({
              kind: 'rule',
              uri: endpoint.uri,
              endpoint: endpoint.endpointFile.endpoint,
              method: endpoint.endpointFile.method,
              rule,
              isDefault: true,
            })}`);
          }
        }
        const result = await sandboxService.applyDefaultMocks(session.connectedDriver, discovery);
        mockTree.setAppliedRules(await sandboxService.getActiveRules(session.connectedDriver));
        output.appendLine(`Applied ${result.applied.length} default mock route(s), skipped ${result.skipped}.`);
        await appendMockControllerDebug('Flutter mock routes after apply-default:');
        vscode.window.showInformationMessage(`Applied ${result.applied.length} default mock route(s).`);
      });
    }),
```

- [ ] **Step 4: Strip selection-store + suppression from `stopSandbox` (`:559-566`)**

Replace just the first six lines of the command body (up to and including `mockTree.setAppliedRules([]);`) with:

```ts
    vscode.commands.registerCommand('fliwright.stopSandbox', async () => {
      await runCommand('Stop All Mock Routes', async () => {
        const driver = session.connectedDriver;
        await sandboxService.clear(driver);
        mockTree.setAppliedRules(await sandboxService.getActiveRules(driver));
```

Leave the hard-clear verification block that follows (`:568+`, the `remainingRoutes` / `readFlutterMockDebugState` retry logic) **unchanged** — it is the user-facing guarantee that Stop All leaves nothing mocking.

- [ ] **Step 5: Replace every `sandboxService.resetController()` call site**

There are call sites at lines `192`, `220`, `418`, `1085`, `1099`, `1118`, `1142`. Replace each occurrence of:

```ts
sandboxService.resetController();
```

with:

```ts
mockTree.setAppliedRules([]);
```

Find them all with `grep -n "sandboxService.resetController()" src/extension.ts` and confirm zero remain after editing.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @fliwright/vscode lint`
Expected: PASS. After this task `mockSelectionStore`, the suppression helpers, and `SandboxService.resetController`/`getAppliedRules` may now be unused in places — that is fine; Task 4/5 remove them. The typecheck must still pass (no unused-local errors are emitted by this tsconfig for module-level helpers, but verify).

- [ ] **Step 7: Run unit tests**

Run: `pnpm --filter @fliwright/vscode test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/fliwright-vscode/src/extension.ts
git commit -m "refactor(vscode): drive mock commands off the unified store"
```

---

### Task 4: Delete MockRuleSelectionStore and suppression-state machinery

**Files:**
- Delete: `packages/fliwright-vscode/src/sandbox/MockRuleSelectionStore.ts`
- Modify: `packages/fliwright-vscode/src/extension.ts` — remove import `:25`, instantiation `:68`, keys `:54-55`, and helper functions `:1536-1620`
- Delete: `packages/fliwright-vscode/tests/MockRuleSelectionStore.test.ts` (it tests the deleted module)

**Interfaces:** None (pure removal).

- [ ] **Step 1: Remove the selection-store import and instantiation**

In `extension.ts`:
- Delete the line `import { MockRuleSelectionStore } from './sandbox/MockRuleSelectionStore.js';` (`:25`).
- Delete the line `const mockSelectionStore = new MockRuleSelectionStore(context.workspaceState);` (`:68`).

- [ ] **Step 2: Remove the suppression state keys and helpers**

In `extension.ts`:
- Delete the two constants `MOCK_AUTO_DEFAULTS_SUPPRESSED_KEY` (`:54`) and `MOCK_SUPPRESSED_ENDPOINTS_KEY` (`:55`).
- Delete the helper functions `isMockAutoDefaultsSuppressed`, `setMockAutoDefaultsSuppressed`, the suppressed-endpoints getter that reads `MOCK_SUPPRESSED_ENDPOINTS_KEY`, `suppressMockEndpoint`, `unsuppressMockEndpoint`, `clearSuppressedMockEndpoints`, and `suppressedMockEndpointsForDiscovery` (`:1536-1620` region — locate each by name and delete the whole function).

Confirm none are referenced: `grep -n "mockSelectionStore\|MOCK_AUTO_DEFAULTS_SUPPRESSED_KEY\|MOCK_SUPPRESSED_ENDPOINTS_KEY\|setMockAutoDefaultsSuppressed\|isMockAutoDefaultsSuppressed\|suppressMockEndpoint\|unsuppressMockEndpoint\|clearSuppressedMockEndpoints\|suppressedMockEndpointsForDiscovery" src/extension.ts` → expect zero hits.

- [ ] **Step 3: Delete the files**

```bash
git rm packages/fliwright-vscode/src/sandbox/MockRuleSelectionStore.ts
git rm packages/fliwright-vscode/tests/MockRuleSelectionStore.test.ts
```

- [ ] **Step 4: Typecheck and test**

Run: `pnpm --filter @fliwright/vscode lint && pnpm --filter @fliwright/vscode test`
Expected: PASS. (Removing the test file drops its cases from the suite; nothing else references the deleted module.)

- [ ] **Step 5: Commit**

```bash
git add packages/fliwright-vscode/src/extension.ts
git commit -m "refactor(vscode): drop mock selection store and suppression state"
```

---

### Task 5: Gut SandboxService to a reactive client; rewrite its tests

**Files:**
- Modify: `packages/fliwright-vscode/src/sandbox/SandboxService.ts` — remove `applied` map, `getAppliedRules`, `isApplied`, `reconcileFromFlutter`, `syncFromFlutter` (stale/unmatched classification), `singleRule`, controller stubs (`getControllerUrl`, `ensureController`, `resetController`)
- Rewrite: `packages/fliwright-vscode/tests/SandboxService.test.ts`

**Interfaces:**
- After this task `SandboxService` exposes only: `applyRule`, `stopRule`, `clear`, `applyDefaultMocks`, `getActiveRules` (all store-backed). No local "applied" state.

- [ ] **Step 1: Rewrite the unit tests first (TDD — define the target surface)**

Open `tests/SandboxService.test.ts`. The current file asserts reconcile/ownership behavior via `getAppliedRules()` / `isApplied()` / `reconcileFromFlutter()` / `syncFromFlutter()`, all of which this task removes. Rewrite as follows:

(a) **Delete** these `it(...)` blocks entirely (they test removed behavior): the cases at current lines `:38` (syncs active rules…), `:66` (treats ids without metadata as stale), `:83` (adopts ids without metadata for single-rule), `:108` (rebuilds stale cache), `:141` (fills missing endpoints), `:182` (does not activate defaults while reconciling), `:200` (does not auto-apply defaults for suppressed), `:221` (removes suppressed), `:251` (adopts VSCode-managed), `:275` (prunes foreign), `:301` (keeps VSCode-managed matching selection), `:323` (reconciles restored selection). Also delete the now-unused `httpReadySendRequest` helper if nothing references it after the rewrite.

(b) **Keep** the `getActiveRules` cases added in Task 1, and the `applyRule`/`stopRule`/`clear`/`applyDefaultMocks` cases — but convert their assertions off the removed `getAppliedRules()`/`isApplied()` and onto `getActiveRules()`. Pattern (apply now reflects in the store):

```ts
  it('applies a mock rule and reflects it via getActiveRules', async () => {
    const routeFlutter = vi.fn().mockResolvedValue(undefined);
    const listFlutterRoutes = vi.fn().mockResolvedValue([
      { id: 'fliwright-vscode:GET:%2Fv1%2Ftoken:success', method: 'GET', path: '/v1/token' },
    ]);
    const sendRequest = vi.fn().mockImplementation(async (method: string) => {
      if (method === 'ext.fliwright.mock.debugState') {
        return { mode: 'http', serverPort: 12345, routes: [{ method: 'GET', path: '/v1/token' }] };
      }
      return { routes: [{ method: 'GET', path: '/v1/token' }] };
    });
    const service = new SandboxService();
    const driver = { mock: { routeFlutter, listFlutterRoutes }, sendRequest } as any;
    const entry = mockRule('success');

    await service.applyRule(driver, entry);

    expect(routeFlutter).toHaveBeenCalledWith('/v1/token', expect.objectContaining({
      id: 'fliwright-vscode:GET:%2Fv1%2Ftoken:success',
    }));
    const active = await service.getActiveRules(driver);
    expect(active).toMatchObject([{ endpoint: '/v1/token', method: 'GET', ruleName: 'success' }]);
  });

  it('clear empties the store and getActiveRules reflects it', async () => {
    const listFlutterRoutes = vi.fn().mockResolvedValue([]);
    const clearFlutterRoutes = vi.fn().mockResolvedValue(undefined);
    const service = new SandboxService();
    await service.clear({ mock: { clearFlutterRoutes, listFlutterRoutes } } as any);
    expect(await service.getActiveRules({ mock: { listFlutterRoutes } } as any)).toEqual([]);
  });

  it('does not mark a Dio mock active when the interceptor is not injected', async () => {
    const routeFlutter = vi.fn().mockResolvedValue(undefined);
    const sendRequest = vi.fn().mockResolvedValue({
      mode: 'dio',
      interceptorInjected: false,
      routes: [{ method: 'GET', path: '/v1/token' }],
    });
    const service = new SandboxService();
    const entry = mockRule('success');

    await expect(service.applyRule({ mock: { routeFlutter }, sendRequest } as any, entry)).rejects.toThrow(
      'FliwrightDioMockInterceptor is not injected',
    );
    expect(routeFlutter).toHaveBeenCalledOnce();
  });
```

Apply the same conversion to the remaining `applyRule`/`stopRule` cases: after each action, assert state via `await service.getActiveRules(driver)` (mocking `listFlutterRoutes` to return what the store should now contain) instead of `service.getAppliedRules()` / `service.isApplied(...)`. Keep the `discovery()` and `mockRule()` helpers as-is.

(c) **Delete** the `reconcileFromFlutter`/`syncFromFlutter` imports or references if any remain — there should be none.

- [ ] **Step 2: Run tests to verify they fail against the current code**

Run: `pnpm --filter @fliwright/vscode test`
Expected: the rewritten cases PASS (the methods they use still exist), but this step mainly confirms the rewritten file compiles. (The real failure surface is removed-method references — there must be none.)

- [ ] **Step 3: Gut `SandboxService.ts`**

In `src/sandbox/SandboxService.ts`:
- Delete the `private readonly applied = new Map<...>();` field (`:11`).
- Delete methods `getAppliedRules` (`:13`), `isApplied` (`:17`), `getControllerUrl` (`:22`), `ensureController` (`:26`), `syncFromFlutter` (`:44`), `reconcileFromFlutter` (`:68`), `resetController` (`:307`).
- Delete module-level helpers that only served reconcile: `routeMethod`, `isSuppressedFlutterRoute`, `resolveFlutterRoute`, `singleRule`. Keep `appliedKey`, `parseRouteId`, `findFlutterRoute`, `assertFlutterMockReady`, and the debug-state helpers (still used by `applyRule`/`stopRule`/`getActiveRules`).
- Remove any imports now unused (e.g. `MockRuleEntry` if only used by deleted methods — re-grep before deleting).

The class retains: `applyRule`, `stopRule`, `clear`, `applyDefaultMocks`, `getActiveRules`.

- [ ] **Step 4: Typecheck and run tests**

Run: `pnpm --filter @fliwright/vscode lint && pnpm --filter @fliwright/vscode test`
Expected: PASS. All remaining cases are reactive (store-backed); no references to removed methods anywhere.

- [ ] **Step 5: Commit**

```bash
git add packages/fliwright-vscode/src/sandbox/SandboxService.ts packages/fliwright-vscode/tests/SandboxService.test.ts
git commit -m "refactor(vscode): gut SandboxService to a reactive store client"
```

---

### Task 6: Verify end-to-end

**Files:** none (verification only).

- [ ] **Step 1: Full typecheck + unit suite**

Run: `pnpm --filter @fliwright/vscode lint && pnpm --filter @fliwright/vscode test`
Expected: PASS, zero errors.

- [ ] **Step 2: Build**

Run: `pnpm --filter @fliwright/vscode build`
Expected: succeeds (`dist/extension.js` produced).

- [ ] **Step 3: Manual verification (run the extension against a Flutter app with the bridge)**

Launch the extension in an Extension Development Host against a Flutter app whose `main()` calls `FliwrightBridge.init(...)` (Dio mode) and connect VSCode to its VM Service. Confirm each, using the Fliwright output channel + the Mock APIs tree:

1. **Connect is read-only:** with a couple of routes already in the store (apply one, then disconnect/reconnect, or rely on Hive-rehydrated routes), reconnect does NOT add, remove, or clear anything — the tree shows exactly what the store holds (`ext.fliwright.mock.listRoutes` matches the tree's active markers).
2. **Apply reflects:** click a rule → tree marks it active; `listRoutes` shows the `fliwright-vscode:` route.
3. **Stop reflects:** stop a rule → tree clears it; `listRoutes` no longer shows it.
4. **Stop All clears the whole store:** including any foreign/test-injected route (inject one via a quick `driver.mock.route('/x', {...})` from a scratch test or the debug console if available) — Stop All removes it too.
5. **No auto-restore:** after Stop All, reconnect does NOT bring anything back into the tree (the selection store is gone; nothing re-applies). Hive may still hold routes on cold start of the *app* — that is expected and the tree shows them honestly.
6. **Foreign route visible:** a route without a `fliwright-vscode:` id shows its endpoint as active (count) without a specific rule node lit.
7. **Coexistence with tests:** while VSCode is connected, run a fliwright test that calls `mock.route(...)` — the route lands in the same store; the VSCode tree reflects it on next refresh; VSCode does not prune it.

Hand this checklist to the `verify` skill or run it manually; record results. If any step fails, file it as a follow-up (do not silently pass).

- [ ] **Step 4: Final commit (if any verification artifacts)**

If the manual check surfaces no code changes, no commit needed. Otherwise commit the fix with `fix(vscode): ...`.

---

## Self-Review

**Spec coverage:**
- "Dart side — no functional change" → no task touches Dart. ✓
- "`MockManager` is the unified API" → all store access via `driver.mock`. ✓
- "`SandboxService` gutted to reactive client" → Task 5; `getActiveRules` added in Task 1. ✓
- "VSCode purely reactive on connect" → Task 2 (`requestMockStateSync` read-only; `synchronizeMockStateAfterConnect` deleted). ✓
- "Delete `MockRuleSelectionStore`" → Task 4. ✓
- "Tree reads active state from store" → fed via `getActiveRules` in Tasks 2/3. ✓
- "Keep `assertFlutterMockReady` apply-time guard" → preserved (Task 5 keeps it; test retained). ✓
- "Persistence kept as-is" → no Hive/Dart change. ✓
- "Stop All clears whole store" → Task 3 Step 4 keeps clear + hard-clear verify. ✓
- "Rewrite `SandboxService.test.ts`" → Task 5. ✓
- "Migration: extension.ts reconcile orchestration removed" → Task 2. ✓

**Placeholder scan:** No TBD/TODO; every code step shows the actual code; commands are exact. The two areas that say "re-grep before deleting an import" are verification instructions, not placeholders.

**Type consistency:** `getActiveRules(driver): Promise<AppliedMockRule[]>` is the single new signature, used identically in Tasks 1/2/3/5. `requestMockStateSync(reason: string)` (no options) — callers in Task 2 (`configureMocksAfterConnect`, `reloadMocks`) use the new signature.

**Scope:** Single subsystem (VSCode mock layer). Six tasks, each independently testable. No decomposition needed.
