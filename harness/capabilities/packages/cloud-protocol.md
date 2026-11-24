---
package: "@fliwright/cloud-protocol"
path: "packages/fliwright-cloud-protocol"
source_fingerprint: "a8d8aa444a9349ee84757205f5f93066da0987051d1aac7284c3f4ddccc9a6ee"
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
