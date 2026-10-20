# Persist device policy separately from discovery and execution leases

- Status: accepted
- Date: 2026-10-19
- Scope: @fliwright/cloud device management, discovery-only hosts and scheduling readiness
- Evidence: packages/fliwright-cloud/tests/device-management.test.ts, packages/fliwright-cloud/tests/device-inventory-store.test.ts, packages/fliwright-cloud/tests/devices-ui.test.ts, packages/fliwright-cloud/tests/server.test.ts, packages/fliwright-cloud/tests/discovery-command.test.ts, packages/fliwright-cloud/tests/discovery-config.test.ts
- Changed-Files: `packages/fliwright-cloud/src/CloudStore.ts`, `packages/fliwright-cloud/src/config.ts`, `packages/fliwright-cloud/src/contracts.ts`, `packages/fliwright-cloud/src/main.ts`, `packages/fliwright-cloud/src/server.ts`, `packages/fliwright-cloud/src/worker.ts`, `packages/fliwright-cloud/src/web/app.tsx`, `packages/fliwright-cloud/src/web/Devices.tsx`, `packages/fliwright-cloud/src/web/data.ts`
- Supersedes: none

## Decision

Cloud device policy is database-owned. Startup Worker slots seed only a newly registered host; subsequent startup must not overwrite web edits, restore removed bindings or silently pause hosts omitted from the file. Revoke credentials and explicitly pause hosts when retiring them. Migration preserves occupied slot generations and attempt ownership while removing globally unique native device IDs.

Registry identity includes Worker, platform and kind. Android AVD names associate stopped AVDs with their running emulator IDs. Discovery preserves management settings and last-known observations when devices disappear; it never enrolls an unconfigured device or frees/quarantines a lease. A configured bootstrap slot may seed its matching device once. Operators can explicitly bind an idle unbound slot, but may not steal an enrolled device's slot or change busy/quarantined mappings and application scopes.

Enrollment is distinct from deployed execution readiness. New claims advertise the executor's actual native device ID. Assignment additionally requires fresh online discovery, enrolled/enabled policy, matching allowed application, an unpaused host and an idle slot. Stopped simulators remain blocked until started on the host. Per-device pause affects future claims only. Busy-attempt heartbeats preserve runtime freshness without altering device policy or lease fencing.

The unified /devices page owns device filtering and policy; /workers owns host health, diagnostics and capacity. Member views are read-only; operator/admin mutations validate Origin and record actor audit. Discovery-only hosts use the discover command before any execution root or reset policy is provisioned. Each execution slot still needs a separately deployed Worker with a dedicated root and reset policy; the UI must show that requirement explicitly.
