# CLI-only Agent Workflows

**Date:** 2026-10-16

**Status:** Historical proposal; superseded for this migration by [Skill + CLI + CI consolidation](2026-10-17-skill-cli-consolidation-design.md), reassessed against `45e3f14` on 2026-10-18. Source behavior and the updated design take precedence, including run artifacts, recording ownership, removed failure-context environment variables, and endpoint lease handoff.

**Decision scope:** Remove the MCP package and expose its user-facing workflows through `@fliwright/cli`.

## 1. Goal

Make `fliwright` the only Fliwright agent/operator interface. Every useful
runtime, test, diagnostic, generation, and workflow capability currently
reachable through MCP must have a deterministic CLI command and structured
result. Remove the MCP server, tool/resource protocol, profiles, package, and
install path. Agents call the CLI through their shell integration.

This moves product capabilities, not MCP itself: do not recreate tool
discovery, resource URIs, profile negotiation, or a second RPC protocol inside
the CLI. Keep automation semantics in `@fliwright/core` and `@fliwright/tdd`;
the CLI parses arguments, owns process lifecycle, and renders results.

## 2. Current CLI Review

The CLI already provides a broad but uneven surface:

| Area | Current commands |
| --- | --- |
| Project and test execution | `init`, `doctor`, `run`, `record` |
| Live app | `app status`, `observe`, `interact`, `screenshot` |
| Deterministic state | `scenario list/apply/reset`, `mock start/list/status/apply/clear/calls` |
| Run evidence | `artifacts show/export` |
| Labs | `flow` (11 commands), `tdd cycle/sync/status` |
| MCP lifecycle shim | `mcp config/doctor/serve`, which only launches `fliwright-mcp` |

The app, scenario, mock, recording, run, and report workflows already have
useful CLI implementations. The MCP default profile mostly composes those
operations. `flow` also has CLI coverage for 11 of its 13 tool contracts. The
large remaining gaps are specialist diagnostics, general test generation,
timeline/failure inspection, and the persistent TDD workflow.

Current constraints that matter to this design:

- Each `app` command creates a driver, connects, performs one operation, and
  disposes the driver. There is no persistent general app session.
- MCP `ServerState` keeps a driver, last run/failures, VM URL, TDD runtime, and
  TDD workflow context for the lifetime of its server process.
- CLI `tdd cycle` starts and stops a `TddRuntime` for one cycle. It cannot
  implement MCP's start/focus/cycle/repair/reconnect sequence across separate
  shell invocations by reading the status JSON alone.
- `fliwright app interact` already unifies tap/type/navigation/wait/drag/action;
  adding one CLI command per MCP tool would duplicate the same semantic layer.
- Most command results are JSON-shaped, but JSON output is not a consistent
  contract. Several handlers always print JSON even when `--json` is absent,
  and the flag does not consistently select one documented schema.
- `packages/fliwright-cli/src/index.ts` owns registration for the broad
  command tree and is already large. New command registration should be split
  by domain.
- `FLIWRIGHT_MCP_FAILURE_CONTEXT_PATH` is used by CLI, Vitest, TDD, VS Code,
  tests, and agent documentation even though the failure artifact is a general
  Fliwright capability.

The source currently registers 55 distinct MCP tools: 8 in `core`, 21 extra in
`development`, 13 in `tdd` (including DevAssist), and 13 in `flow`. Profiles
therefore expose 8 (`core`), 29 (`development`), 21 (`tdd`), 21 (`flow`), or 55
(`full`) tools. The server also registers one latest-test-report resource.
Generated docs and older plans report lower tool counts and should be refreshed
from source during the migration.

## 3. Capability Mapping

| MCP capability | Existing CLI equivalent | Design outcome |
| --- | --- | --- |
| `fliwright_status`, `fliwright_connect` | `app status`; implicit VM discovery on each app command | Make status an ephemeral connection/handshake probe and report reachability, endpoint source, bridge version, and capabilities. Do not claim a connection remains open. |
| `fliwright_observe`, `fliwright_interact` | `app observe`, `app interact` | Keep as the default intent-level app workflow. |
| `fliwright_scenario` | `scenario list/apply/reset` | Keep; preserve named `TestScenario` resolution and app-owned auth seeding rules. |
| `fliwright_mock` | `mock list/status/apply/clear/calls` | Keep the explicit subcommands; ensure the existing combined MCP operations are expressible without hidden defaults. |
| `fliwright_record` | `record` | Keep the foreground recording workflow, Ctrl+C stop, generated code, and flow output. |
| `fliwright_run` and test-report resource | `run`, `artifacts show` | Keep durable report files as the source of truth; expose latest/by-run lookup without process-local state. |
| `fliwright_get_failure` | `artifacts show` includes failures | Add `artifacts failures` with run/test filters and concise or full JSON output. |
| `fliwright_generate_test` | `flow generate-test` only handles flow documents | Add general `test generate` for a source file, snapshot/ref input, or InteractionSpec JSON; keep `flow generate-test` as the flow-specific path. |
| `fliwright_screenshot` | `app screenshot` writes PNG and returns path | Keep file output as the CLI contract. Agent hosts inspect the path as an image; do not base64-encode large screenshots into normal JSON. |
| `fliwright_snap`, `fliwright_find` | `app observe` is only a concise filtered view | Add `app snapshot` and `app find`; preserve snapshot refs and filters. |
| `fliwright_navigate/tap/type/drag/wait/action` | `app interact <operation>` | Keep one typed operation command; fill any parameter validation gaps in its existing command/capability. |
| `fliwright_hot_reload_and_snap` | No direct app reload command | Add `app reload` with optional snapshot output. |
| `fliwright_diagnostics` | `doctor` checks environment, not live event buffers | Add `app diagnostics` with list/filter/clear and bounded listen behavior. |
| `fliwright_source_map` | None | Add `app source-map` with include/limit options. |
| `fliwright_debug_snapshot` | No aggregate command | Add `app debug-snapshot` combining route, snapshot, diagnostics, mock state/calls, failures, source map, and optional screenshot. Partial section errors remain data in the result. |
| `fliwright_timeline_get` | Run report contains timeline paths/summaries | Add `artifacts timeline` with run/node selection, artifact inclusion, and optional flow conversion. |
| `fliwright_agent_diagnose` | None | Add `agent diagnose` using an explicit failure or persisted run/timeline. |
| `fliwright_tdd_*` | `tdd cycle/sync/status` only | Expand to persistent lifecycle and workflow commands described in section 5. |
| `fliwright_devassist_cycle` | None | Add `tdd devassist-cycle` or fold the operation into a documented `tdd repair` mode; do not drop its temporary focused-test behavior. |
| `fliwright_flow_*` | CLI covers list/get/bind/spec/clean/review-plan/bundle/Figma capture/report/generate/validate | Add `flow review-capture-runtime` and `flow review-run`; retain existing commands. |

MCP-specific results have no literal CLI equivalent: image content becomes a PNG
artifact path, a resource URI becomes an artifacts command, and tool profile
selection becomes ordinary command discovery through `--help`. These are
intentional interface translations.

This direction assumes every supported agent host can run local shell commands
and inspect project files. Hosts that only accept MCP tools will no longer have
a Fliwright integration. The CLI contract should be exercised in Codex, Claude
Code, and Copilot workflows before the MCP package is removed.

## 4. CLI Interface

### 4.1 Command tree

Keep current useful names and add the missing operations under their domain:

```text
fliwright app status|snapshot|find|observe|interact|screenshot|reload|diagnostics|source-map|debug-snapshot
fliwright run
fliwright record
fliwright scenario list|apply|reset
fliwright mock start|list|status|apply|clear|calls
fliwright artifacts show|failures|timeline|export
fliwright test generate
fliwright agent diagnose
fliwright tdd start|status|focus|cycle|repair|reconnect|scenario|reload|restart|validate-spec|prepare|devassist-cycle|stop
fliwright flow list|get|bind-figma|agent-spec|clean|review-plan|review-capture-runtime|review-bundle|review-capture-figma|review-run|review-report|generate-test|validate
```

Do not retain `fliwright mcp`, `fliwright-mcp`, MCP profile environment
variables, or a replacement compatibility command. Remove the deprecated
`mock:start` alias as part of the surface cleanup rather than tying its
continued existence to the removed adapter.

Use options or JSON files for structured inputs instead of a large collection
of one-off positional arguments. For example:

```sh
fliwright test generate --spec-file .fliwright/specs/login.json --output tests/login.test.ts --json
fliwright artifacts timeline --run-id <id> --node-id <node-id> --json
fliwright app debug-snapshot --output-dir .fliwright/artifacts/debug --json
fliwright agent diagnose --run-id <id> --failure-index 0 --json
```

### 4.2 Shared result contract

All commands that support machine use accept a global `--json`. JSON mode emits
exactly one versioned result on stdout; progress and human diagnostics go to
stderr. File-producing commands return artifact paths and metadata, not file
bytes. Use a versioned envelope:

```json
{
  "schemaVersion": 1,
  "command": "app.observe",
  "ok": true,
  "data": {}
}
```

Errors use the same envelope with `ok: false` and a stable error code, message,
and optional details. Partial aggregate results (for example, one failed
section in `debug-snapshot`) remain successful data with a section error list.
Keep normal non-JSON output concise and useful to an operator.

Common options should be consistent where meaningful: `--cwd`, `--vm-url`,
`--timeout`, `--output`, and `--json`. Resolve VM URL using the existing CLI
priority chain and never persist an endpoint unless the user explicitly asks
for project config. Avoid logging credentials embedded in a URL. Validate
numbers, enum values, required combinations, and file input before connecting
to Flutter.

Long operations such as recording and persistent TDD emit optional versioned
NDJSON progress events. Ctrl+C requests graceful cancellation and cleanup.
Keep exit behavior conventional: `0` for success, `1` for an operation that
ran and failed, and `2` for invalid CLI input; preserve test failure status for
`run` and `tdd cycle`.

### 4.3 Session and references

Stateless `app` commands continue to connect, perform one operation, and close
the VM-service client. This keeps shell execution reproducible and avoids
requiring a background process for basic actions. `app status` is a live probe,
not a persistent connection claim.

Snapshot refs are stored by the Flutter bridge, not the TypeScript driver, so
an `app snapshot` followed by a separate `app interact` can work. Treat refs as
short-lived handles: return the snapshot `groupId`, document expiry on the
result, and test cross-process use and stale-ref errors. Do not assume an
in-process driver is needed to preserve them.

## 5. Persistent TDD Runtime

The TDD MCP profile owns real cross-call state: `TddRuntime`, its driver/daemon,
focused test, scenario, last result, and generation workflow context. A status
JSON file cannot reconstruct the Flutter daemon or driver. The CLI must own a
local controller process for the multi-call workflow.

`fliwright tdd start` starts a per-project daemon and waits for readiness.
Subsequent TDD subcommands send a versioned JSON request over a local IPC
channel to that daemon. The daemon owns exactly one `TddRuntime` and serializes
state-changing requests. It supports clean shutdown and reaps its Flutter
daemon/driver on stop, disconnect, or a fatal runtime error. Keep the existing
one-shot `tdd cycle` ergonomics as a command that can start, focus, cycle, and
stop within one invocation; the persistent mode is for the full TDD tool set.

The per-project runtime directory contains only a PID/lock record, IPC endpoint,
owner token, status snapshot, and logs/artifact paths. Apply user-only file
permissions; validate PID plus process identity before reusing a stale record;
never trust a socket path from an unvalidated project file. Use Unix domain
sockets on Unix and named pipes on Windows behind one internal transport
interface. Requests carry a protocol version, command, request id, and payload;
responses carry the matching id and a typed result/error. Reject concurrent
mutations with a clear busy response or queue them in arrival order.

Do not implement daemon transport in `@fliwright/tdd`: that package owns TDD
semantics, while `@fliwright/cli` owns process and command lifecycle. Keep the
daemon protocol private to the CLI package and test it with fake runtimes and
fake process/IPC adapters.

## 6. Ownership and Package Shape

The target dependency direction is:

```text
CLI command adapters -> @fliwright/cli use cases -> @fliwright/core / @fliwright/tdd
VS Code -------------> stable CLI use cases / @fliwright/core / @fliwright/tdd
```

Split the command tree into registration modules (`app`, `artifacts`, `agent`,
`tdd`, `flow`, and existing domains) so `src/index.ts` only composes commands.
Keep behavior in testable command/use-case modules with injected driver,
filesystem, AI runtime, clock, and IPC dependencies where they vary in tests.
Export a subpath only when another package has a real consumer; shell command
implementation details are not automatically public JavaScript APIs.

The CLI may own agent-oriented output shaping because it is part of the CLI
contract, but core interaction behavior remains in `@fliwright/core` or the
existing driver-agnostic capability module. Do not create an `agent` runtime
package or make core depend on CLI concepts.

## 7. Removal and Migration Inventory

Remove or update these surfaces together:

- Delete `packages/fliwright-mcp`, its bin, exports, tests, README, MCP SDK
  dependency, package-level `zod` dependency if no longer needed, and generated
  `dist` through normal build cleanup only.
- Remove the MCP workspace contract from
  `harness/architecture/dependency-rules.json` and
  `harness/stack/framework.json`; update the CLI responsibility to own agent
  command workflows, not MCP protocol semantics.
- Remove MCP package entries from workspace lock/install state, publish
  workflows, tarball verification, registry-consumer scripts, capability
  generation, CI/plugin checks, and package-count tables.
- Remove `commands/mcp.ts`, `fliwright mcp`, `fliwright-mcp`, profile settings,
  `mcpServers` setup UI, and MCP-only VS Code help text. The VS Code extension
  should invoke shared CLI use cases directly.
- Rename `FLIWRIGHT_MCP_FAILURE_CONTEXT_PATH` to
  `FLIWRIGHT_FAILURE_CONTEXT_PATH` and rename MCP-branded failure types/helpers
  across Vitest, CLI, TDD, VS Code, tests, generated docs, and bundled skills.
  Do not keep an old-name fallback in this pre-1.0 migration.
- Replace MCP workflow skills/reference pages with CLI agent workflows. Keep
  historical design/research files but mark their old decision superseded when
  this proposal is accepted; regenerate `docs/features/` rather than editing
  generated pages by hand.
- Update root README, PRD, package docs, migration/troubleshooting/publishing
  guidance, plugin manifests, release package count/version gates, and the
  capability catalog. Search the whole repo for `@fliwright/mcp`,
  `fliwright-mcp`, `FLIWRIGHT_MCP`, `mcpServers`, and MCP-only tool names before
  completion. Retain unrelated Figma MCP references only where they describe
  an external integration rather than Fliwright's removed module.

## 8. Verification and Acceptance

The migration is complete when:

- A package-level search and clean registry consumer show no published
  `@fliwright/mcp` package or `fliwright-mcp` binary.
- CLI help exposes every retained workflow and no MCP command/profile.
- Contract tests cover each MCP capability row through its CLI operation,
  including artifact content and failure behavior, not only command names.
- Separate CLI invocations can snapshot then interact using a ref, and stale
  refs produce an actionable error.
- TDD daemon tests cover startup readiness, reuse, stale locks, request
  validation, serialized mutations, child/process cleanup, cancellation, and
  reconnect after VM loss. `tdd cycle` retains deterministic one-shot behavior.
- `--json` stdout parses as one schema-versioned object for success, failure,
  timeout, and partial debug snapshots; human logs do not corrupt it.
- `FLIWRIGHT_FAILURE_CONTEXT_PATH` still produces failures, screenshots,
  timelines, and healing details for CLI runs, TDD, and VS Code.
- Existing CLI/core/Vitest/TDD/VS Code tests pass; `pnpm build`, `pnpm test`,
  `pnpm lint`, `node scripts/verify-harness.mjs`, package tarball checks, and
  registry consumer checks pass. Run the Flutter VM smoke when its endpoint is
  available.

## 9. Rollout

1. Accept this decision and update the prior product-surface record so there is
   one current architecture direction.
2. Move missing capability handlers into tested CLI use cases and commands;
   implement persistent TDD control and new artifact/generation/debug paths.
3. Establish CLI JSON, cancellation, command-registration, and capability
   contract tests while MCP still exists; switch consumers and docs.
4. Delete the MCP package and all package/CI/release/VS Code/plugin references
   in one removal change, rename the failure-context contract, then regenerate
   capability and feature docs.
5. Run workspace and packaging gates, verify the registry consumer without MCP,
   and publish the next pre-1.0 release without an MCP compatibility package.

No implementation or migration has been performed by this design proposal.
