# @fliwright/cli

Fliwright's command interface for developers, coding agents and CI. Node.js 22.12+ (22.x), 24.x, or 26+ is required.

```sh
npx fliwright init
npx fliwright schema --json
npx fliwright schema app.interact --json
npx fliwright doctor --strict --json
npx fliwright run --test .fliwright/tests/cart.test.ts --scenario cart-ready --json --junit-output artifacts/junit.xml
```

Every leaf command accepts `--cwd`, `--json`, `--input <file|->`, `--deadline <milliseconds>` and `--session`.
Use `schema` to discover commands and `schema <command.path>` to inspect input, the JSON output envelope, result type, exit codes, effects and connection requirements. The envelope schema leaves command-specific `data` open; use generated feature references for its API details. Structured input rejects unknown fields and duplicate fields supplied both as flags and JSON. Booleans accept `--flag`, `--flag true`, or `--flag false`. Arrays accept repeated flags or a JSON array.

`--json` prints exactly one versioned envelope on stdout: `schemaVersion`, `command`, `requestId`, `ok`, and `data` or `error`. Progress uses stderr. Session operations include `operationId`; inspect a lost response with `session status --operation-id` before retrying a mutation. Exit codes: 0 success; 1 test/review failure; 2 invalid input; 3 environment/execution unavailable; 4 workflow conflict; 5 deadline; 130 cancellation. Deadlines request cancellation and wait for owned work to settle.

- `run` and `script <file>` execute finite Vitest runs. Attach with `--vm-url` or launch with `--device-id`; managed apps stop afterward unless `--keep-app-alive`. `--junit-output` is independent of JSON output. Test-attempt fixtures own endpoint leases and named scenario preparation, including retries.
- `record --duration <seconds>` captures bounded recordings. Test readiness still requires deterministic scenario/assertion/replay evidence.
- `app` provides status, snapshot, find, observe, interact, screenshot, source-map, diagnostics, reload and debug-snapshot. Screenshots are files. Snapshot refs are opaque handles tied to the running app/isolate; reacquire them after restart.
- `scenario` lists, resolves, applies or resets named project scenarios. Business authentication uses app-owned auth seeding.
- `mock` lists the file catalog, reads Flutter routes/calls, applies one named rule, clears calls or resets routes/history/passthrough.
- `artifacts` reads reports, failures and timelines offline, diagnoses agent-visible failures and exports portable evidence. Select testId/attemptId when a run has multiple timelines.
- `flow` provides recording-derived flows, test generation, runtime/Figma capture and review reports. Figma's external MCP remains a valid design input.
- `generate-test` and `tdd validate-spec` work offline. `tdd cycle --file ...` runs one finite CI cycle.

For repeated exploration and persistent TDD:

```sh
fliwright session open --json
# Read data.sessionId from the result.
fliwright app snapshot --session <id> --json
fliwright tdd start --session <id> --scenario cart-ready --json
fliwright tdd focus --session <id> --file .fliwright/tests/cart.test.ts --json
fliwright tdd cycle --session <id> --json
fliwright session close --session <id> --json
```

`FLIWRIGHT_SESSION` selects a project session for app and persistent workflow commands. Offline artifact/schema queries and finite run/script/record commands remain independent. Connection workers serialize commands, retain TDD ownership until real execution settles, and release endpoint control before Vitest forks acquire it. Worker startup is bounded at 30 seconds for attach and 180 seconds for a managed launch; an explicit command deadline can shorten it. Workers expire after 30 minutes of inactivity. Runtime control and operation journals live in ignored `.fliwright/sessions/` files.

Fliwright's MCP server and `fliwright mcp` have been removed. Use the bundled Skills with this CLI. Install the CLI in each target project and retain CI artifacts even when the command fails.


## Command documentation for Skills

Read the [task and command index](https://github.com/0x01lab/fliwright/blob/main/.agents/skills/fliwright-cli-workflows/references/commands/index.md)
for one page per CLI command: purpose, prerequisites, parameter meanings,
examples, result fields, side effects and failure recovery. The CLI workflow
Skill bundles these references, so an installed Skill can read them without
cloning this repository. Use `fliwright schema <command.path> --json` to confirm
the installed version’s contract.

Maintainers: edit semantic guidance in `docs/command-guide.mjs` and parameter
explanations in `docs/parameter-guide.mjs`; the registry remains the source of
truth for command inventory, types, flags and defaults. After building the CLI,
run `pnpm docs:cli`, `pnpm plugin:sync`, and `pnpm docs:cli:check` from the repository
root. The check rejects undocumented/stale commands, missing parameter guidance,
broken links, unparseable examples and source/plugin drift. CI runs this check
after the build. Regenerate `docs/features/` with
`node scripts/generate-feature-docs.mjs` to reuse the same command pages there.
