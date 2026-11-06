---
package: "@fliwright/devices"
path: "packages/fliwright-devices"
source_fingerprint: "9bf44dd26608a3b5961079f635a39439e187e414aa7808b377e237dc488fad28"
generated: true
---

# Devices Capabilities

## Responsibility

Discover host iOS and Android physical devices and simulators through a shared read-only interface and normalize device state and tooling diagnostics.

## Boundary

### May Depend On

- None

### Must Not Own

- `cloud scheduling and leases`
- `device reset or app launch`
- `CLI or editor UX`
- `Flutter in-app instrumentation`

## Owned Capabilities

- `host device discovery`
- `iOS and Android device inventory`

## Package Entrypoints

- `.`

## Public Exports

- `DeviceDiscovery`
- `DeviceDiscoveryOptions`
- `DeviceInventory`
- `DevicePlatform`
- `DeviceScanOptions`
- `DeviceState`
- `DiscoveredDevice`
- `DiscoveryDiagnostic`
- `DiscoverySource`

## Source Anchors

- `packages/fliwright-devices/src/DeviceDiscovery.ts`
- `packages/fliwright-devices/src/commands.ts`
- `packages/fliwright-devices/src/device-changes.ts`
- `packages/fliwright-devices/src/index.ts`
- `packages/fliwright-devices/src/types.ts`
