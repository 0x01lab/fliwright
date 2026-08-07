# DevAssist V1 Design

**Status:** Proposed

## Purpose

DevAssist V1 makes Fliwright a local development-verification partner. An external AI coding agent supplies an optional natural-language request such as "verify that Home can open Markets and return Home". Fliwright derives a focused test intent from that request, the workspace change, existing tests, source semantics, and runtime state; generates and runs a temporary candidate test; returns auditable failure evidence; and reruns the same candidate after the agent edits source.

The first real acceptance target is the existing, side-effect-free Exio navigation flow. Cloud queue work is explicitly out of scope for this slice.

## Existing Foundation

- `@fliwright/tdd` already owns persistent focused reruns, baseline reset, automatic reload/restart, failure context, and bounded runtime-only repair.
- `@fliwright/core` already owns `AiRuntime`, provider-neutral adapters, `TimelineRecorder`, `TimelineArtifactStore`, and shared automation models.
- `@fliwright/mcp` already exposes TDD, run, failure, diagnosis, and timeline tools.
- `@fliwright/vitest` already persists one `timeline.json` and linked artifacts for each test run.

DevAssist composes these capabilities. It does not introduce a second assertion library, a second Trace format for individual tests, or a source-editing agent.

## Scope

### In Scope

- One MCP workflow: `fliwright_devassist_cycle`.
- Optional natural-language `request`, with user intent taking precedence over code-only inference.
- `ChangeSetSnapshot` from the Git working tree by default, with explicit files or baseline as an override.
- AI-assisted `TestIntentInference`, using existing `AiRuntime` and its Codex, Claude, or custom CLI adapters.
- A generated, executable candidate test under `.fliwright/generated/`.
- A stable `devAssistSessionId` for source-edit and rerun loops.
- Automatic reload/restart selection through the existing TDD strategy, with at most one restart escalation.
- Automatic one-shot passive diagnosis for a red result.
- A session-level `DevAssistTrace` that links existing per-test timelines and artifacts.
- A live Exio acceptance test using a controlled navigation defect.

### Out of Scope

- Fliwright editing business source files or automatically committing tests.
- Automatic replacement of a failed candidate with a different test intent.
- Screenshot or vision-based pass/fail verdicts; assertions remain the only verdict source.
- A cloud queue, web dashboard, device farm, or SaaS control plane.
- A new model provider or hosted model service.

## Workflow

### First Cycle

```text
DevAssistRequest + workspace
  -> ChangeSetSnapshot
  -> TestIntentInference via AiRuntime
  -> validate selectors and SupportedAssertions
  -> write GeneratedTestCandidate
  -> TddRuntime cycle with automatic sync
  -> per-test timeline.json and artifacts
  -> optional passive diagnosis when red
  -> DevAssistTrace + structured MCP result
```

The request is optional. When present it is the primary behavior to verify. When absent or incomplete, source change evidence, existing tests, source semantics, and a bounded runtime snapshot may complete the inference.

### Follow-up Cycle

The external coding agent edits source, then calls the workflow with the prior `devAssistSessionId`. Fliwright captures a fresh `ChangeSetSnapshot`, reuses the exact candidate test and assertions, selects reload or restart, and reruns it. A green result therefore proves the original inferred behavior, rather than a newly selected easier test.

### Regeneration

If the candidate no longer compiles, validates, or resolves its intended target after a structural change, the workflow returns `needs_regeneration`. It includes evidence but does not change the test intent. The agent must explicitly request regeneration.

## MCP Contract

```ts
interface DevAssistCycleInput {
  request?: string;
  devAssistSessionId?: string;
  action?: 'start' | 'continue' | 'regenerate';
  files?: string[];
  baseRevision?: string;
  vmServiceUrl?: string;
  deviceId?: string;
  projectId?: string;
  target?: string;
}

type DevAssistStatus =
  | 'green'
  | 'red'
  | 'needs_review'
  | 'needs_regeneration'
  | 'blocked';

interface DevAssistCycleResult {
  status: DevAssistStatus;
  devAssistSessionId?: string;
  devAssistTracePath?: string;
  timelinePath?: string;
  timelineNodeId?: string;
  candidateTestPath?: string;
  changeSet?: { baseRevision?: string; files: string[]; hash: string };
  sync?: { decision: 'none' | 'reload' | 'restart'; escalation?: boolean };
  diagnosis?: unknown;
  nextCall?: DevAssistCycleInput;
  reason?: string;
}
```

`start` creates a session and requires no test-file input. `continue` requires a session and cannot alter its test intent. `regenerate` is the only operation allowed to replace an invalid candidate. Existing `fliwright_tdd_*`, `fliwright_run`, `fliwright_get_failure`, and `fliwright_timeline_get` remain public low-level tools.

## Candidate Eligibility

A candidate is generated and run only when Fliwright can produce a typed test using supported selectors and `SupportedAssertion`s, with no unapproved side effect. Otherwise the workflow returns `needs_review` with the missing evidence or unsupported assertion. The model's self-reported confidence is never by itself an execution authorization.

Candidate files are temporary and stored under `.fliwright/generated/`. The workflow never writes a project test file, commits code, or promotes a candidate; the external coding agent reviews and promotes a useful test through the normal pull-request workflow.

## Trace And Artifacts

Existing `timeline.json` remains authoritative for a single candidate-test execution. `DevAssistTrace` is a lightweight session manifest that references, rather than copies:

- the request and `ChangeSetSnapshot` summaries/hashes;
- structured `InferenceEvidence`, model/provider identity, and prompt-template version;
- candidate-test hash and validation result;
- every cycle's sync decision, result, timeline path, artifacts, and diagnosis.

It must not contain hidden model reasoning, unredacted duplicated source context, or copied screenshots/snapshots. The high-level result identifies the latest timeline and failure node so `fliwright_timeline_get` continues to power detailed investigation and Flow generation.

## Ownership

| Package | Responsibility |
| --- | --- |
| `@fliwright/core` | Shared DevAssist data schemas, ChangeSet/Trace serialization, AI structured-output schemas, and Timeline artifact references. |
| `@fliwright/tdd` | Session coordinator, candidate lifecycle, inference orchestration, TDD runtime invocation, session persistence, and outcome mapping. |
| `@fliwright/mcp` | `fliwright_devassist_cycle` input/output schema and thin adapter to `@fliwright/tdd`. |
| `@fliwright/cli` | Optional local command that adapts the same coordinator; no separate workflow logic. |
| `@fliwright/vitest` | Existing candidate-test execution and per-test Timeline integration; only additive configuration if generated paths need explicit discovery. |

No bridge protocol change is required for V1.

## Acceptance

Using Exio and a live Flutter VM Service:

1. Introduce a small, controlled defect in the Home-to-Markets navigation behavior or its stable key.
2. Invoke `fliwright_devassist_cycle` with a natural-language request for the navigation behavior.
3. Verify that Fliwright produces and runs a candidate test, returns a red result with an existing timeline and failure evidence, and writes a session DevAssistTrace.
4. Let an external coding agent repair the Exio source.
5. Continue the same session and verify automatic reload/restart selection, green result, and two linked test timelines in the DevAssistTrace.
6. Confirm no screenshot determines the verdict and no project test file is modified automatically.

## Verification

- Core tests for data schemas, redaction, ChangeSetSnapshot, InferenceEvidence, and DevAssistTrace serialization.
- TDD tests for start/continue/regenerate lifecycle, candidate eligibility, stale-candidate detection, sync propagation, and one-shot diagnosis.
- MCP contract tests for schemas and status mapping.
- CLI adapter tests if the optional command ships in V1.
- A live Exio smoke run for the acceptance sequence above.
