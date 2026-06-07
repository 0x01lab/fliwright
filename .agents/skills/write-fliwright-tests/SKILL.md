---
name: write-fliwright-tests
description: Create, update, review, or debug Fliwright test scripts for Flutter apps. Use when Codex needs to write TypeScript `.test.ts` files with `@fliwright/vitest`, selectors, locators, gestures, assertions, form filling, HTTP mocks, Riverpod state setup, MCP-recorded code cleanup, or manual `FliwrightDriver` E2E scripts.
---

# Write Fliwright Tests

## Overview

Write Fliwright tests as deterministic Flutter app automation, not browser tests. Prefer the `@fliwright/vitest` fixture for normal test files, use stable widget selectors, assert visible user outcomes, and keep live-VM requirements explicit.

## Workflow

1. Identify the test shape: new `.test.ts`, repair existing script, convert recording output, add mocks/state setup, or diagnose a failure.
2. Prefer `import { test, expect } from '@fliwright/vitest'` unless the file needs explicit driver lifecycle, custom plugins, or low-level setup.
3. Read [references/api_reference.md](references/api_reference.md) when you need exact APIs, selector formats, environment variables, mocks, forms, state, or MCP tool behavior.
4. Inspect nearby tests and source UI before writing selectors. Use `rg` for widget text, keys, route names, provider names, and existing Fliwright patterns.
5. Write the shortest user-path script that sets state, performs actions, and asserts the visible result. Avoid sleeps; rely on `waitFor()` and Fliwright assertions.
6. Validate syntax and imports with the repo's TypeScript checks when possible. Only run Fliwright E2E tests when a Flutter VM Service URL is available.

## Harness Choice

- Use `@fliwright/vitest` default `test` for standard scripts. It reads `FLIWRIGHT_VM_URL`, creates a shared driver, provides `{ page }`, and wires failure context.
- Use `createFliwrightTest(defineConfig(...))` when the script must hard-code or transform a VM URL, adjust timeout, or disable screenshots.
- Use raw `FliwrightDriver` inside Vitest `beforeAll/afterAll` for advanced driver APIs such as `driver.mock`, `driver.state`, custom plugins, or old E2E patterns. Always call `dispose()`.
- Use MCP tools (`fliwright_record`, `fliwright_generate_test`, `fliwright_run`, `fliwright_get_failure`) to discover or verify behavior, then commit a normal test file.

## Authoring Rules

- Prefer selectors in this order: stable `Key`, semantics identifier/label/role, exact visible text, scoped text/type, widget type only as a fallback.
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

## Validation

- Static checks: run `pnpm lint` or a package-filtered TypeScript check if the edited package has one.
- Unit-level package checks: run `pnpm --filter @fliwright/vitest test`, `pnpm --filter @fliwright/core test`, or the relevant package test when changing framework code.
- Live app tests: run with `FLIWRIGHT_VM_URL=ws://127.0.0.1:<port>/<token>/ws pnpm vitest run path/to/test.ts` or use MCP `fliwright_run` with `vmServiceUrl`.
- If the only missing prerequisite is a running Flutter app or VM URL, report that clearly and still validate TypeScript where possible.

## Common Repairs

- `No VM Service URL provided`: set `FLIWRIGHT_VM_URL` or use `createFliwrightTest({ vmServiceUrl })`.
- Existing examples using `FLIWRIGHT_VM_SERVICE_URL` usually use manual `FliwrightDriver`; convert HTTP VM URLs to WebSocket URLs before `driver.connect()`.
- Flaky selector: replace broad text/type with key, semantics, scoped locator, or an assertion target returned by `snapshot()`/`findRef()` during exploration.
- Field fill misses the intended input: use `page.formHelper.analyze()` to inspect fields, then `fillFields([...])` or a more precise locator.
