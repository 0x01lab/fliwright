---
name: fliwright-tdd
description: >
  Use for test-first development in the Fliwright repository, including TDD,
  red-green-refactor, regression tests, and bug fixes that call for a failing test first.
  Applies to TypeScript packages, the Dart bridge, CLI commands and behavior, selectors,
  protocol behavior, code generation, and generated feature docs. Also use
  `write-fliwright-tests` for Fliwright automation scripts, `.fliwright/tests`,
  `@fliwright/vitest` fixtures, locators, flows, mocks, agent verification, timelines,
  live Flutter app validation, and E2E cases.
---

# Fliwright TDD

Use behavior-focused tests to protect Fliwright's protocol contracts, selector semantics, generated code, and user-visible automation behavior.

For starting or resuming persistent TDD against a target Flutter app, use the `fliwright-cli-workflows` session and TDD command guides. They cover finite and persistent lifecycles, managed startup, attaching, and recovery.

## Workflow And Execution

Choose the behavior to test, write a standard test, confirm the expected failure, update production code, and decide the scope of refactoring and regression checks. Make those decisions directly and avoid introducing an InteractionSpec, readiness state machine, or automated repair loop.

`@fliwright/tdd` provides focused reruns, Flutter synchronization, baseline reset, resource management, and failure evidence. Its red and green statuses describe execution results. Inspect the failure to confirm that it demonstrates the missing behavior.

Follow the [persistent TDD guide](../fliwright-cli-workflows/references/tdd.md) for commands against a target Flutter app. Prefer existing tests and named, composed scenarios. Use `fliwright run` for a single verification and start a persistent runtime only when the connection must survive repeated synchronization and reruns.

## Use With The Automation Authoring Skill

Apply this red-green-refactor workflow alongside `write-fliwright-tests` when writing Fliwright automation. Common cases include `.fliwright/tests`, `.fliwright/scripts`, `@fliwright/vitest`, `test` and `script` fixtures, locators, selectors, flow steps, mock rules, agent verification, timelines, live Flutter app validation, CLI recording cleanup, and E2E cases.

- Use this skill to set the TDD sequence, choose verification scope, and decide when to expand testing.
- Use `write-fliwright-tests` for placement, fixtures, locators, mocks, flows, timelines, and live app validation.

## Core Loop

1. Define the smallest behavior change in one sentence.
2. Use `rg` or `rg --files` to find the owning package, source, and nearby tests.
3. Read the docs needed for the change. For API details, start with the relevant `docs/features/<package>/<Class>.md`.
4. Write or update a failing test first.
5. Run the narrowest relevant test and confirm that it fails for the expected reason.
6. Implement the smallest change that makes the test pass.
7. Rerun the focused test until it passes.
8. Refactor only after the test passes, then rerun the same focused test.
9. Expand verification based on the change's impact.

If the bug report already includes a failing test or a reproduction, use it for the red step and run it before changing code when possible.

## Choosing Tests

- For TypeScript package behavior, add a focused Vitest test to the package's `tests` directory. Use `*.test.ts` and name the file after the source topic where practical.
- Add a regression test for selector, protocol, CLI command, or code-generation changes.
- For public API changes, cover the new behavior and any existing compatibility or error behavior that callers rely on.
- For Dart bridge changes, add or update `dart test` coverage near the changed behavior when practical.
- Use `write-fliwright-tests` for fixture, locator, flow, mock, and live app validation patterns in timeline-native Flutter automation and `.fliwright/tests`.
- Use `write-fliwright-mock-rules` for HTTP mock rule JSON changes.

Prefer unit or narrow integration tests for the first red-green cycle. Once focused tests cover the behavior, use E2E smoke tests with a running Flutter VM Service. Keep deterministic logic covered at the unit level.

## Verification Commands

Start with the smallest command that verifies the current step, then broaden the scope as needed.

| Scope | Command |
| --- | --- |
| One TypeScript package | `pnpm --filter <package> test` |
| Core package | `pnpm --filter @fliwright/core test` |
| Vitest package | `pnpm --filter @fliwright/vitest test` |
| Workspace TypeScript build | `pnpm build` |
| Workspace TypeScript type checks | `pnpm lint` |
| All TypeScript tests | `pnpm test` |
| Dart analysis | `melos run analyze` |
| Dart tests | `melos run test` |
| E2E smoke | `FLIWRIGHT_VM_SERVICE_URL=... pnpm --filter @fliwright/e2e-tests test:smoke` |

Run `pnpm install` before TypeScript verification when dependencies change. Run `melos bootstrap` when Dart dependencies change. If pub.dev is unreachable, optionally source `scripts/use-cn-pub-mirror.sh` in the current shell.

## Red

- Describe observable behavior in the failing test and keep assertions independent of private implementation details.
- Confirm that the failure comes from the expected missing behavior or regression.
- Fix setup, import, timing, or invalid test assumptions before changing production code.
- Make the name and assertion specific enough to communicate the contract to the next developer.

## Green

- Make the smallest source change that satisfies the failing test.
- Export new public APIs through `src/index.ts`.
- Keep explicit `.js` extensions on TypeScript ESM relative imports.
- Add tests before expanding selector, protocol payload, generated output, or CLI contracts.
- Leave generated build outputs such as `dist` out of the change.
- For UI changes with a Figma reference, [compare a real app screenshot with the design](../fliwright-cli-workflows/references/visual-review.md) after functional tests pass. Capture a fresh screenshot after fixing any visual differences.

## Refactoring And Documentation

- Refactor only while tests are green.
- Rerun the focused test after every meaningful refactor.
- Run package-level verification after changing shared helpers, public APIs, or cross-package contracts.
- Use `document-features` to regenerate or update `docs/features/` after significant source behavior or public API changes.

## When Verification Is Blocked

If a required VM Service, device, network, or external dependency is unavailable, identify the blocker, run independent static or unit checks, and provide the exact command needed to finish verification.
