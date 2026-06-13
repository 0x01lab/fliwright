# MCP-Assisted Workflow

When the Fliwright MCP server is connected, you can **discover** behavior, **record** a flow,
**generate** a first draft, **run** a test, and **diagnose** failures — all without leaving the
conversation. The goal is always to commit a normal `.test.ts`; MCP is the means to get there.

## Tools at a glance

| Tool | Purpose | Output |
| --- | --- | --- |
| `fliwright_connect` | Confirm the current bridge + reachability | connection / capability status |
| `fliwright_snap` | Take a semantic snapshot of the current screen | `AgentSnapshotResult` (refs) |
| `fliwright_observe` | Find widgets matching a query | matched refs |
| `fliwright_record` | Capture a live flow → first-draft code | generated TS/Dart |
| `fliwright_generate_test` | Generate a test from refs or a snapshot | `.test.ts` draft using `findRef(...)` |
| `fliwright_run` | Execute a test against the VM, full AI report | `RunResult` + artifacts |
| `fliwright_get_failure` | Read a failure's full context | assertion + tree + diagnostics + screenshot + healing |

## Typical flow

1. **Confirm bridge readiness** — `fliwright_connect`. If it reports `Unknown method
   "ext.fliwright.snap"`, the app is on an older bridge; upgrade it before proceeding (see
   [troubleshooting.md](./troubleshooting.md)).
2. **Inspect** — `fliwright_snap` / `fliwright_observe` to see what's actually on screen and find a
   stable query (role + text + key).
3. **Capture a flow** — `fliwright_record` the user path. The raw output is a starting point, not
   the final test.
4. **Generate a draft** — `fliwright_generate_test` with the captured `refs`/`snapshot`. Prefer the
   variant that emits `page.findRef(...)` queries instead of hard-coded ephemeral refs.
5. **Run** — `fliwright_run` to execute. It returns the same report shape as
   `fliwright run --reporter ai-json` (see [cli.md](./cli.md)).
6. **Diagnose** — on failure, `fliwright_get_failure` for assertion details, widget tree,
   diagnostics, the screenshot artifact, source location, and healing suggestions.
7. **Commit** — simplify selectors, replace ephemeral refs with resilient query locators, add
   assertions, write the file.

## `fliwright_run`

Executes a test file against a running VM Service and returns the full AI report (same shape as the
CLI `RunResult`). Prefer this over direct `pnpm vitest` so you get screenshots, diagnostics, and the
reproduce command.

```jsonc
fliwright_run({
  testFile: "e2e/form-mock-e2e.test.ts",
  vmServiceUrl: "ws://127.0.0.1:54321/abc=/ws",
  screenshot: "file"
})
```

The result includes `passed`, per-test `results`, optional `failures[]`, `artifacts` (runId,
outputDir, reportPath, screenshots), and `reproduceCommand`.

## `fliwright_get_failure`

After a failing `fliwright_run`, fetch the structured failure entry. This is the same `CliFailureEntry`
the CLI persists to `failures.json`:

```text
- testName
- assertion: { matcher, expected, actual, timeout }
- widgetTree            (the snapshot at failure time)
- diagnostics: VMServiceEvent[]   (recent logs/stderr)
- source: { file, line, snippet }
- screenshot: { path }            (when screenshot mode = file)
- healingSuggestion: { originalSelector, suggestedSelector, confidence, scores }
```

Use the `healingSuggestion` to upgrade your selector, and `widgetTree`/`source` to understand why a
match failed.

## `fliwright_snap` / `fliwright_observe`

Both call the bridge's `ext.fliwright.snap`. `fliwright_observe` is `fliwright_snap` scoped to a
find-query — equivalent to `page.findRef(...)` in code. Use them to:

- verify the current bridge exposes snap/ref/action,
- discover stable queries (role + text + key) for selectors you'll commit,
- confirm what's on screen before writing a selector blind.

## `fliwright_record` → `fliwright_generate_test`

```jsonc
fliwright_record({
  vmUrl: "ws://127.0.0.1:54321/abc=/ws",
  lang: "ts",
  name: "checkout flow",
  homeRoute: "/"
})

fliwright_generate_test({
  // pass the captured refs/snapshot so the draft uses findRef(...) queries
  refs: /* from record */,
  lang: "ts"
})
```

**Then clean up the generated code** (this is mandatory, not optional):

- replace ephemeral `e<N>` refs with `page.getBySemantics(...)` / `page.getByKey(...)` / `findRef(...)`,
- remove redundant exploratory clicks,
- add assertions on visible outcomes,
- remove any fixed `sleep`.

## Decision: MCP vs hand-written

| Want | Use |
| --- | --- |
| A robust, reviewed, committed test | hand-write with the fixture, optionally *informed* by MCP discovery |
| A quick "does this flow work right now?" | `fliwright_record` + `fliwright_run` |
| To understand a flaky/failing test | `fliwright_get_failure` + `fliwright_snap` |
| To teach a teammate/CI what to run | commit a `.test.ts` + a `package.json` script (see [cli.md](./cli.md)) |

MCP tools produce **drafts and diagnostics**; the committed test is always a hand-finished `.test.ts`.
