# VS Code Extension Mock/Form Implementation Plan

**Date:** 2026-06-01  
**Status:** Implemented  
**Scope:** `packages/fliwright-vscode` Mock API management and Form Helper workflows  
**Design docs:**
- `docs/superpowers/specs/2026-05-31-vscode-extension-design.md`
- `docs/superpowers/specs/2026-05-31-vscode-extension-ui-design.md`

---

## 1. Goal

Build the first useful VS Code extension slice for Fliwright:

1. Load the extension in a real Flutter project workspace.
2. Show `.fliwright/mocks/api/*.json` as a native `Mock APIs` Tree View.
3. Show `.fliwright/forms/*.json` as a native `Form Data` Tree View.
4. Connect to a running Flutter VM Service.
5. Apply and clear selected API mock rules through `driver.mock`.
6. Analyze and fill the current app screen through `FormHelper`.

The extension must stay a thin VS Code shell. Core protocol behavior remains owned by `@fliwright/core` and the Dart bridge.

---

## 2. Current Implementation Snapshot

### Completed

- Created `packages/fliwright-vscode`.
- Added VS Code extension manifest with:
  - `contributes.viewsContainers.activitybar`
  - `contributes.views`
  - `contributes.commands`
  - `contributes.menus.view/title`
  - `contributes.menus.view/item/context`
  - `contributes.configuration`
  - `activationEvents`
- Added Activity Bar container `Fliwright`.
- Added native Tree Views:
  - `fliwright.devices`
  - `fliwright.mockApis`
  - `fliwright.formData`
- Added local development launch config:
  - `packages/fliwright-vscode/.vscode/launch.json`
  - `packages/fliwright-vscode/.vscode/exio-fliwright.code-workspace`
  - `packages/fliwright-vscode/.vscode/tasks.json`
- Implemented Mock JSON discovery:
  - `src/sandbox/MockConfigService.ts`
  - `src/views/MockApiTreeProvider.ts`
- Implemented Form JSON discovery:
  - `src/form/FormRuleService.ts`
  - `src/views/FormDataTreeProvider.ts`
- Implemented commands:
  - `fliwright.reloadMocks`
  - `fliwright.createMockConfig`
  - `fliwright.openMockConfig`
  - `fliwright.copyMockEndpoint`
  - `fliwright.copyMockRuleJson`
  - `fliwright.reloadFormRules`
  - `fliwright.createFormRules`
  - `fliwright.openFormRules`
- Fixed Tree View refresh loop by separating first-load data reads from `onDidChangeTreeData` notifications.
- Verified:
  - `pnpm --filter @fliwright/vscode build`
  - `pnpm --filter @fliwright/vscode lint`

### Current Limitations

- Manual verification still requires a running Flutter app with the Fliwright bridge and VM Service URL.
- `dist/` is generated locally and ignored; extension development and packaging rely on build scripts.

---

## 3. Architecture Target

```text
VS Code Extension Host
├── extension.ts
├── session/
│   ├── FliwrightSession.ts
│   └── VmServiceDiscovery.ts
├── sandbox/
│   ├── MockConfigService.ts
│   └── SandboxService.ts
├── form/
│   ├── FormRuleService.ts
│   └── FormHelperService.ts
└── views/
    ├── DevicesTreeProvider.ts
    ├── MockApiTreeProvider.ts
    └── FormDataTreeProvider.ts
```

Core ownership:

- `@fliwright/core/FliwrightDriver`: VM connection and driver lifecycle.
- `driver.mock`: API route application and clearing.
- `FormHelper`: form extraction, generated values, and fill operations.

VS Code ownership:

- Workspace file discovery.
- Tree state.
- Commands and Quick Pick UX.
- OutputChannel logs.
- User confirmation before mutating the running app.

---

## 4. Work Plan

### VS-A: Local Asset Sidebar

**Status:** Completed

Files:

- `packages/fliwright-vscode/package.json`
- `packages/fliwright-vscode/src/extension.ts`
- `packages/fliwright-vscode/src/sandbox/MockConfigService.ts`
- `packages/fliwright-vscode/src/form/FormRuleService.ts`
- `packages/fliwright-vscode/src/views/MockApiTreeProvider.ts`
- `packages/fliwright-vscode/src/views/FormDataTreeProvider.ts`

Acceptance:

- Extension Host opens a real Flutter project workspace.
- `Mock APIs` lists endpoint files and response rules.
- `Form Data` lists form rule files and rule summaries.
- Invalid JSON/schema files remain visible with warning icons.

Verification:

```bash
pnpm --filter @fliwright/vscode build
pnpm --filter @fliwright/vscode lint
```

---

### VS-B: VM Service Session

**Status:** Completed

Goal: connect the extension to a running Flutter app.

Tasks:

- Add `src/session/FliwrightSession.ts`.
- Add `src/session/VmServiceDiscovery.ts`.
- Add settings:
  - `fliwright.vmServiceUrl`
  - `fliwright.autoDiscoverVmService`
- Implement commands:
  - `fliwright.connect`
  - `fliwright.disconnect`
  - `fliwright.discoverVmService`
- Update `DevicesTreeProvider` to show:
  - disconnected
  - connecting
  - connected
  - connection error
- Add bridge capability display once connected:
  - mock extension available
  - form extract available
  - screenshot/snapshot availability later

Implementation notes:

- Prefer `FliwrightDriver` from `@fliwright/core` for the actual connection.
- If the core driver does not expose capability checks cleanly, start with connection state only and log capability failures during command execution.
- VM URL priority:
  1. user input
  2. `fliwright.vmServiceUrl`
  3. `FLIWRIGHT_VM_URL`
  4. local discovery

Acceptance:

- User can connect to a VM Service URL from the command palette or Devices view.
- Devices view updates without reloading the extension.
- Disconnect disposes the driver and clears session state.

Verification:

```bash
pnpm --filter @fliwright/vscode build
pnpm --filter @fliwright/vscode lint
```

Manual:

1. Start Flutter app with Fliwright bridge.
2. Run `Fliwright: Connect to VM Service`.
3. Verify Devices view shows connected URL.

---

### VS-C: Apply And Clear Mock Rules

**Status:** Completed

Goal: turn visible Mock API rules into active runtime mocks.

Tasks:

- Add `src/sandbox/SandboxService.ts`.
- Register commands:
  - `fliwright.applyMockRule`
  - `fliwright.applyDefaultMocks`
  - `fliwright.stopSandbox`
- Add inline apply action for `mockRule` rows.
- Track applied rules in extension state:
  - endpoint
  - method
  - rule name
  - file path
  - applied timestamp
- Refresh `MockApiTreeProvider` after apply/clear.
- Show applied status:
  - checked icon for applied rule
  - active route count summary
- Log route application to OutputChannel without dumping large bodies by default.

Mapping:

```ts
await driver.mock.route(endpoint, {
  method,
  status: rule.status,
  delay: rule.delay,
  headers: rule.headers,
  body: rule.body,
});
```

Default mock behavior:

- If `mock-index.json` exists and has `defaultRule`, apply that rule for indexed files.
- Otherwise apply each endpoint file's first rule.
- Skip invalid files and show a warning summary.

Acceptance:

- User can apply one selected rule from `Mock APIs`.
- User can apply default mocks.
- User can clear all mock routes.
- Active state is visible in the tree.

Manual:

1. Open Exio workspace in Extension Host.
2. Connect to VM Service.
3. Apply `GET /v1/public/token -> success`.
4. Trigger app request.
5. Verify mocked response behavior.
6. Clear mocks and verify route list resets.

---

### VS-D: Form Analyze And Fill

**Status:** Completed

Goal: use visible form rule files to generate and apply current-screen form data.

Tasks:

- Add `src/form/FormHelperService.ts`.
- Register commands:
  - `fliwright.analyzeForm`
  - `fliwright.fillForm`
  - `fliwright.fillFormWithRules`
- Add context actions for `formRulesFile` rows:
  - Analyze Current Form With Rules
  - Fill Current Form With Rules
- Implement Quick Pick preview:
  - field label/hint
  - semantic type
  - generated value
  - skipped status
- Mask sensitive values in preview:
  - password
  - obscure fields
  - token-like values
- Respect settings:
  - `fliwright.formRulesFile`
  - `fliwright.formRulesDir`
  - `fliwright.formLocale`
  - `fliwright.formPreviewBeforeFill`
- Update `FormDataTreeProvider` with last analyze/fill summary.

Implementation notes:

- Use `FormHelper.analyze()` before `fill()` when preview is enabled.
- Use selected file as `rulesFile`; otherwise use configured `rulesDir`.
- Do not log generated values by default.
- Keep password/obscure fields skipped unless a setting is added later.

Acceptance:

- User can analyze current screen without mutating the app.
- User can fill selected fields after preview.
- User can run fill from a selected form rules file.
- OutputChannel shows filled/skipped/error counts.

Manual:

1. Navigate app to a screen containing supported text fields.
2. Run `Fliwright: Analyze Current Form`.
3. Verify preview values.
4. Confirm fill.
5. Verify app fields are populated.

---

### VS-E: Extension Tests

**Status:** Completed

Goal: add focused automated coverage for pure extension logic.

Tasks:

- Add Vitest config for `packages/fliwright-vscode`.
- Test `MockConfigService`:
  - valid endpoint file
  - invalid JSON
  - invalid schema
  - index default rule
  - template creation
- Test `FormRuleService`:
  - valid rules file
  - invalid type
  - missing regexp pattern
  - template creation
- Test tree provider first-load behavior:
  - no refresh loop
  - empty state
  - invalid row context values

Acceptance:

- `pnpm --filter @fliwright/vscode test` runs without requiring VS Code UI.
- Build and lint remain green.

---

### VS-F: Packaging Readiness

**Status:** Completed

Goal: make the extension usable outside Extension Development Host.

Tasks:

- Decide whether to commit generated `dist/` or package via build step.
- Add `vsce` packaging script or documented local install flow.
- Add extension icon polish.
- Add changelog.
- Add README screenshots after Mock/Form apply works.

Acceptance:

- Developer can install a local `.vsix`.
- Extension works in Exio workspace without debug host.

---

## 5. Risks And Decisions

| Topic | Decision |
|-------|----------|
| Mock config format | JSON only. YAML is intentionally unsupported. |
| First-class sidebar views | Use separate native Tree Views: `Mock APIs` and `Form Data`. |
| Webviews | Not used for Mock/Form MVP; Quick Pick and Tree Views are enough. |
| Generated values | Keep local, mask sensitive values, avoid logging values by default. |
| Runtime mutation | Applying mocks and filling forms requires explicit user action. |
| VM Service dependency | Apply/fill commands must fail clearly when disconnected. |

---

## 6. Current Verification Commands

```bash
pnpm --filter @fliwright/vscode build
pnpm --filter @fliwright/vscode lint
pnpm --filter @fliwright/vscode test
```

Expected current result: all pass.

---

## 7. Next Immediate Task

Run manual verification in an Extension Development Host against a Flutter app that includes the Fliwright bridge:

1. Start the Flutter app and note the VM Service URL.
2. Run `Fliwright: Connect to VM Service`.
3. Apply a selected mock rule and verify the app receives the mocked response.
4. Run `Fliwright: Analyze Current Form`.
5. Select previewed fields and run fill.
