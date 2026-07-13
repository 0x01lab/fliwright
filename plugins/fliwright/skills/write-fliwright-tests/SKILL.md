---
name: write-fliwright-tests
description: Create, update, review, or debug Fliwright TypeScript automation scripts and E2E tests for Flutter apps. Use for `@fliwright/vitest` `test` or `script` fixtures, timeline-aware `flow`/`mock`/`agent`/`logger` usage, locator selectors, gestures, form filling, assertions, HTTP mocks, Riverpod state setup, app capabilities, MCP-recorded code cleanup, CLI/MCP runs, run artifacts, or manual human-verification/captcha/WebView overlay handling. Covers Fliwright framework patterns only; project-specific routes, Keys, providers, mock endpoints, and captcha config belong in the target project context.
---

# Write Fliwright Automation & Tests

Use Fliwright as deterministic Flutter app automation through the Dart VM Service, not as browser automation. Prefer timeline-native scripts and tests so failures include `timeline.json`, structured logs, screenshots/snapshots, and agent-readable diagnostics.

## First Decision

- Use `test` from `@fliwright/vitest` for durable regression coverage, CI checks, and user-visible behavior verification. Put it in `.fliwright/tests/*.test.ts` and include meaningful assertions.
- Use `script` from `@fliwright/vitest` for one-off automation, data entry, account setup, operational tasks, and MCP-recorded script cleanup. Put it in `.fliwright/scripts/*.script.ts` or `.fliwright/scripts/*.mjs`; do not add assertions only to make it look like a test.
- Use bare `FliwrightDriver` only for custom plugin work, legacy bridge compatibility, or low-level coordinate/extension tests. Manage `connect()` and `dispose()` explicitly.

## File Placement

New timeline-native `test`/`script` files live under the project's `.fliwright/` directory, NOT the repo-root `tests/`. Confirm placement before creating a file — repo-root `tests/` is reserved for legacy bare-`FliwrightDriver` files, and mixing the two causes mis-categorized suites.

| Category | Fixture style | Directory | Extension |
| --- | --- | --- | --- |
| Regression / CI test | `test`/`expect` from `@fliwright/vitest` | `.fliwright/tests/` | `*.test.ts` |
| One-off automation / data entry | `script` from `@fliwright/vitest`, or `createFliwrightScript` | `.fliwright/scripts/` | `*.script.ts` / `*.mjs` |
| Legacy bare driver / coordinate / extension test | bare `FliwrightDriver` (`connect()`/`dispose()` manual) | repo-root `tests/` | `*.test.ts` / `*.mjs` |

HTTP mock rule JSON goes in `.fliwright/mocks/api/*.json` (see [references/mocks.md](references/mocks.md)).

Before writing a new file, `ls .fliwright/tests/` (or `scripts/`) to match the placement convention of nearby files; do not infer the directory from a git-status snapshot or unrelated legacy files.

## Work Pattern

1. Inspect nearby tests, app source, and UI identifiers before writing selectors. Search for Keys, visible labels, routes, providers, mock endpoints, and existing Fliwright helpers with `rg`.
2. Confirm the app exposes the needed bridge capabilities before deep exploration. Current flows should support `ext.fliwright.snap`, `ext.fliwright.action`, screenshots, and mock extensions. If `ext.fliwright.snap` is unknown, treat the app as legacy or upgrade/rebuild it before using snapshot/ref features.
3. Start new files with `import { test, expect } from '@fliwright/vitest'` or `import { script, expect } from '@fliwright/vitest'`. If the project has `.fliwright/support/*-test.ts`, import `test`/`expect` from that support module instead so app-specific helpers are injected consistently. Use the fixture objects `{ page, driver, flow, mock, agent, aiRuntime, timeline, logger }` when relevant.
4. Put setup in `mock.activateRules(...)`, `mock.rules(...)`, or named `flow.step()` blocks. Put each user action in a concise `flow.step()`. In `script` mode, use `flow.frame()`, `logger`, or `agent.verify()` to record facts; use `expect(locator, title?)` only when failure should stop the run.
5. Avoid fixed sleeps. Rely on locator assertions, `page.waitFor(...)`, `page.settle()`, or navigation helpers.
6. Keep committed tests portable. Accept VM Service URLs from CLI/config/env (`FLIWRIGHT_VM_URL`, `FLIWRIGHT_VM_SERVICE_URL`, project `.fliwright/config.json`, or `fliwright.config.ts`); never commit local URLs or device-specific config.
7. Prefer `fliwright run --test path/to/file.ts --reporter ai-json` or MCP `fliwright_run` for active app validation because they return the richest report. Use `pnpm vitest run path/to/file.ts` only for quick local checks when full Fliwright reports are not needed.

## Reference Routing

Read only the reference needed for the current task:

- First Fliwright test or environment setup: [references/getting-started.md](references/getting-started.md)
- `test`/`script`, fixtures, `flow`, timeline nodes, manual steps: [references/timeline-native.md](references/timeline-native.md), [references/test-harness.md](references/test-harness.md)
- Logging and run artifacts: [references/logging.md](references/logging.md)
- Selectors, gestures, assertions, navigation, screenshots: [references/selectors.md](references/selectors.md), [references/actions.md](references/actions.md), [references/assertions.md](references/assertions.md), [references/navigation.md](references/navigation.md), [references/screenshots-snapshots.md](references/screenshots-snapshots.md)
- Forms, AI, mocks, Riverpod state, app capabilities: [references/forms.md](references/forms.md), [references/ai.md](references/ai.md), [references/mocks.md](references/mocks.md), [references/state.md](references/state.md), [references/app-instance.md](references/app-instance.md)
- CLI/MCP workflow and failure diagnosis: [references/cli.md](references/cli.md), [references/mcp-workflow.md](references/mcp-workflow.md), [references/troubleshooting.md](references/troubleshooting.md)
- Human verification, captcha, slider, or WebView/PlatformView overlays: read [references/captcha.md](references/captcha.md) before designing the flow.
- Exact signatures or copyable templates: [references/api-quick-reference.md](references/api-quick-reference.md), [references/examples.md](references/examples.md), and `examples/*.ts`.

If unsure which reference applies, open [references/index.md](references/index.md) as the routing table.

## Authoring Rules

- Selectors: stable `Key` > semantics identifier/label/role > exact visible text > scoped text/type > raw widget type fallback.
- During exploration, use `page.snapshot()` and `page.findRef(...)` to discover candidates, then commit resilient query-based locators such as `page.getByKey(...)`, `page.getByText(...)`, or scoped `page.locator(...)`. Do not commit ephemeral `e<N>` refs from one snapshot.
- Scope ambiguous UI with descendant/ancestor locators, `.and(...)`, `.nth(...)`, route context, or form context. Do not rely on whichever element happens to be first.
- Use locator actions (`click`, `longPress`, `drag`, `pinch`, `fill`, `type`, `clear`, `selectOption`) instead of coordinates unless the behavior itself is coordinate-based or outside the Flutter widget tree.
- Use `fill()` to replace field values and `type()` when testing incremental typing or append behavior.
- On mobile form flows, call `await page.dismissKeyboard()` after the last text input and before locating/clicking a submit or Next button that may be below the soft keyboard. Then prefer `locator.scrollIntoViewAndClick(...)` or `scrollIntoView(...)` + `expect(locator).toBeEnabled()` for buttons that may be off-screen.
- For custom selection controls, prefer semantics-aware APIs: `check()` / `uncheck()` / `setCheckbox()` and `toBeChecked()` work for native `Checkbox`/`Switch`/`Radio` and custom widgets that expose Flutter `Semantics(checked: ...)`, `Semantics(toggled: ...)`, or `Semantics(selected: ...)`.
- Choose select strategies based on the widget: `selectOption()` for standard dropdowns, real user clicks for custom sheets/dialogs, and search-field-plus-option-click flows for virtualized country/region pickers.
- Assert visible outcomes with `await expect(locator, 'clear title').toBeVisible()`, `toHaveText()`, `toContainText()`, `toBeEnabled()`, or `.not`. The title becomes timeline metadata.
- Use Vitest `expect` only for non-locator values such as captured HTTP calls from `mock.findCalls(...)` or `mock.getCalls(...)`.
- Use `logger.info/debug/warn/error/success` for script progress and diagnostics; do not make `console.log` the main run log.
- Keep AI optional and deterministic in CI. Prefer `provider: 'mock'` or `'none'`, catch `AiDisabledError` when AI is optional, and land self-healing suggestions back into stable selectors after review.
- For HTTP mock rule JSON, prefer `baseRule` plus overrides for repeated endpoint fields, and use `removeBodyFields` when an inherited response field must be absent. See [references/mocks.md](references/mocks.md).

## Project Fixture Extensions

When several tests repeat the same app-specific setup, create a support module under `.fliwright/support/` instead of copying helpers into every test. Use `extendFliwrightTest` to inject a project runtime that wraps Fliwright primitives while keeping routes, provider names, mock endpoints, and app business rules in the target project.

Good candidates for a project runtime:

- opening a stable home route and closing known optional overlays
- activating a named group of project mock rules
- pull-to-refresh until a project endpoint is called or provider state changes
- reading project Riverpod/provider state for business assertions
- reusable navigation through project account/settings screens

Keep generic mechanics in Fliwright APIs (`mock.activateRules`, `page.pullToRefresh`, `locator.clickIfVisible`) and keep project vocabulary in the project runtime.

```typescript
// .fliwright/support/app-test.ts
import { createFliwrightTest, defineConfig, extendFliwrightTest } from '@fliwright/vitest';
import type { FliwrightLogger, MockRuntime, Page } from '@fliwright/core';

class AppRuntime {
  constructor(private readonly ctx: { page: Page; mock: MockRuntime; logger: FliwrightLogger }) {}

  async activateLoggedInHome(rule: string) {
    await this.ctx.mock.activateRules({
      mockDir: new URL('../mocks', import.meta.url).pathname,
      routes: [{ path: '/api/v1/user/info', method: 'POST', rule }],
    });
  }
}

const base = createFliwrightTest(defineConfig({
  vmServiceUrl: process.env.FLIWRIGHT_VM_URL ?? process.env.FLIWRIGHT_VM_SERVICE_URL ?? '',
}));

export const test = extendFliwrightTest<{ app: AppRuntime }>(base, {
  app: async ({ page, mock, logger }, use) => {
    await use(new AppRuntime({ page, mock, logger }));
  },
});
export { expect } from '@fliwright/vitest';
```

## Human Verification And Captcha

Treat captcha, slider verification, QR login, SMS approval, and WebView/PlatformView overlays as special cases.

- If the flow triggers third-party human verification, read [references/captcha.md](references/captcha.md) first.
- Flutter-tree locators and snapshots usually cannot see WebView/PlatformView captcha UI. Do not expect `getByKey`, `getByText`, or `snapshot` to find the slider.
- Prefer `flow.manual({ resumeWhen })` and have `resumeWhen` poll the next business state after verification, such as an SMS field, success title, route, or stable Key. Do not use "captcha overlay disappeared" as the completion condition.
- Do not use `driver.state.override` or Riverpod overrides to bypass captcha tokens unless the app/backend explicitly exposes a test-only bypass. Third-party captcha tokens are generated and verified outside the Flutter provider graph.
- For unattended CI, split coverage into "pre-captcha state assertions" plus mocks for the app's business APIs after captcha. Mock app APIs, not the captcha provider itself.

## Validation

- For generated or edited test code, run the narrowest relevant TypeScript check or package test available. Use `pnpm lint`, `pnpm --filter @fliwright/vitest test`, `pnpm --filter @fliwright/core test`, or a targeted `pnpm vitest run path/to/file.ts` as appropriate.
- For active Flutter app validation, prefer `fliwright run --test path/to/file.ts --reporter ai-json` or MCP `fliwright_run`. Pass `--vm-url` only when config/env discovery is unavailable.
- If validation needs a running app or VM Service URL that is not available, say that explicitly and still perform static checks where possible.
- When debugging failures, inspect the run report, `timeline.json`, `logs/events.jsonl`, screenshots/snapshots, diagnostics, and self-healing suggestions before editing selectors blindly.

## Common Repairs

- `No VM Service URL provided`: check CLI `--vm-url`, `FLIWRIGHT_VM_URL`, `FLIWRIGHT_VM_SERVICE_URL`, `fliwright.config.ts`, `.fliwright/config.json`, then local port discovery. Fixture and CLI resolution differ slightly; see [references/troubleshooting.md](references/troubleshooting.md).
- `Unknown method "ext.fliwright.snap"`: the app runs an old bridge. Upgrade/rebuild before using snap/ref/observe/actionability, or isolate a legacy bare-driver script.
- `page.dismissKeyboard()` fails with `VM Service error [-32000]: Server error` or the phone keyboard stays open: the running app likely has not loaded the bridge version that calls the native text-input hide channel. Stop and restart the Flutter debug app; rerunning only the TypeScript script does not update Dart bridge code already loaded on the device.
- Flaky selectors: replace broad text/type queries with Keys, semantics, scoped locators, or selectors discovered from snapshot/ref exploration.
- Form filling wrong fields: inspect `page.formHelper.analyze()` output, then use `fillFields(...)` or more precise locators.
- Screenshots or draw assertions fail on unstable frames: wait for a stable app state or restart the app; do not keep clicking through an unstable screen.
