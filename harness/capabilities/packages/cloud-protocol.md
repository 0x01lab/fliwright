---
package: "@fliwright/cloud-protocol"
path: "packages/fliwright-cloud-protocol"
source_fingerprint: "bbd80786b7a4cf978f91fd43c77422af4a5a49d2d543fc20be02cb0bf21f41c1"
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
- `packages/fliwright-cloud-protocol/src/worker-control.ts`
- `packages/fliwright-cloud-protocol/src/worker-diagnostics.ts`
- `packages/fliwright-cloud-protocol/src/worker-pairing.ts`
- `packages/fliwright-cloud-protocol/src/worker-timeline.ts`
