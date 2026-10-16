---
package: "@fliwright/cli"
path: "packages/fliwright-cli"
source_fingerprint: "cc3c8e79a7cb52d76304c0497175dba42f9ecc52e7fbb0ed45a105b6b092b4b8"
generated: true
---

# Cli Capabilities

## Responsibility

Expose operator-facing command-line workflows and reusable command capabilities backed by core and TDD.

## Boundary

### May Depend On

- `@fliwright/core`
- `@fliwright/tdd`
- `@fliwright/vitest`

### Must Not Own

- `automation primitives`
- `agent protocol semantics`
- `editor UX`
- `Flutter instrumentation`

## Owned Capabilities

- `command-line workflows`
- `interaction capabilities`

## Package Entrypoints

- `.`
- `./capabilities/form`
- `./capabilities/interaction`
- `./run`

## Binary Entrypoints

- `fliwright`

## Public Exports

- `createProgram`

## CLI Commands

- `app`
- `artifacts`
- `doctor`
- `flow`
- `init`
- `mcp`
- `mock-management`
- `mock`
- `record`
- `run`
- `scenario`
- `tdd`

## CLI Capabilities

- `form`
- `interaction`
- `session`

## Source Anchors

- `packages/fliwright-cli/src/capabilities/form.ts`
- `packages/fliwright-cli/src/capabilities/interaction.ts`
- `packages/fliwright-cli/src/capabilities/session.ts`
- `packages/fliwright-cli/src/commands/app.ts`
- `packages/fliwright-cli/src/commands/artifacts.ts`
- `packages/fliwright-cli/src/commands/doctor.ts`
- `packages/fliwright-cli/src/commands/flow.ts`
- `packages/fliwright-cli/src/commands/init.ts`
- `packages/fliwright-cli/src/commands/mcp.ts`
- `packages/fliwright-cli/src/commands/mock-management.ts`
- `packages/fliwright-cli/src/commands/mock.ts`
- `packages/fliwright-cli/src/commands/record.ts`
- `packages/fliwright-cli/src/commands/run.ts`
- `packages/fliwright-cli/src/commands/scenario.ts`
- `packages/fliwright-cli/src/commands/tdd.ts`
- `packages/fliwright-cli/src/config.ts`
- `packages/fliwright-cli/src/index.ts`
- `packages/fliwright-cli/src/reporter.ts`
- `packages/fliwright-cli/src/run.ts`
- `packages/fliwright-cli/src/vm-discovery.ts`
