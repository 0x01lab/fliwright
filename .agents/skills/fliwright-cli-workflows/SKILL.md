---
name: fliwright-cli-workflows
description: Inspect and automate Flutter and native mobile UI, set Mock state from natural-language goals, compare runtime screenshots with Figma during UI development, prepare ADB/XCTest sessions, run tests in CI, record workflows, diagnose artifacts, and drive persistent TDD through the Fliwright CLI. Use for Fliwright agent workflows and command discovery.
---

# Fliwright CLI workflows

Start with the [task and command index](references/commands/index.md), then read only the matching command pages. Every leaf command documents when to use it, prerequisites, flags/JSON fields, examples, results, effects and recovery. Read [shared invocation and CI conventions](references/commands/common.md) for JSON envelopes, lifecycle and exit codes. These references ship with the Skill; they do not require a Fliwright repository checkout.

Run the project's installed `fliwright` executable (`pnpm exec fliwright` or `npx --no-install fliwright`). Discover current commands with `fliwright schema --json`; inspect exact input with `fliwright schema <command.path> --json`. Use `--input file.json` or `--input -` for nested structures. Do not invent flags or bridge methods. Treat JSON envelope `ok` and process exit code as authoritative; read `data` even on failure.

For native UIKit/Android UI, system dialogs, input, capability readiness and device recovery, read [native workflows](references/native.md). Configure the exact device/app before ownership; iOS needs an explicitly prepared Simulator XCTest Runner. `page` targets Flutter, `native` targets allowlisted platform UI. Native tests share the managed device owner; do not start a second session against it. A declared capability is usable only when both support and readiness pass.

Choose a finite command for CI or a single task. Use `session open --json` for repeated exploration or persistent TDD; pass its `data.sessionId` explicitly with `--session`. Close it when finished. Session status remains queryable during long operations. After a lost response, inspect `session status --session <sessionId> --operation-id <id>` using the returned operation ID before retrying a mutation. If no operation ID was received, query `session status --session <sessionId> --json` for active `data.operations`, then inspect the relevant journal entry. An empty active list does not prove a mutation never ran; inspect app/artifact evidence if its identity remains unknown. Cancel a known operation with `session cancel --session <sessionId> --operation-id <id>`; do not rerun uncertain mutations automatically.

Explore with `app snapshot`, `app find` and `app observe`, then `app interact`. Snapshot refs are opaque and app/isolate-specific. Reacquire after restart. Durable tests use stable Key/semantics/text locators, never literal snapshot refs. Screenshots and reload captures return file paths. `app debug-snapshot` includes independent diagnostic channels and labels partial results.

For natural-language Mock setup, use [mock list](references/commands/command-mock.list.md) to discover rules, then read their endpoint JSON and resolved `baseRule` content to select responses matching the requested state. Apply each selection with [mock apply](references/commands/command-mock.apply.md), specifying method, endpoint and rule name; verify active Flutter routes with [mock status](references/commands/command-mock.status.md). The agent chooses rules; the CLI executes them. Report missing suitable rules rather than guessing. A setup-only request does not require writing tests or new scenarios.

For UI work with a Figma reference, capture and visually inspect the running app
after implementing a screen or meaningful visual change, and again after fixing
differences. Use `app screenshot --json` and open the returned `data.path` with
the agent's image tool; a successful capture or widget assertion alone does not
verify appearance. Compare against the matching Figma frame/state using the
available Figma tools. See [screenshot-based UI review](references/visual-review.md)
for matching conditions and reporting evidence. This direct workflow does not
require a Flow, Figma REST token, or pixel-diff gate.

When exploring or operating a Flutter app where prior UI discoveries may be reusable, also read [fliwright-agent-memory](../fliwright-agent-memory/SKILL.md). It defines how to load project-local memory before acting and distill verified findings before finishing.

For durable tests use `write-fliwright-tests`. Prepare app-owned state through a named composed scenario, including `auth.seedLoggedIn` for authenticated tests. `run --scenario <name>` applies it before every test attempt, including retries. Do not use real login or generic provider overrides as business-test setup.

For shared plus GitLab Item-specific HTTP responses, use source-qualified rules
in a named scenario; read the [rule-set guide](../write-fliwright-tests/references/mock-rule-sets.md)
when authoring or migrating it. `scenario resolve` checks composition without
reading endpoint JSON; offline file validation uses core `resolveMockRuleSet`.
`mock apply` selects one directory rule and does not compose a rule set or provide
attempt isolation. For suites with different scenarios, select per test with
`test.scenario(name)` and omit a conflicting global `--scenario`.

Local runs and GitLab Item acceptance use the project's resolved run root; omit `--runs-root` and input JSON `runsRoot` unless the user requests an override. Keep one canonical `plan.json` and its generated `coverage.md` under `.fliwright/test-plans/<iid>/`; put temporary draft/catalog/update inputs in a system temporary directory. Avoid Item-directory run summaries, JUnit and command-envelope copies. Release reports belong to the selected run outputDir. Run evidence defaults to `~/.fliwright/<project-path>/runs/`. Record returned run IDs and artifact paths. See the [storage conventions](references/commands/common.md#ci-evidence) for path encoding and overrides; the VS Code Run Viewer does not discover roots overridden only in another CLI process.

Run CI with `run --test <pattern> --scenario <name> --json --junit-output <path> --runs-root <artifact-directory>` when a portable artifact root is needed. Attach with `--vm-url` or launch with `--device-id`. `--deadline` is a whole-command cancellation budget; `--timeout` is the test timeout. Upload the run root and JUnit output with an always-run CI artifact step. Exit codes: 0 success, 1 failed test/review, 2 invalid input, 3 unavailable runtime, 4 workflow conflict, 5 deadline, 130 cancelled.

Read failure evidence before editing code: `artifacts failures`, `artifacts timeline`, `artifacts show`. These work without an app or connection session. Select `--test-id` and `--attempt-id` for multi-attempt runs. Export with `artifacts export --output <directory>`; request `--allow-partial` explicitly when recovering interrupted runs. Use `artifacts diagnose` for optional AI diagnosis.

Use `record --duration <seconds>` for bounded captures; generated output is a draft until its readiness evidence passes. `generate-test --input ...` provides an editable source/snapshot draft. For TDD, read [the agent-driven TDD workflow](references/tdd.md): the agent authors tests, verifies the expected red, changes app code and decides when to refactor. Runtime commands provide synchronization, state preparation, focused execution and evidence. Attach-session TDD follows start → focus → cycle → stop; managed `session open --device-id` already starts the runtime, so skip start. A finite `tdd cycle --file` also works in CI.

For repeatable multi-screen review artifacts, Flow review uses `flow review-bundle`, `flow review-capture-runtime`, Figma capture and `flow review-report`. Pixel comparison is optional supporting evidence; it does not explain design differences or replace visual inspection. External Figma MCP can provide design screenshots; Fliwright itself has no MCP server.
