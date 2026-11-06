---
package: "@fliwright/cloud-protocol"
path: "packages/fliwright-cloud-protocol"
source_fingerprint: "41c54df7e778bb42730fac22b4702b1926aef3b86b1b9a1e0eee185ae4b0f234"
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
