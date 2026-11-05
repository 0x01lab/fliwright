# @fliwright/cli

Fliwright's command interface for developers, coding agents and CI. Node.js 22.12+ (22.x), 24.x, or 26+ is required.

## One-command Codex integration

From a Flutter project root with `pubspec.yaml` and `lib/main.dart`:

```sh
npx --yes --package=@fliwright/cli@latest fliwright init --agent codex --yes
```

Requires the matching npm packages and `fliwright_bridge` to be published. The
CLI installs project dependencies, creates missing configuration and a bridge
entrypoint, installs three bundled automation Skills with their references in
`.agents/skills/`, and merges a managed section into `AGENTS.md`. No Codex CLI,
marketplace registration or Fliwright source checkout is required. Open a new
Codex chat after setup. Use `--entrypoint lib/main_dev.dart` for a flavor entry;
`--install false` writes files without running dependency installers.

Reruns preserve existing project configuration, rules outside Fliwright markers,
unmanaged same-name Skills and locally edited resources. Commit installed Skills
alongside `.agents/skills/.fliwright-managed.json` so unmodified managed files can
be updated on later runs. Read `data.agent.conflicts`, `checks`, `nextSteps` and
`status` (`configured` or `needs-attention`). A completed scaffold with pending
work exits 0; installer failures exit 3 with partial progress. `runtimeVerified`
is always false: setup only checks installation completion and static config
references. Start the bridge entrypoint and use `doctor --strict` for live
verification. Existing flavor/bootstrap behavior may need manual adaptation.

Maintainers: `pnpm --filter @fliwright/cli build` bundles the source automation
Skills into `dist/skills`, included by the npm package's `dist` file selection.
Regenerate CLI command docs before the final build so packaged references match
the installed command schema. The package smoke test exercises an extracted
tarball and checks that installer stdout cannot corrupt `--json`.

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

- `run` and `script <file>` execute finite Vitest runs. Attach with `--vm-url` or launch with `--device-id`; managed apps stop afterward unless `--keep-app-alive`. `--junit-output` is independent of JSON output. Test-attempt fixtures own endpoint leases and named scenario preparation, including retries. With native automation enabled, the supervisor creates its control channel before any app launch; the first selected attempt prepares the device and receives its fresh verified endpoint. Statically skipped tests do not launch an app or require an initial VM URL. Attach and ordinary Flutter managed runs retain initial endpoint acquisition.
- `record --duration <seconds>` captures bounded recordings. Test readiness still requires deterministic scenario/assertion/replay evidence.
- `app` provides status, snapshot, find, observe, interact, screenshot, source-map, diagnostics, reload and debug-snapshot. Screenshots are files. Snapshot refs are opaque handles tied to the running app/isolate; reacquire them after restart.
- `scenario` lists, resolves, applies or resets named project scenarios. Business authentication uses app-owned auth seeding.
- `mock` lists the file catalog, reads Flutter routes/calls, applies one named rule, clears calls or resets routes/history/passthrough.
- `artifacts` reads reports, failures and timelines offline, diagnoses agent-visible failures and exports portable evidence. Select testId/attemptId when a run has multiple timelines.
- `artifacts report --plan .fliwright/test-plans/128/plan.bound.json --output artifacts/release-review.html` generates an offline release review report grouped by GitLab Item and saves a reusable review manifest alongside HTML. An existing manifest can be supplied with `--review` instead. Missing build metadata remains visible as a release blocker. Add `--require-qualified` as a CI prerequisite to release: unqualified tests exit 1 after the report is saved. Existing output files are never overwritten.
- `flow` provides recording-derived flows, test generation, runtime/Figma capture and review reports. Figma's external MCP remains a valid design input.
- `generate-test` and `tdd validate-spec` work offline. `tdd cycle --file ...` runs one finite CI cycle.

## Release test review

Use the [`gitlab-test-plan` Skill](../../.agents/skills/gitlab-test-plan/SKILL.md)
to generate a test plan: it prioritizes the Item's acceptance checklist and uses
requirements as a fallback only when no checklist exists. The separate
[`@fliwright/test-plan`](../test-plan/README.md) helpers fetch sources, validate
acceptance references/coverage and record bindings. The current AI session
designs the cases; the helpers do not invoke AI. Case IDs connect criteria,
automation files and complete runner titles to real execution evidence.

The release review manifest references the complete bound plan. `plan` resolves
relative to this manifest:

```json
{
  "runId": "RUN_ID",
  "release": {
    "app": "My App",
    "version": "2.8.0",
    "build": "20800",
    "commit": "TESTED_COMMIT",
    "platform": "iOS",
    "environment": "staging"
  },
  "plan": "test-plan.bound.json"
}
```

All fields are required. Missing, unbound, ambiguous, skipped, interrupted,
failed or unlinked tests, unresolved requirement questions, uncovered acceptance criteria, Items without cases,
runner errors, expected-failure acceptance cases, incomplete/disabled evidence,
inconsistent summaries, or a different runId prevent qualification. A run without
a review manifest cannot qualify. Successful retries retain the full attempt history.

```sh
fliwright artifacts report RUN_ID --runs-root artifacts/runs \
  --review .fliwright/release-review.json \
  --output artifacts/release-review.html --allow-partial --require-qualified --json
```

If no review manifest exists, pass `--plan .fliwright/test-plans/128/plan.bound.json`
instead of `--review`. The command writes `release-review.review.json` next to
the HTML and returns its `reviewPath`. It includes all planned cases even when
bindings, execution results or release metadata are missing. Unknown release
fields may be omitted; `missingReleaseFields` lists them and blocks release.

Use `run --release '{"app":"My App","version":"2.8.0","build":"20800","commit":"TESTED_COMMIT","platform":"iOS","environment":"staging"}'`
to retain confirmed build identity with actual execution results, including
failed runs and exported `report.json`. Reports reuse that identity and block
conflicting review metadata. The CLI does not infer it from the checkout or
independently verify which binary was installed.

The gate exits 0 only when `data.releaseReady` is true; otherwise it saves the
report and exits 1 with blockers. A partial report never qualifies. The HTML
needs no server and prints all cases even when the screen is filtered. It shows
GitLab source snapshots and their read/update times; report generation does not
refresh GitLab. Human reviewers must confirm requirement coverage, the tested
build and commit, and approve release separately. Report generation does not
publish the App.

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

`FLIWRIGHT_SESSION` selects a project session for app and persistent workflow commands. Offline artifact/schema queries and finite run/script/record commands remain independent. Connection workers serialize commands, retain TDD ownership until real execution settles, and release endpoint control before Vitest forks acquire it. Worker startup is bounded at 30 seconds for attach and 180 seconds for a managed launch; an explicit command deadline can shorten it. Workers expire after 30 minutes of inactivity. Runtime control and operation journals live under `~/.fliwright/<project-path>/sessions/`, outside the working tree. The project identifier replaces every slash in its complete path with `-`.

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

Runtime data defaults to `~/.fliwright/<project-path>/`: `runs/` for reports and
evidence, `cache/` for reusable/inspection data, `recordings/` for raw captures,
and `reviews/` for design review output. Set `FLIWRIGHT_RUNTIME_ROOT` for the
whole local project partition, or configure `runsRoot`, `cacheRoot`, and
`paths.recordings` in `fliwright.config.ts` independently. `FLIWRIGHT_RUNS_ROOT`
and `FLIWRIGHT_CACHE_ROOT` override those project settings. Explicit invocation
options have highest priority. Relative paths use the project root and `~/`
expands to the current user's home. Authored tests, scripts, rules and Flow
files stay in the project. Existing data is preserved without automatic migration.


The `@fliwright/cli/run` export also provides `withFlutterAndroidApk` for owned
Android Debug builds. It validates the app entry and build arguments, reads
Flutter's build directory, bounds tool output and process-group lifetime, and
passes a private APK plus its SHA-256 to a callback. It performs no device work.
Managed native Android emulator runs now build and install on their first actual
attempt, then relaunch the same verified installation without flutter run. Set
`native.tools.apkAnalyzer` to the local Android SDK analyzer executable. This
installed-app path rejects keepAppAlive and requires a dedicated emulator for a
new installation; physical Android and iOS keep their existing launcher.
The child independently reads installed APK/UID/PID and the complete expected permission set before executing any test body, records sanitized readback metadata and repeats this for retries. Ordinary attempts currently prepare an empty permission declaration; nonempty permission scenarios remain gated until declaration integration and platform acceptance.
