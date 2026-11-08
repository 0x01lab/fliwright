---
name: write-fliwright-tests
description: Create, update, review, or debug Fliwright TypeScript automation scripts and E2E tests for Flutter apps. Derive cases, named scenarios and contract-backed HTTP mock rules, then verify requests and visible outcomes. Use for @fliwright/vitest fixtures, Flutter/native locators, system permission dialogs, assertions, timeline artifacts, app state setup and CLI-recorded code cleanup. Project-specific routes, Keys and endpoints belong in the target project.
---

# Write Fliwright Automation & Tests

Use Fliwright as deterministic Flutter app automation through the Dart VM Service, not as browser automation. Prefer timeline-native scripts and tests so failures include `timeline.json`, structured logs, screenshots/snapshots, and agent-readable diagnostics.

## First Decision

- Use `test` from `@fliwright/vitest` for durable regression coverage, CI checks, and user-visible behavior verification. Put it in `.fliwright/tests/*.test.ts` and include meaningful assertions.
- Use `script` from `@fliwright/vitest` for one-off automation, data entry, account setup, operational tasks, and CLI-recorded script cleanup. Put it in `.fliwright/scripts/*.script.ts` or `.fliwright/scripts/*.mjs`; do not add assertions only to make it look like a test.
- Use bare `FliwrightDriver` only for custom plugin work, legacy bridge compatibility, or low-level coordinate/extension tests. Manage `connect()` and `dispose()` explicitly.

## From Test Goals To Scenarios

For test creation or changes to covered behavior, read [references/scenario-design.md](references/scenario-design.md) before implementation. This workflow accepts natural-language goals, bug reproductions and existing cases without requiring a GitLab Item or test plan.

For new tests or changes to test registration, parameterization, hooks or fixtures, also read [references/vitest-authoring.md](references/vitest-authoring.md). Confirm the target project's installed Vitest version and use the relevant official API documentation; nearby tests are examples, not the API specification.

When creating a test file, choose the closest [basic template](references/test-templates.md) and adapt its structure to the verified goal and project contracts. Read only the selected template; do not copy illustrative scenario names, Keys, routes or expected values as business facts.

- Derive observable cases and the state needed to reach each target branch. Match existing scenarios by their actual setup; compose or create missing named `TestScenario` declarations and register them in project config.
- Derive mock selections and response data from the goal plus the target app's API contracts and parsing logic. Reuse suitable rules; create missing endpoint JSON with [write-fliwright-mock-rules](../write-fliwright-mock-rules/SKILL.md). A valid schema or a rule named `success` does not establish business correctness.
- Verify scenario composition, resolved mock files, and actual app behavior. For requests central to the goal, assert relevant request facts and the resulting UI branch; activation alone is insufficient.
- A request to implement tests includes the required scenario/mock authoring and applicable validation. Complete these steps autonomously within the requested scope. A request only for case descriptions stays at case design. Infer setup from evidence; surface genuinely missing business expectations or capabilities rather than inventing them. Keep generated CI tests deterministic; this reasoning happens during authoring.

## File Placement

New timeline-native `test`/`script` files live under the project's `.fliwright/` directory, NOT the repo-root `tests/`. Confirm placement before creating a file — repo-root `tests/` is reserved for legacy bare-`FliwrightDriver` files, and mixing the two causes mis-categorized suites.

| Category | Fixture style | Directory | Extension |
| --- | --- | --- | --- |
| Regression / CI test | `test`/`expect` from `@fliwright/vitest` | `.fliwright/tests/` | `*.test.ts` |
| One-off automation / data entry | `script` from `@fliwright/vitest`, or `createFliwrightScript` | `.fliwright/scripts/` | `*.script.ts` / `*.mjs` |
| Legacy bare driver / coordinate / extension test | bare `FliwrightDriver` (`connect()`/`dispose()` manual) | repo-root `tests/` | `*.test.ts` / `*.mjs` |

Shared HTTP Mock JSON goes in `.fliwright/mocks/api/*.json`; GitLab Item-specific
responses go in `.fliwright/test-plans/<iid>/mocks/api/*.json`. Use the same
endpoint schema in both locations. For explicit selection and composition, read
[references/mock-rule-sets.md](references/mock-rule-sets.md).

Before writing a new file, `ls .fliwright/tests/` (or `scripts/`) to match the placement convention of nearby files; do not infer the directory from a git-status snapshot or unrelated legacy files.

Run evidence uses the project's resolved `runsRoot`, defaulting to `~/.fliwright/<project-path>/runs/`; see the [storage conventions](../fliwright-cli-workflows/references/commands/common.md#ci-evidence). For local or Item acceptance runs, omit invocation-level overrides unless requested. Item plans and coverage can reference returned run IDs and artifact paths without creating `.fliwright/test-plans/<iid>/runs/`. `--output` places a JSON summary separately; it does not relocate timeline, logs or screenshots.

## Work Pattern

1. Inspect the test goal, nearby tests, app source, and UI identifiers. Search for Keys, visible labels, routes, providers, mock endpoints, and existing Fliwright helpers with `rg`; derive cases and their scenario/mock requirements using the workflow above before writing selectors.
2. Confirm the app exposes the needed bridge capabilities before deep exploration. Current flows should support `ext.fliwright.snap`, `ext.fliwright.action`, screenshots, and mock extensions. If `ext.fliwright.snap` is unknown, treat the app as legacy or upgrade/rebuild it before using snapshot/ref features.
3. Start new files with `import { test, expect } from '@fliwright/vitest'` or `import { script, expect } from '@fliwright/vitest'`. If the project has `.fliwright/support/*-test.ts`, import `test`/`expect` from that support module instead so app-specific helpers are injected consistently. Use the fixture objects `{ page, driver, flow, mock, agent, aiRuntime, timeline, logger }` when relevant.
4. Declare reusable setup as a named composed `TestScenario`; authenticated business tests use app-owned `auth.seedLoggedIn`, never real login or generic provider overrides. Use `mock.rules(...)` or `flow.step()` for test-specific changes and user actions. In `script` mode, use `flow.frame()`, `logger`, or `agent.verify()` to record facts; use `expect(locator, title?)` only when failure should stop the run.
5. Avoid fixed sleeps. Rely on locator assertions, `page.waitFor(...)`, `page.settle()`, or navigation helpers.
6. Keep committed tests portable. Accept VM Service URLs from CLI/config/env (`FLIWRIGHT_VM_URL`, `FLIWRIGHT_VM_SERVICE_URL`, project `.fliwright/config.json`, or `fliwright.config.ts`); never commit local URLs or device-specific config.
7. Prefer `fliwright run --test path/to/file.ts --json` for active app validation and `fliwright script path/to/file.script.ts --json` for one-off scripts. For direct `pnpm vitest run`, configure `fliwrightPreset()` first; it installs the runner and recovery reporter required by the fixtures. See the setup guide before creating a new test environment.

## Reference Routing

Read only the reference needed for the current task:

- First Fliwright test or environment setup: [references/getting-started.md](references/getting-started.md)
- Starting a test file: [references/test-templates.md](references/test-templates.md) — explicit per-file home/Mock hooks, single case, `test.for`, `test.each`, distinct scenarios and submission verification.
- Test-goal analysis, case derivation, scenario selection/creation and mock correctness: [references/scenario-design.md](references/scenario-design.md)
- Vitest version, official API sources, `test.for` / `test.each`, hooks, cleanup and test collection: [references/vitest-authoring.md](references/vitest-authoring.md)
- Reusable baselines, authenticated business tests, `TestScenario` and `test.scenario(...)`: [references/scenarios.md](references/scenarios.md)
- Shared/Item Mock sources, explicit replacement, migration from inline helpers and rule provenance: [references/mock-rule-sets.md](references/mock-rule-sets.md)
- `test`/`script`, fixtures, `flow`, timeline nodes, manual steps: [references/timeline-native.md](references/timeline-native.md), [references/test-harness.md](references/test-harness.md)
- Logging and run artifacts: [references/logging.md](references/logging.md)
- Native UIKit/Android UI, system permission dialogs, native input and mixed Flutter/native assertions: [references/native.md](references/native.md). Use `native` for platform UI and `page` for Flutter; verify device capabilities before selecting scenarios.
- Selectors, gestures, assertions, navigation, screenshots: [references/selectors.md](references/selectors.md), [references/actions.md](references/actions.md), [references/assertions.md](references/assertions.md), [references/navigation.md](references/navigation.md), [references/screenshots-snapshots.md](references/screenshots-snapshots.md)
- Forms, AI, mocks, Riverpod state, app capabilities: [references/forms.md](references/forms.md), [references/ai.md](references/ai.md), [references/mocks.md](references/mocks.md), [references/state.md](references/state.md), [references/app-instance.md](references/app-instance.md)
- CLI workflow and failure diagnosis: [references/cli.md](references/cli.md), [references/agent-workflow.md](references/agent-workflow.md), [references/troubleshooting.md](references/troubleshooting.md)
- Human verification, captcha, slider, or WebView/PlatformView overlays: read [references/captcha.md](references/captcha.md) before designing the flow.
- Exact signatures or copyable templates: [references/api-quick-reference.md](references/api-quick-reference.md), [references/examples.md](references/examples.md), and `examples/*.ts`.

If unsure which reference applies, open [references/index.md](references/index.md) as the routing table.

## Authoring Rules

- Register independent cases with explicit declarations or Vitest `test.for` / `test.each`, not top-level `for` / `forEach` title generation. Prefer `test.for` when using fixtures. Keep distinct scenarios explicit; action/assertion loops inside a case are allowed. See [Vitest authoring](references/vitest-authoring.md).
- Use the project's extended `test` for hooks that need its fixtures. Keep per-attempt state in a fixture or cleanup closure, and await teardown. Tests sharing one app run serially unless the project provides isolated app instances.
- For this workflow, explicitly declare the [per-file lifecycle](references/test-templates.md#脚本内生命周期) in every Flutter test script: `test.beforeEach` explicitly calls the target project's existing home-reset helper (for example, Exio's `exio.openHome()`), and `test.afterEach` clears all active App HTTP Mock routes after each attempt, including failures. Inspect the helper's implementation and state requirements before reuse; do not replace an applicable app-specific helper with raw `page.goto('/home')`. If missing, implement it in project support using verified navigation, overlay handling and readiness. Support owns that implementation; each test script owns the explicit call and hook registrations. Import the project's fixture `test` from support. Use strict `driver.mock.clearFlutterRoutes()` for full cleanup; `mock.clearRoutes()` preserves editor-owned routes. Keep Mock JSON sources intact. Tests enter their target route from home; do not depend on scenario navigation to leave them on a different page.
- Put imports first and keep actions, waits and assertions on separate lines. Extract repeated business operations without hiding case identity, scenario selection or expected outcomes.
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
- Locate the actual text-bearing descendant when a wrapper has no own text; do not flatten the whole widget subtree just to assert one label. Poll raw values only when no locator matcher represents the condition, and explain the missing capability when it is not obvious.
- For zero/exact request counts, define the operation window and wait for its observable completion before checking the total. First-call polling, a single UI node, or network silence alone does not prove exactly-once behavior. See [request assertions](references/assertions.md#请求断言).
- Use `logger.info/debug/warn/error/success` for script progress and diagnostics; do not make `console.log` the main run log.
- Keep AI optional and deterministic in CI. Prefer `provider: 'mock'` or `'none'`, catch `AiDisabledError` when AI is optional, and land self-healing suggestions back into stable selectors after review.
- For HTTP mock rule JSON, prefer `baseRule` plus overrides for repeated endpoint fields, and use `removeBodyFields` when an inherited response field must be absent. See [references/mocks.md](references/mocks.md).
- For Item acceptance, reuse shared responses and keep only Item-specific data beside its plan. Compose source-qualified selections in named scenarios; do not load shared and Item directories sequentially. Use `replace: true` for an inherited method/path selection. `applyRuleSet` resets all App Mock routes, including editor-applied routes, and requires Flutter-side support; see [references/mock-rule-sets.md](references/mock-rule-sets.md).

## Project Fixture Extensions

Put reusable app actions and business queries in `.fliwright/support/` with `extendFliwrightTest`; see the [project fixture example](references/test-harness.md#项目级-fixtureextendfliwrighttest). Keep routes, provider names and endpoints in the target project. Keep reusable mock/auth/storage/navigation baselines in [named scenarios](references/scenarios.md), so setup runs before every attempt and retry.

## GitLab 计划中的脚本交付

通过 `gitlab-test-plan` 编写脚本时，覆盖目标来自完整 checklist；没有 checklist 时来自需求推导用例。
每条用例核对前置条件、操作及全部断言，优先补齐已有部分脚本，不能用 smoke 成功代替全量覆盖。
收集 catalog 后把完整脚本、部分覆盖及实际阻塞交回计划流程记录，执行结果仍取自真实 run。
可继续完成的缺口应继续完成；确实无法继续的列出缺失条件和原因，交付为部分完成。

## Human Verification And Captcha

Treat captcha, slider verification, QR login, SMS approval, and WebView/PlatformView overlays as special cases.

- If the flow triggers third-party human verification, read [references/captcha.md](references/captcha.md) first.
- Flutter-tree locators and snapshots usually cannot see WebView/PlatformView captcha UI. Do not expect `getByKey`, `getByText`, or `snapshot` to find the slider.
- Prefer `flow.manual({ resumeWhen })` and have `resumeWhen` poll the next business state after verification, such as an SMS field, success title, route, or stable Key. Do not use "captcha overlay disappeared" as the completion condition.
- Do not use `driver.state.override` or Riverpod overrides to bypass captcha tokens unless the app/backend explicitly exposes a test-only bypass. Third-party captcha tokens are generated and verified outside the Flutter provider graph.
- For unattended CI, split coverage into "pre-captcha state assertions" plus mocks for the app's business APIs after captcha. Mock app APIs, not the captcha provider itself.

## Validation

- When implementing UI against a supplied Figma reference, capture the actual
  app state and inspect it against the matching design after the change and
  visual fixes. See [screenshot-based UI review](../fliwright-cli-workflows/references/visual-review.md).
  Functional assertions alone do not verify appearance.
- For new or changed cases, complete the [scenario and mock verification](references/scenario-design.md#验证与交付): check setup, critical request facts and branch-specific outcomes. Report static validation and real execution separately, including unresolved goals.
- For generated or edited test code, run the narrowest relevant TypeScript check or package test available. Use `pnpm lint`, `pnpm --filter @fliwright/vitest test`, `pnpm --filter @fliwright/core test`, or a targeted `pnpm vitest run path/to/file.ts` as appropriate.
- For new, renamed or parameterized cases, collect the target file with the installed Vitest runner and check expected names, count and uniqueness. When editor discovery is relevant, also check the Tests tree; runtime collection does not prove static discovery. See [collection checks](references/vitest-authoring.md#用例收集与交付).
- Direct Vitest execution requires `fliwrightPreset()` in the target project's Vitest config; CLI execution installs the runner itself. Use the [CLI command index](../fliwright-cli-workflows/references/commands/index.md) for current flags and lifecycle rules.
- For active Flutter app validation, prefer `fliwright run --test path/to/file.ts --json`. Pass `--vm-url` only when config/env discovery is unavailable.
- If validation needs a running app or VM Service URL that is not available, say that explicitly and still perform static checks where possible.
- When debugging failures, inspect the run report, `timeline.json`, `logs/events.jsonl`, screenshots/snapshots, diagnostics, and self-healing suggestions before editing selectors blindly.

## Common Repairs

- `No VM Service URL provided`: check CLI `--vm-url`, `FLIWRIGHT_VM_URL`, `FLIWRIGHT_VM_SERVICE_URL`, `fliwright.config.ts`, `.fliwright/config.json`, then local port discovery. Fixture and CLI resolution differ slightly; see [references/troubleshooting.md](references/troubleshooting.md).
- `Unknown method "ext.fliwright.snap"`: the app runs an old bridge. Upgrade/rebuild before using snap/ref/observe/actionability, or isolate a legacy bare-driver script.
- `page.dismissKeyboard()` fails with `VM Service error [-32000]: Server error` or the phone keyboard stays open: the running app likely has not loaded the bridge version that calls the native text-input hide channel. Stop and restart the Flutter debug app; rerunning only the TypeScript script does not update Dart bridge code already loaded on the device.
- Flaky selectors: replace broad text/type queries with Keys, semantics, scoped locators, or selectors discovered from snapshot/ref exploration.
- Form filling wrong fields: inspect `page.formHelper.analyze()` output, then use `fillFields(...)` or more precise locators.
- Screenshots or draw assertions fail on unstable frames: wait for a stable app state or restart the app; do not keep clicking through an unstable screen.
