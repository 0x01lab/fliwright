---
package: "@fliwright/devices"
path: "packages/fliwright-devices"
source_fingerprint: "8a1b2191fa06cebd77116eddf185a9725b65a5aebaf6cad7f2b13987e92d179c"
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
