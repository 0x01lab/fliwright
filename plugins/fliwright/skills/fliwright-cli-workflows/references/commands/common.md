---
purpose: Shared CLI invocation, result and recovery conventions
---

# CLI conventions

Use the project’s installed executable: pnpm exec fliwright or npx --no-install fliwright. Examples abbreviate this as fliwright. Run from the target project root, or set --cwd explicitly. Read only the relevant pages in the [command index](./index.md).

## Common options

| Flag | Meaning |
| --- | --- |
| --cwd <directory> | Project root for config, sessions and project-relative inputs. Keep it consistent across session calls. |
| --json | Emit one versioned JSON envelope on stdout. Progress goes to stderr. |
| --input <file> | Read a JSON object with camelCase command-specific keys. - reads stdin. The file is resolved from cwd. |
| --deadline <ms> | Positive integer millisecond budget for the whole command; owned cleanup may take longer. |
| --session <id> | Reuse a project-local connection worker for supported commands. Falls back to FLIWRIGHT_SESSION. |
| --help | Show generated command usage without execution. |

Positional fields such as script file, scenario name and flow id can instead be supplied in the input JSON. They are not flags. Unknown fields and duplicate fields supplied through both CLI and JSON are rejected. Common options belong on the CLI, not inside --input JSON. Boolean flags accept an omitted value (true), true or false; do not invent --no-* flags. Array flags can be repeated or accept a JSON array. Prefer --input for nested objects and arrays of objects. Do not pass a CLI envelope as input: extract the command’s data and construct its expected input object.

--cwd does not uniformly rebase every explicit path: some Flow output/input paths are passed directly to filesystem APIs. When executing from outside the project, use absolute explicit paths as well as --cwd. source and snapshot generation fields contain content, not paths. All time budgets are milliseconds except record --duration, which is seconds.

Discover the installed surface with fliwright schema --json. Inspect a command with fliwright schema app.interact --json. The input schema is strict. The output schema covers the outer envelope, with an open command-specific data value; it is not a complete result type validator. The documentation describes useful result fields, not an exhaustive machine result schema.

## JSON result

```json
{"schemaVersion":1,"command":"app.snapshot","requestId":"REQUEST_ID","operationId":"OPERATION_ID","ok":true,"data":{"snapshot":"...","refs":[]}}
```

operationId exists for commands routed through a connection worker, and is the recovery key. Failure has ok:false and error:{code,message,retryable:false}; data may still contain important evidence. Some successful commands return no data. Check process exit code and ok, then command-specific readiness/partial/status fields. For example, doctor without strict, a draft recording, partial debug capture, or a blocked DevAssist result can complete without demonstrating the intended business success.

## Exit codes and recovery

| Code | Meaning | Next action |
| --- | --- | --- |
| 0 | Command completed | Inspect command-specific status, readiness and completeness. |
| 1 | Test, spec validation or review failed | Keep data/artifacts; inspect failures, missing targets or invalid spec issues. |
| 2 | Invalid input | Inspect schema and conditional requirements; correct input before rerunning. |
| 3 | Execution/environment unavailable | Inspect error and retained evidence; check doctor, endpoint and provider availability. |
| 4 | Workflow conflict | Check session/runtime state, version and endpoint ownership. |
| 5 | Deadline exceeded | Query operation status and inspect artifacts; increase budget only after understanding the outcome. |
| 130 | Cancelled | Inspect final operation state and evidence before retrying. |

SIGINT/SIGTERM request cancellation. Recording’s first SIGINT is a graceful stop/flush; a second interrupts finalization. A session cancellation acknowledgement is not final completion. After a lost response, use session status --session "$SESSION_ID" --operation-id <operationId> --json. Do not replay an uncertain app mutation automatically. The worker’s queue prevents concurrent mutation while owned work settles.

## Connection and TDD lifecycle

```sh
fliwright session open --vm-url "$VM_URL" --json
# Set SESSION_ID to data.sessionId from the result.
fliwright app snapshot --session "$SESSION_ID" --json
fliwright tdd start --session "$SESSION_ID" --json
fliwright tdd focus --file .fliwright/tests/counter.test.ts --session "$SESSION_ID" --json
fliwright tdd cycle --sync reload --session "$SESSION_ID" --json
fliwright tdd stop --keep-app-alive true --session "$SESSION_ID" --json
fliwright session close --session "$SESSION_ID" --json
```

A managed session open --device-id DEVICE_ID starts its TDD runtime automatically: skip tdd start. Attach sessions require tdd start for persistent focus/cycle. Sessions are local retained connections, not canonical run identities. run/script/record use finite drivers and do not route through --session. Offline schema, local catalogs and artifact queries do not need a session. A session-routed command cannot replace the worker’s vmUrl/deviceId. Use session close when finished.

Use named composed TestScenario declarations for repeatable environments. Authenticated business tests seed app-owned auth state through auth.seedLoggedIn. run --scenario applies setup before every attempt/retry; manually applying a baseline is useful for exploration but does not replace fixture setup. Strict startup isolation requires managed launch plus app-side waiting bootstrap.

## CI evidence

```sh
fliwright run --vm-url "$VM_URL" --scenario logged-in --json \
  --junit-output artifacts/junit.xml --runs-root artifacts/runs \
  --output artifacts/report.json --deadline 180000
```

Run root precedence is explicit --runs-root, project config, FLIWRIGHT_RUNS_ROOT, then ~/.fliwright/projects/<project-key>/runs. Offline queries ensure that directory and default project metadata exist. The CI example uses an explicit root for portable upload.

The named scenario and test selectors must exist in the target project. Use --device-id with a bridge-enabled target instead of --vm-url for an owned launch. Preserve the runner exit code. Upload artifacts/runs, report.json and junit.xml in an always-run CI step, including failed/cancelled runs; artifact finalization can itself fail, so retain any paths supplied in data. --output is JSON, --junit-output is XML. Investigate offline with artifacts show/failures/timeline using the same --runs-root; select testId and attemptId when multiple attempts exist.
