---
package: "@fliwright/cloud-worker"
path: "packages/fliwright-cloud-worker"
source_fingerprint: "05c228fe44fb5f04c2c429bd63b42e3aca5748028b479d0a15d20b6dddf1f01c"
generated: true
---

# Cloud Worker Capabilities

## Responsibility

Own host device discovery and reporting, supervised test execution, cleanup and report upload. Cloud devDependency is only for HTTP integration tests.

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

- `fliwright-cloud-worker`

## Public Exports

- `createWorker`
- `discoveryConfigSchema`
- `ExecutionResult`
- `reportWorkerDevices`
- `retrySpool`
- `WorkerAgent`
- `WorkerAgentOptions`
- `workerConfigSchema`
- `WorkerDependencies`

## Source Anchors

- `packages/fliwright-cloud-worker/src/WorkerAgent.ts`
- `packages/fliwright-cloud-worker/src/config.ts`
- `packages/fliwright-cloud-worker/src/device-reporting.ts`
- `packages/fliwright-cloud-worker/src/executor.ts`
- `packages/fliwright-cloud-worker/src/index.ts`
- `packages/fliwright-cloud-worker/src/main.ts`
- `packages/fliwright-cloud-worker/src/processes.ts`
- `packages/fliwright-cloud-worker/src/worker.ts`
