---
package: "@fliwright/cli"
path: "packages/fliwright-cli"
source_fingerprint: "1aacd8563c865c959bc89693570da571bf8204f44303350caccbf8f7e0ec9283"
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

- `doctor`
- `flow`
- `init`
- `mock`
- `record`
- `run`
- `tdd`

## CLI Capabilities

- `form`
- `interaction`

## Source Anchors

- `packages/fliwright-cli/src/capabilities/form.ts`
- `packages/fliwright-cli/src/capabilities/interaction.ts`
- `packages/fliwright-cli/src/commands/doctor.ts`
- `packages/fliwright-cli/src/commands/flow.ts`
- `packages/fliwright-cli/src/commands/init.ts`
- `packages/fliwright-cli/src/commands/mock.ts`
- `packages/fliwright-cli/src/commands/record.ts`
- `packages/fliwright-cli/src/commands/run.ts`
- `packages/fliwright-cli/src/commands/tdd.ts`
- `packages/fliwright-cli/src/config.ts`
- `packages/fliwright-cli/src/index.ts`
- `packages/fliwright-cli/src/reporter.ts`
- `packages/fliwright-cli/src/run.ts`
- `packages/fliwright-cli/src/vm-discovery.ts`
