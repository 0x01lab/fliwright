# Worker Service Diagnostics Must Survive Failed Executions

- Status: accepted
- Date: 2026-10-29
- Scope: Cloud Worker service monitoring and VM verification
- Evidence: packages/fliwright-cloud-worker/tests/diagnostics-cli.test.ts, packages/fliwright-cloud-worker/tests/host-diagnostics.test.ts, packages/fliwright-cloud/tests/worker-diagnostics.test.ts, packages/fliwright-cloud-worker/tests/worker-timeline.test.ts
- Changed-Files: `packages/fliwright-cloud-protocol/src/worker-diagnostics.ts`, `packages/fliwright-cloud-protocol/src/worker-control.ts`, `packages/fliwright-cloud-protocol/src/WorkerControlClient.ts`, `packages/fliwright-cloud-protocol/src/worker-timeline.ts`, `packages/fliwright-cloud-protocol/src/contracts.ts`, `packages/fliwright-cloud-protocol/src/index.ts`, `packages/fliwright-cloud-worker/src/diagnostics.ts`, `packages/fliwright-cloud-worker/src/main.ts`, `packages/fliwright-cloud-worker/src/host.ts`, `packages/fliwright-cloud-worker/src/worker.ts`, `packages/fliwright-cloud-worker/src/device-reporting.ts`, `packages/fliwright-cloud-worker/src/executor.ts`, `packages/fliwright-cloud-worker/src/WorkerTimelineChannel.ts`, `packages/fliwright-cloud-worker/src/WorkerTimelineRecorder.ts`, `packages/fliwright-cloud-worker/src/index.ts`, `packages/fliwright-cloud/src/WorkerDiagnosticsStore.ts`, `packages/fliwright-cloud/src/CloudStore.ts`, `packages/fliwright-cloud/src/WorkerTimelineStore.ts`, `packages/fliwright-cloud/src/server.ts`, `packages/fliwright-cloud/src/index.ts`, `packages/fliwright-cloud/src/web/WorkerDiagnostics.tsx`, `packages/fliwright-cloud/src/web/app.tsx`, `packages/fliwright-core/src/VmServiceEndpoint.ts`
- Supersedes: none

## Decision

Service diagnostics must exist before an execution lease or report. Persist redacted session logs locally and report independent service heartbeats; missing heartbeats mean unreachable, not a guessed cause. Fatal JavaScript errors terminate after synchronous logging, while SIGKILL and host failures require restart evidence plus supervisor/OS logs. Supervise background promises immediately so component failure cannot silently stop inventory or catalog work. Keep device recovery and lease fencing independent of monitoring.

A specific safe failure must survive every normalization layer. Bridge protocol mismatch diagnostics retain numeric client/bridge versions through the endpoint verifier, executor, timeline recorder and Cloud store; otherwise a UI message fix is lost during persistence.
