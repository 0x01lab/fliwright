---
package: "@fliwright/cloud"
path: "packages/fliwright-cloud"
source_fingerprint: "8ef249b51c67be95643eacc5160f764f684408bf0848034363313668a22652a1"
generated: true
---

# Cloud Capabilities

## Responsibility

Own centralized scheduling, device policy management, report storage and browser administration.

## Boundary

### May Depend On

- `@fliwright/core`
- `@fliwright/cli`
- `@fliwright/cloud-protocol`

### Must Not Own

- `host device discovery`
- `local test execution`
- `device reset policies`

## Owned Capabilities

- `cloud queue and leases`
- `device registry and administration`
- `report storage and replay`

## Package Entrypoints

- `.`

## Binary Entrypoints

- `fliwright-cloud`

## Public Exports

- `CloudServerOptions`
- `CloudStore`
- `createCloudServer`
- `ReportStore`
- `ReportView`
- `Role`

## Source Anchors

- `packages/fliwright-cloud/src/CloudStore.ts`
- `packages/fliwright-cloud/src/ReportStore.ts`
- `packages/fliwright-cloud/src/config.ts`
- `packages/fliwright-cloud/src/index.ts`
- `packages/fliwright-cloud/src/main.ts`
- `packages/fliwright-cloud/src/server.ts`
- `packages/fliwright-cloud/src/web/Devices.tsx`
- `packages/fliwright-cloud/src/web/Replay.tsx`
- `packages/fliwright-cloud/src/web/TestBoard.tsx`
- `packages/fliwright-cloud/src/web/TimeTimeline.tsx`
- `packages/fliwright-cloud/src/web/app.tsx`
- `packages/fliwright-cloud/src/web/components/ui/badge.tsx`
- `packages/fliwright-cloud/src/web/components/ui/button.tsx`
- `packages/fliwright-cloud/src/web/components/ui/card.tsx`
- `packages/fliwright-cloud/src/web/components/ui/checkbox.tsx`
- `packages/fliwright-cloud/src/web/components/ui/input.tsx`
- `packages/fliwright-cloud/src/web/components/ui/label.tsx`
- `packages/fliwright-cloud/src/web/components/ui/native-select.tsx`
- `packages/fliwright-cloud/src/web/components/ui/navigation-menu.tsx`
- `packages/fliwright-cloud/src/web/components/ui/resizable.tsx`
- `packages/fliwright-cloud/src/web/components/ui/slider.tsx`
- `packages/fliwright-cloud/src/web/components/ui/table.tsx`
- `packages/fliwright-cloud/src/web/components/ui/tabs.tsx`
- `packages/fliwright-cloud/src/web/components/ui/textarea.tsx`
- `packages/fliwright-cloud/src/web/data.ts`
- `packages/fliwright-cloud/src/web/lib/utils.ts`
- `packages/fliwright-cloud/src/web/main.tsx`
- `packages/fliwright-cloud/src/web/replay-model.ts`
- `packages/fliwright-cloud/src/web/ui.tsx`
