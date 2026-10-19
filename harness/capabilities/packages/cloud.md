---
package: "@fliwright/cloud"
path: "packages/fliwright-cloud"
source_fingerprint: "536f689a09857ac6f745fbd77c7f141601c448223af846f85a1d075bd99cd5fa"
generated: true
---

# Cloud Capabilities

## Responsibility

Own self-hosted team execution scheduling, durable leases, registered targets, workers and immutable report delivery.

## Boundary

### May Depend On

- `@fliwright/core`
- `@fliwright/cli`
- `@fliwright/tdd`

### Must Not Own

- `automation primitives`
- `Flutter bridge protocol`
- `public video transport`

## Owned Capabilities

- `team test queue`
- `Mac execution worker`
- `browser reports and sharing`

## Package Entrypoints

- `.`

## Binary Entrypoints

- `fliwright-cloud`

## Public Exports

- `CloudClient`
- `CloudServerOptions`
- `CloudStore`
- `createCloudServer`
- `createWorker`
- `ExecutionResult`
- `GitLabGateRequest`
- `passesGitLabGate`
- `ReportStore`
- `ReportView`
- `retrySpool`
- `Role`
- `safeArtifactPath`
- `WorkerAgent`
- `WorkerAgentOptions`
- `WorkerDependencies`

## Source Anchors

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
- `packages/fliwright-cloud/src/web/Replay.tsx`
- `packages/fliwright-cloud/src/web/TimeTimeline.tsx`
- `packages/fliwright-cloud/src/web/app.tsx`
- `packages/fliwright-cloud/src/web/replay-model.ts`
- `packages/fliwright-cloud/src/web/ui.tsx`
- `packages/fliwright-cloud/src/worker.ts`
