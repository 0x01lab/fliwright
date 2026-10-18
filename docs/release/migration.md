# Migrating to the CLI-first Developer Preview

This guide covers migration from earlier Fliwright pre-release snapshots to
the current product surface. Fliwright remains a Flutter-specific white-box
E2E runtime; the change is which adapter owns the public workflow.

## Required environment changes

- Use Node.js 22.12+ (22.x), 24.x, or 26+ and Vitest 5.0.5.
- Install `@fliwright/cli` and `@fliwright/vitest` for the normal test path.
- Keep `fliwright_bridge` behind a dedicated debug or test Flutter entrypoint.
- Remove `@fliwright/mcp` and its MCP host configuration. Install the bundled CLI workflow Skills.
- Import Design QA from `fliwright_design_qa`; it is no longer exported by the
  base bridge.

## Vitest 5 migration

- Pin Vitest to `5.0.5` across consumer projects and use a supported Node version.
- Custom runner subclasses import `TestRunner` from `vitest`; reporter types
  import from `vitest/node`. The former `vitest/runners` and `vitest/reporters`
  entrypoints have been removed.
- Replace `test.sequential(...)` with `test(..., { concurrent: false }, handler)`.
- Mocks are cleared before each test by default. Assert calls in the same test
  that performs them instead of depending on a previous test's call history.
- The JSON reporter writes to a file by default. External runners should set
  `--outputFile` and read that file; stdout contains the report location.

## Surface migration

| Earlier workflow | Current workflow |
| --- | --- |
| MCP server and tool profiles | Project-local CLI plus bundled Skills; discover commands with `fliwright schema --json`. |
| `fliwright_connect` / `fliwright_status` | `app status`, or explicit `session open` for a persistent connection. |
| snap / find / observe / tap / type / action | `app snapshot`, `app find`, `app observe`, `app interact`. |
| screenshots as inline base64 | `app screenshot --output <file>` returns the image path. |
| mock tools | `mock list`, `mock status`, `mock calls`, `mock apply`, `mock clear-calls`, `mock reset`. |
| run / failure resource / timeline tools | `run --json`, `artifacts show`, `artifacts failures`, `artifacts timeline`, `artifacts diagnose`. |
| persistent TDD tool state | `session open` then `tdd start/focus/cycle/stop --session <id>`. |
| unbounded recording | `record --duration <seconds>` for CI and automated captures. |
| `--reporter ai-json` | `--json`; read the result from `data` in the versioned envelope. |
| `mock:start` | `mock start`. |
| Flow review bundle `fliwrightMcp` | Version 2 bundle `fliwrightCli`; external `figmaMcp` remains. |

## CI and cancellation

Use finite `run`, `script`, or `tdd cycle --file` commands. Combine `--json` with
`--junit-output <file>` and retain the run root in an always-run artifact step.
Test/review failures exit 1; usage errors 2; runtime failures 3; workflow conflicts
4; deadlines 5; cancellation 130. JSON errors retain available evidence in `data`.
`--deadline` requests cancellation and waits for owned work to settle.

Named scenarios prepare every fixture attempt, including retries. Authenticated
business tests use app-owned auth seeding. Endpoint control phases release their
lease before Vitest forks acquire it.

## Compatibility policy

The MCP package, server configuration and deprecated aliases have been removed.
There is no compatibility server. Update agent configuration and shell scripts
to the current command schema. Snapshot refs are opaque app/isolate handles;
reacquire after app restart. Session operations have durable IDs: inspect status
after a lost response before retrying a mutation.
