# Fliwright Plugin Smoke Tests

Run these in a new Codex task after `pnpm plugin:reload`. Each prompt should
trigger the expected skill or MCP surface without extra explanation from the
user.

## Test Authoring

Prompt:

```text
Use Fliwright to write a timeline-aware Flutter login regression test.
```

Expected:

- `write-fliwright-tests` triggers.
- The agent inspects nearby tests and project config before choosing a file
  location.
- The result uses `@fliwright/vitest`, stable locators, `flow.step`, and
  timeline-aware `expect(locator, title?)`.

## Mock Rules

Prompt:

```text
Add a Fliwright mock rule for POST /api/v1/login with success and invalid-password scenarios.
```

Expected:

- `write-fliwright-mock-rules` triggers.
- The agent writes `.fliwright/mocks/api/*.json` and updates
  `.fliwright/mocks/mock-index.json` only when needed.
- Repeated endpoint fields use `baseRule`; absent inherited response fields use
  `removeBodyFields`.

## MCP Core

Prompt:

```text
Connect to the running Flutter app and tell me what is visible on the current screen.
```

Expected:

- The Fliwright MCP server is available.
- The agent can use connection/snapshot style tools such as
  `fliwright_connect`, `fliwright_snap`, or `fliwright_debug_snapshot`.
- If no VM Service URL is available, the agent reports that clearly.

## MCP Development Profile

Prompt:

```text
Record the current Flutter login flow and turn it into a cleaned Fliwright test draft.
```

Expected:

- The plugin profile exposes development tools such as `fliwright_record`.
- If the MCP server is configured with the `core` profile, the agent should
  explain that recording requires the `development` or `full` profile.
- Generated code is treated as a draft and cleaned before being considered
  commit-ready.

## Flow Review

Prompt:

```text
Create a review plan for the checkout Fliwright flow and its Figma bindings.
```

Expected:

- A flow-focused skill or workflow triggers.
- The agent uses `.fliwright/flows/*.flow.json` as the source of truth.
- The MCP profile exposes `fliwright_flow_*`, or the agent explains that the
  `flow` or `full` profile is required.

## TDD Loop

Prompt:

```text
Start a Fliwright TDD cycle for the focused counter test after a Dart source change.
```

Expected:

- `fliwright-tdd` triggers.
- The agent uses a red/green loop and focused rerun workflow.
- The MCP profile exposes `fliwright_tdd_*`, or the agent explains that the
  `tdd` or `full` profile is required.
