---
package: "@fliwright/cli"
path: "packages/fliwright-cli"
source_fingerprint: "faf809f0c91ef671376e7c7e735f2010001e02b41ef197c67428dbc16b7606aa"
generated: true
---

# Cli Capabilities

## Responsibility

Expose developer, coding-agent and CI command workflows, explicit local connection sessions and reusable capabilities backed by core and TDD.

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
- `createRegistry`

## CLI Commands

- `app-inspect`
- `app`
- `artifact-query`
- `artifacts`
- `doctor`
- `flow-runtime`
- `flow`
- `generate-test`
- `init`
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

- `packages/fliwright-cli/src/ArtifactReferences.ts`
- `packages/fliwright-cli/src/CommandRegistry.ts`
- `packages/fliwright-cli/src/InspectionOutput.ts`
- `packages/fliwright-cli/src/RecordingReplay.ts`
- `packages/fliwright-cli/src/WorkflowContext.ts`
- `packages/fliwright-cli/src/capabilities/form.ts`
- `packages/fliwright-cli/src/capabilities/interaction.ts`
- `packages/fliwright-cli/src/capabilities/session.ts`
- `packages/fliwright-cli/src/commands/app-inspect.ts`
- `packages/fliwright-cli/src/commands/app.ts`
- `packages/fliwright-cli/src/commands/artifact-query.ts`
- `packages/fliwright-cli/src/commands/artifacts.ts`
- `packages/fliwright-cli/src/commands/doctor.ts`
- `packages/fliwright-cli/src/commands/flow-runtime.ts`
- `packages/fliwright-cli/src/commands/flow.ts`
- `packages/fliwright-cli/src/commands/generate-test.ts`
- `packages/fliwright-cli/src/commands/init.ts`
- `packages/fliwright-cli/src/commands/mock-management.ts`
- `packages/fliwright-cli/src/commands/mock.ts`
- `packages/fliwright-cli/src/commands/record.ts`
- `packages/fliwright-cli/src/commands/run.ts`
- `packages/fliwright-cli/src/commands/scenario.ts`
- `packages/fliwright-cli/src/commands/tdd.ts`
- `packages/fliwright-cli/src/config.ts`
- `packages/fliwright-cli/src/index.ts`
- `packages/fliwright-cli/src/registry/finite.ts`
- `packages/fliwright-cli/src/registry/flow-schemas.ts`
- `packages/fliwright-cli/src/registry/flow.ts`
- `packages/fliwright-cli/src/registry/generation-schema.ts`
- `packages/fliwright-cli/src/registry/session.ts`
- `packages/fliwright-cli/src/registry/tdd.ts`
- `packages/fliwright-cli/src/reporter.ts`
- `packages/fliwright-cli/src/run.ts`
- `packages/fliwright-cli/src/session/ConnectionHost.ts`
- `packages/fliwright-cli/src/session/client.ts`
- `packages/fliwright-cli/src/session/worker.ts`
- `packages/fliwright-cli/src/vm-discovery.ts`
