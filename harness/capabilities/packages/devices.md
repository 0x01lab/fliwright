---
package: "@fliwright/devices"
path: "packages/fliwright-devices"
source_fingerprint: "e77c697b4fad5296eb2f6a30dc6bd98faebfeb777e5c627603910ef600e8817b"
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
