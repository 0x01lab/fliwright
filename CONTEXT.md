# Fliwright Domain Glossary

This file captures the shared language of the Fliwright product as it evolves.
Do not put implementation details here; only definitions, boundaries, and relationships.

## Core Concepts

### DevAssistMode (AI 辅助开发模式)

An operating mode in which an external AI coding agent uses Fliwright as a test-and-validation capability provider.
Fliwright exposes planning, execution, and failure-feedback interfaces; the agent owns code editing.
Goal: close the loop between code changes and verified behavior.

### DevAssistCycle (辅助开发循环)

One local cycle in which an external AI coding agent asks Fliwright to select or create a focused test, execute it against the changed Flutter app, consume structured feedback, edit source, synchronize the app, and verify the result.
DevAssist V1 is complete only when this cycle reaches green against a controlled defect in Exio.

### DevAssistSession (辅助开发会话)

The stable identity of one local development-verification loop, created from an initial DevAssistRequest and its inferred test intent.
Subsequent DevAssistCycles reuse its GeneratedTestCandidate and assertions while recording fresh ChangeSetSnapshots until the session reaches green, is cancelled, or is explicitly regenerated.

### DevAssistTrace (辅助开发轨迹)

The session-level evidence manifest that links a DevAssistRequest, TestIntentInference evidence, GeneratedTestCandidate, ChangeSetSnapshots, and each cycle's existing test Trace.
It references existing timeline and artifact paths instead of duplicating their screenshots, snapshots, or diagnostics.

### NeedsRegeneration (待重新生成)

The non-executable session state reached when its GeneratedTestCandidate no longer compiles, validates, or resolves its intended target after a structural change.
Fliwright supplies evidence but never changes the test intent automatically; an external agent must explicitly regenerate it.

### DevAssistRequest (辅助开发请求)

A local natural-language request that states the behavior a developer wants Fliwright to verify during a code change.
It directs TestIntentInference; when omitted or incomplete, the ChangeSetSnapshot and application context may supply bounded additional intent.

### TestIntentInference (测试意图推导)

An AI-assisted derivation of the focused behavior that a source change should validate, using the change, existing tests, application semantics, and runtime context.
It combines a DevAssistRequest with the ChangeSetSnapshot, existing tests, application semantics, and runtime context to produce an evidence-backed test proposal.

### InferenceEvidence (推导证据)

The auditable facts supporting a TestIntentInference: relevant change references, application semantics, existing-test references, model and prompt-template identity, and validation outcomes.
InferenceEvidence stores summaries and hashes rather than hidden model reasoning or unsanitized duplicated context.

### GeneratedTestCandidate (生成测试候选)

An executable, temporary test generated from a high-confidence TestIntentInference under `.fliwright/generated/`.
It is automatically run for an eligible DevAssistRequest but does not become a project test asset until the external coding agent reviews and promotes it.

### ChangeSetSnapshot (变更集快照)

The reproducible summary and content hashes of source and test changes in a workspace relative to a selected baseline.
DevAssistCycle creates it from staged, unstaged, and eligible untracked files by default; the caller may explicitly set its files or baseline.

### E2EAgentMode (AI E2E 测试执行模式)

An operating mode in which a user supplies a natural-language test scenario (or a structured requirement) and Fliwright autonomously executes it against a running Flutter emulator.
Execution is prompt-driven; successful runs can be reverse-engineered into deterministic scripts.

### TestPlan (测试计划)

A structured, versionable artifact that translates a business requirement into Fliwright-executable semantics.
Produced by the Planner from an issue/requirement and app context.
Contains prerequisites, steps, screenshot checkpoints, mock-scenario bindings, cleanup/teardown rules, and failure-capture policy.

### PlanStep (计划步骤)

A single entry in a TestPlan.
May represent an action (tap, fill, navigate), an assertion (toBeVisible, toHaveText), a mock-scenario switch, or a cleanup/teardown operation.

### ScreenshotCheckpoint (截图检查点)

A planned point in a TestPlan where the system must capture a screenshot.
Semantics: `before` (pre-action), `after` (post-action/assertion), `always` (unconditional), `onFailure` (mandatory when any step fails).
A ScreenshotCheckpoint is evidence only and never determines pass or failure; the test assertion library is the sole source of verdicts.

### FailureReplayScript (失败回放脚本)

A debug-only script generated from a failed Trace, intended for local reproduction of the failure.
Distinct from a DeterministicScript: it is not committed to CI and is typically discarded once the failure is fixed.

### FailureCapture (失败捕获)

The policy and data collected when a step or test fails.
Always includes a screenshot; may also include widget tree, device logs, route state, and healing suggestions.

### SideEffectAuthorization (副作用授权)

An explicit permission in a TestPlan that allows an E2E run to perform a defined external or persistent state change.
Without it, Fliwright blocks actions such as payments, orders, outbound messages, and production-data mutations.

### TeamTestQueue (团队测试队列)

A single-tenant, self-hosted queue through which members of one team submit E2E test requests for managed execution.
It is the first cloud-platform surface and exposes submission, status, and artifact access through an API.

### ExecutionWorker (执行 Worker)

A team-operated machine that claims TeamTestQueue work and runs it against its registered Flutter build and simulator capabilities.
The initial ExecutionWorker is the team's dedicated Mac mini.

### WorkerProvisionedEnvironment (Worker 预置环境)

The operator-maintained repository access, Flutter build setup, simulator images, test accounts, and other execution configuration installed directly on an ExecutionWorker.
The first TeamTestQueue does not transmit credentials in TestRequests; it relies on this pre-provisioned Mac mini environment and suppresses configured sensitive values from RunBundles.

### WorkerReset (Worker 重置)

The restoration of an ExecutionWorker's application data, mocks, test state, processes, and temporary files before and after an ExecutionAttempt.
A WorkerReset failure makes the ExecutionWorker unhealthy and ineligible to claim further work until an operator restores it.

### ExecutionSlot (执行槽位)

The exclusive worker-and-simulator capacity assigned to one queued execution at a time.
The initial Mac mini provides one ExecutionSlot, and TeamTestQueue dispatches work in first-in, first-out order.

### ExecutionAttempt (执行尝试)

One use of an ExecutionSlot to run a TestPlan, including its independent diagnostics and artifacts.
Only an infrastructure-transient failure may create one automatic retry attempt; assertion and business failures end the request.

### PlanningObservation (规划观察)

A bounded, read-only startup of an ApplicationTarget used by the Planner to collect runtime snapshots, visible control semantics, route state, and diagnostics.
It cannot interact, navigate, type, or produce side effects, and the WorkerReset that follows it precedes any ExecutionAttempt.

### TeamRole (团队角色)

The authorization level of a TeamTestQueue user: a member submits work and reads team results, an operator manages workers and retries, and an admin manages targets, credentials, retention, and membership.
RunBundles are visible within their owning team and inaccessible to other teams.

### QueueClient (队列客户端)

An API consumer used to submit, inspect, cancel, and retrieve TeamTestQueue work.
The first QueueClient is the `fliwright` CLI; a web dashboard is a later presentation layer over the same API.

### ApplicationTarget (应用目标)

A pre-registered Flutter application and build profile that a TeamTestQueue is permitted to test.
Each queued execution selects one ApplicationTarget at an immutable Git commit SHA and a declared simulator configuration.

### TestRequest (测试请求)

A request submitted to a TeamTestQueue as natural-language requirements, a GitLab issue URL, a structured TestPlan, or an existing DeterministicScript.
Before execution, every TestRequest is normalized to a TestPlan and bound to an ApplicationTarget.

### IssueTestRequest (议题测试请求)

A TestRequest whose source of intent is a GitLab issue URL.
The control-plane Planner retrieves the issue's authorized content, records its source revision, and produces a TestPlan subject to normal validation.

### IssueSnapshot (议题快照)

The immutable issue description and relevant comments captured when an IssueTestRequest is submitted.
An IssueSnapshot is the sole issue input to its Planner run; later GitLab edits require a new TestRequest.

### NeedsInput (待补充信息)

The non-executable state of a TestRequest whose normalized TestPlan lacks required steps, assertions, target capabilities, or SideEffectAuthorization.
The request may use a PlanningObservation to collect missing runtime context, but cannot begin an ExecutionAttempt until validation succeeds.

### RunBundle (运行产物包)

The immutable evidence package for one executed TestPlan, including its request and plan, ApplicationTarget revision, worker and simulator metadata, Trace, assertions, diagnostics, screenshots, and generated scripts.
RunBundles are retained for a configurable period; DeterministicScripts promoted to source control are independent of this retention.

### SupportedAssertion (受支持断言)

An assertion supplied by Fliwright's shared assertion library and therefore available with identical verdict semantics in local and managed execution.
An outcome not expressible as a SupportedAssertion cannot be guessed or replaced with screenshot interpretation.

### Trace (执行轨迹)

A time-ordered record of an E2E run: each PlanStep executed, the actual locator resolved, the action outcome, screenshots, assertions, and any healing events.
The canonical input for reverse code generation.

### DeterministicScript (确定性测试脚本)

A generated, human-readable test script (TypeScript or Dart) produced from a Trace.
Default target language is TypeScript running under Vitest (`@fliwright/vitest`); Dart is an optional output.
Contains no LLM calls, no fuzzy planning, and no non-deterministic data unless explicitly parameterized.
Successful runs produce it as a candidate; it becomes a version-controlled CI test only after human review and promotion through a pull request.

### Planner (测试计划器)

A Fliwright component that turns parsed requirements plus app context into a TestPlan.
The managed Planner serves TeamTestQueue natural-language and IssueTestRequests, using authorized source context and PlanningObservations; external code-editing agents may use the same plan types in DevAssistMode.

## Relationships

- An IssueTestRequest supplies authorized GitLab issue content to the managed Planner.
- An IssueTestRequest is frozen as an IssueSnapshot before the Planner produces its TestPlan.
- The Planner produces a TestPlan.
- A TestPlan is executed by the E2E runner, producing a Trace.
- A TestPlan grants SideEffectAuthorization only for the external effects it explicitly declares.
- A Trace is converted into a DeterministicScript by the Codegen module.
- A passing Trace produces a candidate DeterministicScript, while a failing Trace produces only a FailureReplayScript.
- ScreenshotCheckpoints are attached to the Trace as evidence, while assertion results determine its verdict.
- A TestPlan can execute only SupportedAssertions; an unsupported requested outcome leaves its TestRequest in NeedsInput.
- A TeamTestQueue accepts a TestPlan for managed execution and retains its resulting Trace.
- A TestRequest is normalized to a TestPlan before the TeamTestQueue accepts it for execution.
- A NeedsInput TestRequest may use a PlanningObservation but cannot begin an ExecutionAttempt.
- An ExecutionWorker claims queued work, builds its ApplicationTarget at the requested commit, executes its TestPlan, and returns its Trace to the TeamTestQueue.
- An ExecutionWorker resolves ApplicationTargets through its WorkerProvisionedEnvironment rather than credentials supplied by a TestRequest.
- Every ExecutionAttempt is surrounded by a WorkerReset; an unhealthy ExecutionWorker cannot receive an ExecutionSlot.
- A WorkerReset follows every PlanningObservation before an ExecutionAttempt begins.
- A TeamTestQueue assigns one ExecutionSlot to each running TestPlan and does not share its simulator with another execution.
- A TestRequest may have at most two ExecutionAttempts when its first attempt fails transiently; both belong to its RunBundle.
- TeamRole governs who may submit, operate, administer, or read the RunBundles of a TeamTestQueue.
- A QueueClient submits and observes TestRequests through the TeamTestQueue API.
- Each completed or failed execution produces a RunBundle; the initial default retention is 30 days.
- DevAssistMode consumes the same TestPlan/Trace/DeterministicScript types, but the loop is driven by an external code-editing agent.
- A DevAssistRequest states the primary verification goal for a DevAssistCycle.
- A DevAssistCycle captures a ChangeSetSnapshot before TestIntentInference.
- A DevAssistCycle uses TestIntentInference to select or propose a focused test, then gives the external agent evidence and verification while leaving application source edits to that agent.
- A TestIntentInference produces InferenceEvidence recorded in the DevAssistTrace.
- A DevAssistSession binds the initial TestIntentInference to every subsequent DevAssistCycle until completion or explicit regeneration.
- A DevAssistSession owns a DevAssistTrace that references the Trace from each of its cycles.
- A structurally invalid GeneratedTestCandidate moves its DevAssistSession to NeedsRegeneration.
- A high-confidence TestIntentInference produces a GeneratedTestCandidate; an uncertain or non-assertable inference requires review instead of execution.
