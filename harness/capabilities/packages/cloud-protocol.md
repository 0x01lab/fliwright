---
package: "@fliwright/cloud-protocol"
path: "packages/fliwright-cloud-protocol"
source_fingerprint: "8cc134d2ae46f4fdcfd535320102edf846891586d39003354678779b3c6044ee"
generated: true
---

# Cloud Protocol Capabilities

## Responsibility

Own Cloud/Worker wire contracts, upload path policy, WebSocket control client and HTTP upload/CI client.

## Boundary

### May Depend On

- None

### Must Not Own

- `host device discovery`
- `server persistence`
- `test execution`

## Owned Capabilities

- `cloud wire contracts`
- `cloud HTTP client`
- `cloud WebSocket control client`

## Package Entrypoints

- `.`
- `./secure-files`

## Public Exports

- `CloudClient`
- `GitLabGateRequest`
- `passesGitLabGate`
- `safeArtifactPath`
- `WorkerControlClient`

## Source Anchors

- `packages/fliwright-cloud-protocol/src/CloudClient.ts`
- `packages/fliwright-cloud-protocol/src/WorkerControlClient.ts`
- `packages/fliwright-cloud-protocol/src/artifacts.ts`
- `packages/fliwright-cloud-protocol/src/contracts.ts`
- `packages/fliwright-cloud-protocol/src/index.ts`
- `packages/fliwright-cloud-protocol/src/secure-files.ts`
- `packages/fliwright-cloud-protocol/src/worker-control.ts`
- `packages/fliwright-cloud-protocol/src/worker-diagnostics.ts`
- `packages/fliwright-cloud-protocol/src/worker-pairing.ts`
- `packages/fliwright-cloud-protocol/src/worker-timeline.ts`
