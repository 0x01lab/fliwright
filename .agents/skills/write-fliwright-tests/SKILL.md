---
name: write-fliwright-tests
description: Create, update, review, or debug Fliwright test scripts for Flutter apps. Use when Codex needs to write TypeScript `.test.ts` files with `@fliwright/vitest`, selectors, locators, gestures, assertions, form filling, HTTP mocks, Riverpod state setup, MCP-recorded code cleanup, or manual `FliwrightDriver` E2E scripts.
---

# Write Fliwright Tests

## Overview

Write Fliwright tests as deterministic Flutter app automation, not browser tests. Prefer the `@fliwright/vitest` fixture for normal test files, use stable widget selectors, assert visible user outcomes, and keep live-VM requirements explicit.

## Workflow

1. Identify the test shape: new `.test.ts`, repair existing script, convert recording output, add mocks/state setup, or diagnose a failure.
2. Check bridge capability before live exploration. Prefer apps with the current bridge exposing `ext.fliwright.snap`, `ext.fliwright.action`, `ext.fliwright.extractForm`, screenshot, and mock extensions.
3. Prefer `import { test, expect } from '@fliwright/vitest'` unless the file needs explicit driver lifecycle, custom plugins, or low-level setup.
4. Read the focused reference doc for the topic you need. Start at **[references/index.md](references/index.md)** (topic map), or go straight to: [getting-started.md](references/getting-started.md), [test-harness.md](references/test-harness.md), [selectors.md](references/selectors.md), [actions.md](references/actions.md), [assertions.md](references/assertions.md), [navigation.md](references/navigation.md), [forms.md](references/forms.md), [mocks.md](references/mocks.md), [screenshots-snapshots.md](references/screenshots-snapshots.md), [driver-lifecycle.md](references/driver-lifecycle.md), [cli.md](references/cli.md), [mcp-workflow.md](references/mcp-workflow.md), [troubleshooting.md](references/troubleshooting.md), [examples.md](references/examples.md), or the one-page [api-quick-reference.md](references/api-quick-reference.md) for exact signatures.
5. Inspect nearby tests and source UI before writing selectors. Use `rg` for widget text, keys, route names, provider names, and existing Fliwright patterns.
6. Write the shortest user-path script that sets state, performs actions, and asserts visible user outcomes. Avoid sleeps; rely on `waitFor()` and Fliwright assertions.
7. Validate syntax and imports with the repo's TypeScript checks when possible. Only run Fliwright E2E tests when a Flutter VM Service URL is available and the app is stable.

## Harness Choice

- Use `@fliwright/vitest` default `test` for standard scripts. It reads `FLIWRIGHT_VM_URL` with `FLIWRIGHT_VM_SERVICE_URL` compatibility, creates a shared driver, provides `{ page, driver }`, and wires failure context.
- Use `createFliwrightTest(defineConfig(...))` when the script must hard-code or transform a VM URL, adjust timeout, or disable screenshots.
- Use raw `FliwrightDriver` inside Vitest `beforeAll/afterAll` only for custom plugins, older bridge compatibility, or deliberately low-level coordinate/extension tests. Always call `dispose()`.
- Use the `driver` fixture for normal mock/state work instead of raw lifecycle code: `test('...', async ({ page, driver }) => { await driver.mock.route(...); })`.
- Use MCP tools (`fliwright_snap`, `fliwright_observe`, `fliwright_record`, `fliwright_generate_test`, `fliwright_run`, `fliwright_get_failure`) to discover or verify behavior, then commit a normal test file.

## Bridge Readiness

- Before writing ref-based or agent-generated tests, verify the app is running the current bridge. A failure like `Unknown method "ext.fliwright.snap"` means the app is on an older bridge and should be upgraded before using `snapshot()`, `findRef()`, MCP observe/find, or actionability diagnostics.
- Current bridge flows should use `page.snapshot()`, `page.findRef()`, `fliwright_snap`, and `fliwright_observe` for exploration. Do not hard-code `e<N>` refs across test runs.
- Legacy bridge flows may use `ext.fliwright.extractForm`, `ext.fliwright.snapshot`, and explicit raw-driver scripts only when the target app cannot yet be upgraded. Label those scripts as legacy and keep them isolated.
- If a live app crashes or enters an unstable state, stop running E2E immediately. Do not continue blind coordinate exploration; ask for the app to be restarted and prefer upgrading the embedded bridge.
- Recommended upgrade direction for Flutter apps: depend on the current `fliwright_bridge`, initialize `FliwrightBridge.init()` behind `kDebugMode`, rebuild/restart the app, then confirm `ext.fliwright.snap` works before running the full suite.

## Authoring Rules

- Prefer selectors in this order: stable `Key`, semantics identifier/label/role, exact visible text, scoped text/type, widget type only as a fallback.
- For current bridge targets, prefer ref discovery (`page.snapshot()` -> `page.findRef({ role, text, key, type })`) during exploration, then commit resilient query-based locators rather than snapshot-time `e<N>` refs.
- Prefer object or helper selectors (`page.getByKey('submit')`, `page.getByText('Submit')`, `page.locator({ text: 'Submit' })`) over ambiguous plain strings in new tests.
- Scope ambiguous widgets with descendant/ancestor locators, `.and(...)`, `.nth(...)`, or route/form context instead of relying on first-match behavior.
- Use `fill()` for replacing field values and `type()` for append/typing behavior. Use `click()`, `longPress()`, `drag()`, and `pinch()` on locators rather than coordinates unless the tested behavior is coordinate-based.
- Assert state through the UI whenever possible: `await expect(page.getByText('Done')).toBeVisible()`, `toHaveText`, `toContainText`, `toBeEnabled`, or `not`.
- Do not add fixed sleeps. Use `await page.waitFor(selector, timeout)` or assertion timeouts.
- Keep VM Service URL requirements in comments or docs for E2E-only scripts, but do not embed local machine URLs in committed tests.

## Examples

Use these as copyable starting points:

- [examples/basic-counter.test.ts](examples/basic-counter.test.ts) — standard `@fliwright/vitest` fixture.
- [examples/custom-config-login.test.ts](examples/custom-config-login.test.ts) — custom fixture config and login flow.
- [examples/manual-driver-form-mock.test.ts](examples/manual-driver-form-mock.test.ts) — raw driver lifecycle with mock and form helper.

For longer, fully commented scripts (mock+form+submit, go_router navigation, legacy raw-driver flows), see [references/examples.md](references/examples.md).

## Validation

- Static checks: run `pnpm lint` or a package-filtered TypeScript check if the edited package has one.
- Unit-level package checks: run `pnpm --filter @fliwright/vitest test`, `pnpm --filter @fliwright/core test`, or the relevant package test when changing framework code.
- Live app tests: prefer `fliwright run --test path/to/test.ts --vm-url ws://127.0.0.1:<port>/<token>/ws --reporter ai-json` or MCP `fliwright_run` so the AI agent receives the full report, screenshots, diagnostics, and reproduction command.
- Direct `pnpm vitest run path/to/test.ts` is acceptable for quick smoke checks, but it will not produce the same persisted AI run report unless launched through the CLI runner.
- If the only missing prerequisite is a running Flutter app or VM URL, report that clearly and still validate TypeScript where possible.

## Common Repairs

- `No VM Service URL provided`: set `FLIWRIGHT_VM_URL` or use `createFliwrightTest({ vmServiceUrl })`.
- `Unknown method "ext.fliwright.snap"`: the app is running an older bridge. Upgrade/rebuild the app before using snap/ref/observe/actionability features, or keep the script on an explicit legacy raw-driver path.
- Screenshot failure with Flutter paint assertions: wait for a stable app frame or restart the app; do not keep clicking through an unstable screen.
- Existing examples using `FLIWRIGHT_VM_SERVICE_URL` usually use manual `FliwrightDriver`; convert HTTP VM URLs to WebSocket URLs before `driver.connect()`.
- Flaky selector: replace broad text/type with key, semantics, scoped locator, or an assertion target returned by `snapshot()`/`findRef()` during exploration.
- Field fill misses the intended input: use `page.formHelper.analyze()` to inspect fields, then `fillFields([...])` or a more precise locator.

For a full symptom → cause → fix table (VM URL, bridge readiness, flaky selectors, timing, mocks, forms), see [references/troubleshooting.md](references/troubleshooting.md).
