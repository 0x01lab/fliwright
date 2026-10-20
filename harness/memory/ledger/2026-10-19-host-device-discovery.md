# Share host device discovery independently of apps and cloud slots

- Status: accepted
- Date: 2026-10-19
- Scope: @fliwright/devices, CLI device discovery, cloud Worker inventory
- Evidence: packages/fliwright-devices/tests/DeviceDiscovery.test.ts, packages/fliwright-devices/tests/commands.test.ts, packages/fliwright-cli/tests/devices.test.ts, packages/fliwright-cloud/tests/server.test.ts, packages/fliwright-cloud/tests/device-inventory-store.test.ts, packages/fliwright-cloud/tests/device-reporting.test.ts, packages/fliwright-cloud/tests/devices-ui.test.ts, docs/adr/0003-share-host-device-discovery-in-a-dedicated-package.md
- Changed-Files: `packages/fliwright-cli/src/index.ts`, `packages/fliwright-cloud/src/CloudStore.ts`, `packages/fliwright-cloud/src/config.ts`, `packages/fliwright-cloud/src/contracts.ts`, `packages/fliwright-cloud/src/main.ts`, `packages/fliwright-cloud/src/server.ts`, `packages/fliwright-cloud/src/web/app.tsx`, `packages/fliwright-cli/src/registry/devices.ts`, `packages/fliwright-cloud/src/device-reporting.ts`, `packages/fliwright-devices/src/DeviceDiscovery.ts`, `packages/fliwright-devices/src/commands.ts`, `packages/fliwright-devices/src/index.ts`, `packages/fliwright-devices/src/types.ts`, `packages/fliwright-cli/package.json`, `packages/fliwright-cloud/package.json`, `packages/fliwright-devices/package.json`, `packages/fliwright-devices/tsconfig.json`
- Supersedes: none

## Decision

Host iOS/Android device discovery belongs to the standalone @fliwright/devices package. CLI and cloud consume its public interface. Detection works without a running app or VM Service and normalizes physical devices, simulators, lifecycle/connection states and per-source diagnostics. Native tool failures retain other sources; cancellation rejects. Discovery does not boot, erase, pair, unlock or launch devices/apps. Unidentified Android emulators prevent claiming unmatched AVDs are stopped.

The cloud reports inventories independently of task leases. Authenticate the reporting Worker at the server; never trust a payload-selected Worker identity. Keep last-known snapshots with server receipt time and mark them stale after 90 seconds. Worker health, physical device state and execution-slot state are separate. Scanning never registers slots, resets devices, unquarantines slots or releases leases. Tool paths can be supplied by the host deployment.

Public package distribution includes dependency-order publishing, tarball verification and clean npm/pnpm consumer imports. Source-derived CLI references and feature documentation include the shared detection interface and cloud reporting path.
