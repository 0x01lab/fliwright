---
package: "@fliwright/cloud-worker"
path: "packages/fliwright-cloud-worker"
source_fingerprint: "a3bd2d7533954c864d32536435a00724e10ea49ef9d3e8d4caa0711b8d89ff94"
generated: true
---

# Cloud Worker Capabilities

## Responsibility

Own host device discovery and reporting, supervised test execution, cleanup and report upload. Cloud devDependency is only for network integration tests.

## Boundary

### May Depend On

- `@fliwright/cloud-protocol`
- `@fliwright/core`
- `@fliwright/cli`
- `@fliwright/tdd`
- `@fliwright/devices`
- `@fliwright/cloud`

### Must Not Own

- `server persistence`
- `browser UI`
- `central scheduling`

## Owned Capabilities

- `host device reporting`
- `test execution worker`
- `worker CLI`

## Package Entrypoints

- `.`

## Binary Entrypoints

- `fliwright-worker`

## Public Exports

- `collectCheckoutCatalog`
- `createWorker`
- `discoveryConfigSchema`
- `executeCatalogScan`
- `ExecutionResult`
- `executorSettings`
- `hostConfigSchema`
- `installLocalPackages`
- `pairWorker`
- `readWorkerTimelineLog`
- `reportWorkerDevices`
- `retrySpool`
- `runCatalogScanner`
- `runHostWorker`
- `scanEnvironment`
- `scanFailureSummary`
- `scanProcess`
- `secureCatalogCheckout`
- `SpanOptions`
- `WorkerAgent`
- `WorkerAgentOptions`
- `workerConfigSchema`
- `WorkerDependencies`
- `WorkerTimelineChannel`
- `WorkerTimelineRecorder`

## Source Anchors

- `packages/fliwright-cloud-worker/src/WorkerAgent.ts`
- `packages/fliwright-cloud-worker/src/WorkerTimelineChannel.ts`
- `packages/fliwright-cloud-worker/src/WorkerTimelineRecorder.ts`
- `packages/fliwright-cloud-worker/src/catalog-scanner.ts`
- `packages/fliwright-cloud-worker/src/config.ts`
- `packages/fliwright-cloud-worker/src/device-reporting.ts`
- `packages/fliwright-cloud-worker/src/executor.ts`
- `packages/fliwright-cloud-worker/src/host.ts`
- `packages/fliwright-cloud-worker/src/index.ts`
- `packages/fliwright-cloud-worker/src/local-packages.ts`
- `packages/fliwright-cloud-worker/src/main.ts`
- `packages/fliwright-cloud-worker/src/pairing.ts`
- `packages/fliwright-cloud-worker/src/processes.ts`
- `packages/fliwright-cloud-worker/src/worker-timeline-ipc.ts`
- `packages/fliwright-cloud-worker/src/worker.ts`
