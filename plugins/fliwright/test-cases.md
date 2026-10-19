# Fliwright Plugin Smoke Tests

Run these prompts in a new Codex chat after reloading the updated plugin. Use a
target project with Fliwright installed and a bridge-enabled Flutter app for
live checks. Examples abbreviate the project's `pnpm exec fliwright` or
`npx --no-install fliwright` as `fliwright`.

Validate skill selection and observable CLI results. Fliwright execution uses
Skills + CLI; Figma MCP is an external design integration only. If a live app
or required capability is unavailable, report that limit and run the available
static/offline checks.

## Test Authoring And Authenticated Scenarios

Prompt:

```text
Use Fliwright to write a regression test for an already signed-in user opening their account screen.
```

Expected:

- `write-fliwright-tests` triggers and the agent inspects existing tests,
  app-owned capabilities and project configuration.
- The test lives in `.fliwright/tests/`, uses stable locators and meaningful
  timeline-aware assertions, and reuses the project's support fixture.
- A named composed `TestScenario` prepares authentication through
  `auth.seedLoggedIn` and validates it with `auth.getStatus`. The agent does not
  use real login, a mocked login response, or an auth provider override as setup.
- `test.scenario(name)` or `run --scenario` selects the baseline before every
  attempt, including retries. Scenario names, routes and Keys match the app.
- A new direct Vitest setup includes `fliwrightPreset(projectConfig)`. The agent
  checks generated/edited TypeScript, then validates against the app when available.

## Mock Rules

Prompt:

```text
Add a Fliwright mock rule for POST /api/v1/profile with success and server-error responses.
```

Expected:

- `write-fliwright-mock-rules` triggers.
- The agent writes `.fliwright/mocks/api/*.json` and updates the index as needed.
- Repeated endpoint fields use `baseRule`; fields absent from an inherited
  error body use `removeBodyFields`.
- Rules pass `normalizeMockEndpointConfig`; the agent inspects installed CLI
  schema before using `mock list` or `mock apply` for further validation.

## CLI Discovery And App Inspection

Prompt:

```text
Connect to the running Flutter app and tell me what is visible on the current screen.
```

Expected:

- `fliwright-cli-workflows` triggers and reads only relevant command guides.
- The agent checks `schema --json` and relevant `schema app.*` contracts,
  then uses `app snapshot`, `app observe` or `app debug-snapshot` as appropriate.
- Repeated exploration uses `session open`, explicit `--session` and eventual
  `session close`. A single finite task can attach without a persistent session.
- The agent checks envelope `ok`, exit status and partial-result markers;
  screenshots are file artifacts and snapshot refs are not committed to tests.
- Missing VM endpoints or bridge capabilities produce a clear availability result.

## Recording And Draft Readiness

Prompt:

```text
Record a 15-second demonstration of this Flutter checkout flow and turn it into a Fliwright test draft.
```

Expected:

- `fliwright-cli-workflows` handles recording and `write-fliwright-tests` handles
  the resulting automation code.
- The agent discovers `schema record --json` and uses bounded `record --duration`.
- Recording owns a finite connection. The current app baseline is prepared before
  capture; `--scenario` describes generation/replay and does not apply it before recording.
- The agent checks readiness, issues and confirmed assertions. Generated output
  remains a draft until verification evidence supports a stronger status.

## Flow Review

Prompt:

```text
Create a review plan for the checkout Fliwright flow and its Figma bindings.
```

Expected:

- `fliwright-flows` handles the flow document and `fliwright-cli-workflows`
  supplies exact commands when needed.
- The agent uses `.fliwright/flows/*.flow.json`, validates structure and inspects
  `schema flow.review-plan --json` before creating the plan.
- A plan can be created offline. Capture/report requests use the matching
  `flow review-*` commands and inspect missing-target/completeness results.
- Figma bindings refer to real design nodes. External Figma integration is used
  only when design context is needed, with credentials kept outside flow files.

## Persistent TDD

Prompt:

```text
Start a persistent Fliwright TDD cycle for the focused counter test after a Dart source change.
```

Expected:

- `fliwright-cli-workflows` handles session/TDD execution. `fliwright-tdd` is used
  when developing Fliwright source itself; `write-fliwright-tests` applies to
  automation test edits.
- For an attached app: open a session, start TDD, focus the test and cycle.
  Managed `session open --device-id` already starts the runtime, so start is skipped.
- Commands reuse explicit `--session`; the agent reads cycle phase/status and
  evidence, then stops TDD and closes the session after the requested work.
- After an uncertain response the agent queries session status/journal before
  retrying. It requests cancellation by operation ID and checks final state.

## CI And Offline Failure Evidence

Prompt:

```text
Run the cart regression with its named scenario, save CI artifacts, and explain any failure from the saved evidence.
```

Expected:

- The agent uses finite `run --test ... --scenario ... --json`, explicit
  `--runs-root`, and separate `--junit-output` when XML is requested.
- JSON `--output` and JUnit XML remain separate; CI preserves the runner exit
  code and uploads evidence on success, failure and cancellation.
- Failure analysis uses offline `artifacts show`, `artifacts failures` and
  `artifacts timeline` with the returned runId and matching runs root.
- Multi-attempt runs select testId/attemptId; failed evidence or partial capture
  is reported rather than assumed complete. Offline queries need no app/session.
