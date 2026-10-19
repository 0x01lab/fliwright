# Durable device ownership and immutable cloud evidence

- Status: accepted
- Date: 2026-10-19
- Scope: cloud queue, Mac worker, CLI process supervision and portable reports
- Evidence: `packages/fliwright-cloud/tests/queue.test.ts`, `packages/fliwright-cloud/tests/processes.test.ts`, `packages/fliwright-cloud/tests/reports.test.ts`, `docs/superpowers/plans/2026-10-18-team-cloud-platform.md`
- Supersedes: none
- Changed-Files: `packages/fliwright-cli/src/commands/run.ts`, `packages/fliwright-cli/src/run.ts`, `packages/fliwright-cloud/src/CloudClient.ts`, `packages/fliwright-cloud/src/CloudStore.ts`, `packages/fliwright-cloud/src/ReportStore.ts`, `packages/fliwright-cloud/src/WorkerAgent.ts`, `packages/fliwright-cloud/src/config.ts`, `packages/fliwright-cloud/src/contracts.ts`, `packages/fliwright-cloud/src/executor.ts`, `packages/fliwright-cloud/src/index.ts`, `packages/fliwright-cloud/src/main.ts`, `packages/fliwright-cloud/src/processes.ts`, `packages/fliwright-cloud/src/server.ts`, `packages/fliwright-cloud/src/web/app.tsx`, `packages/fliwright-cloud/src/worker.ts`, `packages/fliwright-cloud/package.json`, `packages/fliwright-cloud/tsconfig.json`, `packages/fliwright-cloud/src/web/Replay.tsx`, `packages/fliwright-cloud/src/web/TimeTimeline.tsx`, `packages/fliwright-cloud/src/web/replay-model.ts`, `packages/fliwright-cloud/src/web/ui.tsx`, `packages/fliwright-cloud/src/web/style.css`

## Automatically Collected Evidence

### Source Changes

- `packages/fliwright-cli/src/commands/run.ts`
- `packages/fliwright-cli/src/run.ts`
- `packages/fliwright-cloud/src/CloudClient.ts`
- `packages/fliwright-cloud/src/CloudStore.ts`
- `packages/fliwright-cloud/src/ReportStore.ts`
- `packages/fliwright-cloud/src/WorkerAgent.ts`
- `packages/fliwright-cloud/src/config.ts`
- `packages/fliwright-cloud/src/contracts.ts`
- `packages/fliwright-cloud/src/executor.ts`
- `packages/fliwright-cloud/src/index.ts`
- `packages/fliwright-cloud/src/main.ts`
- `packages/fliwright-cloud/src/processes.ts`
- `packages/fliwright-cloud/src/server.ts`
- `packages/fliwright-cloud/src/web/app.tsx`
- `packages/fliwright-cloud/src/worker.ts`

- `packages/fliwright-cloud/src/web/Replay.tsx`
- `packages/fliwright-cloud/src/web/TimeTimeline.tsx`
- `packages/fliwright-cloud/src/web/replay-model.ts`
- `packages/fliwright-cloud/src/web/ui.tsx`
- `packages/fliwright-cloud/src/web/style.css`

### Dependency Or Framework Changes

- `packages/fliwright-cloud/package.json`
- `packages/fliwright-cloud/tsconfig.json`

## Decision

An expired execution lease fences writes and quarantines the device; it does not prove the old executor stopped. A worker retains a durable local slot/process journal and releases the slot only after verified process termination and device reset. PID reuse or ambiguous process identity must fail closed. Cancellation first signals the executor so it can persist partial evidence, then the supervisor reaps its owned process group. A runner started under that supervisor inherits the group; standalone CLI execution continues to own an isolated group.

Record the observed test verdict before publication and cleanup so a later lease loss cannot erase the business result. Publication and cleanup remain separate from that verdict; CI success requires a published report for the latest platform attempt and clean cleanup.

Immutable report bundles use schema-owned artifact references rather than treating arbitrary business JSON path fields as capabilities. Validate sizes, hashes, paths and attempt identities before atomic directory publication, then reconcile the database index. Reserve storage at publication creation; uploading the reserved files must not count the reservation twice. Historical reports must remain readable without the original checkout, including after an offline database-plus-files restore.

Report replay uses a shared elapsed clock from recorded timeline timestamps; nested durations must not be summed. Unknown starts stay inspectable in the step list, unknown ends remain incomplete, and a recorded zero duration stays distinct from missing timing. Safe shared timelines preserve `startedAt`/`endedAt` so team and share views use the same evidence-based time axis.
