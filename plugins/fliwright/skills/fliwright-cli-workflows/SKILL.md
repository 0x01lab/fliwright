---
name: fliwright-cli-workflows
description: Inspect and automate running Flutter apps, run tests in CI, record workflows, diagnose artifacts, and drive persistent TDD through the Fliwright CLI. Use for Fliwright agent workflows and command discovery.
---

# Fliwright CLI workflows

Start with the [task and command index](references/commands/index.md), then read only the matching command pages. Every leaf command documents when to use it, prerequisites, flags/JSON fields, examples, results, effects and recovery. Read [shared invocation and CI conventions](references/commands/common.md) for JSON envelopes, lifecycle and exit codes. These references ship with the Skill; they do not require a Fliwright repository checkout.

Run the project's installed `fliwright` executable (`pnpm exec fliwright` or `npx --no-install fliwright`). Discover current commands with `fliwright schema --json`; inspect exact input with `fliwright schema <command.path> --json`. Use `--input file.json` or `--input -` for nested structures. Do not invent flags or bridge methods. Treat JSON envelope `ok` and process exit code as authoritative; read `data` even on failure.

Choose a finite command for CI or a single task. Use `session open --json` for repeated exploration or persistent TDD; pass its `data.sessionId` explicitly with `--session`. Close it when finished. Session status remains queryable during long operations. After a lost response, inspect `session status --session <sessionId> --operation-id <id>` using the returned operation ID before retrying a mutation. If no operation ID was received, query `session status --session <sessionId> --json` for active `data.operations`, then inspect the relevant journal entry. An empty active list does not prove a mutation never ran; inspect app/artifact evidence if its identity remains unknown. Cancel a known operation with `session cancel --session <sessionId> --operation-id <id>`; do not rerun uncertain mutations automatically.

Explore with `app snapshot`, `app find` and `app observe`, then `app interact`. Snapshot refs are opaque and app/isolate-specific. Reacquire after restart. Durable tests use stable Key/semantics/text locators, never literal snapshot refs. Screenshots and reload captures return file paths. `app debug-snapshot` includes independent diagnostic channels and labels partial results.

For durable tests use `write-fliwright-tests`. Prepare app-owned state through a named composed scenario, including `auth.seedLoggedIn` for authenticated tests. `run --scenario <name>` applies it before every test attempt, including retries. Do not use real login or generic provider overrides as business-test setup.

Run CI with `run --test <pattern> --scenario <name> --json --junit-output <path> --runs-root <artifact-directory>`. Attach with `--vm-url` or launch with `--device-id`. `--deadline` is a whole-command cancellation budget; `--timeout` is the test timeout. Upload the run root and JUnit output with an always-run CI artifact step. Exit codes: 0 success, 1 failed test/review, 2 invalid input, 3 unavailable runtime, 4 workflow conflict, 5 deadline, 130 cancelled.

Read failure evidence before editing code: `artifacts failures`, `artifacts timeline`, `artifacts show`. These work without an app or connection session. Select `--test-id` and `--attempt-id` for multi-attempt runs. Export with `artifacts export --output <directory>`; request `--allow-partial` explicitly when recovering interrupted runs. Use `artifacts diagnose` for optional AI diagnosis.

Use `record --duration <seconds>` for bounded captures; generated output is a draft until its readiness evidence passes. Use `generate-test --input ...` or `tdd prepare --session ... --input ...` for generation. Attach-session TDD follows start → focus → cycle → stop; managed `session open --device-id` already starts the runtime, so skip start; generation/spec validation and finite `tdd cycle --file` also work in CI. Suggest repair first; apply only the requested repair mode.

Flow review uses `flow review-bundle`, `flow review-capture-runtime`, Figma capture and `flow review-report`. External Figma MCP can provide design screenshots; Fliwright itself has no MCP server.
