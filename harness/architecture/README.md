# Architecture And Repository Boundaries

[dependency-rules.json](./dependency-rules.json) is the machine-checked source
of truth for module ownership and allowed dependency direction. Every governed
TypeScript package, Dart package, and Flutter example declares:

- its owning directory;
- its responsibility and the capabilities it may expose;
- the work it must not own; and
- the only workspace packages it may depend on.

Examples are governed consumers: they may exercise public bridge behavior but
cannot define product runtime capabilities or reusable APIs.

This document is the human-facing companion to that executable contract. It
owns package selection, change impact, and source/test-location guidance; no
other Harness document duplicates those rules.

## Responsibility Matrix

| Area | Owns | Must Not Own |
| --- | --- | --- |
| `packages/fliwright-core` | Reusable automation runtime, VM-service client protocol, shared models | CLI, MCP, editor UX, or in-app Dart instrumentation |
| `packages/fliwright-bridge` | Flutter-side `ext.fliwright.*` instrumentation and app interaction | TypeScript orchestration or user-facing transports |
| `packages/fliwright-vitest` | Vitest fixtures, hooks, reporters, test lifecycle integration | Core automation semantics or transport workflows |
| `packages/fliwright-mcp` | Agent-facing MCP tools and resources | Core primitives, CLI ownership, editor UX, or Dart protocol behavior |
| `packages/fliwright-cli` | Operator-facing CLI commands and reusable command capabilities | Core primitives, MCP semantics, editor UX, or Dart instrumentation |
| `packages/fliwright-vscode` | VS Code commands, views, webviews, and project workflows | Core primitives, MCP contracts, or Dart instrumentation |
| `packages/fliwright-plugin-riverpod` | TypeScript Riverpod plugin and state adapter | Flutter observation or generic runtime behavior |
| `packages/fliwright-bridge-riverpod` | Flutter/Riverpod observation and provider bridge methods | Generic bridge behavior or TypeScript adapters |
| `packages/fliwright-tdd` | Persistent TDD loop, reset, rerun, generation, repair planning | General CLI, MCP transport, or Dart protocol behavior |
| `e2e` | Smoke and integration verification against a running app | Public runtime APIs or product capabilities |
| `examples/form_demo` | Form and network-mock consumer verification | Public APIs or reusable runtime behavior |
| `examples/go_router_demo` | Navigation consumer verification | Public APIs or reusable runtime behavior |
| `examples/riverpod_demo` | Riverpod consumer verification | Public APIs or reusable runtime behavior |

The generated [capability catalog](../capabilities/README.md) turns these
ownership rules into package pages. It shows the actual public entry points and
runtime surfaces; use it to discover an implemented capability, then use
`docs/features/` for detailed API semantics.

## Change Boundaries

- Keep a behavior change with its owner. Update a consumer only when the
  owner's public contract requires it.
- Add a capability to its owning package, not to the nearest consumer. A new
  cross-package capability requires an explicit `mayDependOn` rule and matching
  dependency-manifest approval.
- A package may expose only the responsibility recorded in
  `dependency-rules.json`; move work that belongs to a listed "Must Not Own"
  area to its owner instead of adding a compatibility path.
- A bridge protocol change is cross-boundary: inspect both the Dart bridge and
  its TypeScript caller, then test the contract at both ends.
- A public core, MCP, CLI, Vitest, or VS Code behavior change may require its
  matching integration tests and generated feature reference.
- TypeScript packages keep source in `packages/*/src` and focused tests in
  matching `packages/*/tests` directories. The Dart bridge uses
  `packages/fliwright-bridge/lib` and `packages/fliwright-bridge/test`.
- End-to-end smoke tests are in `e2e`; Flutter demos and demo tests are in
  `examples/*`. Demos consume only their declared bridge packages and must not
  become a dependency of runtime packages.
- Per-project runtime state belongs to the target project's `.fliwright/`
  directory. Its URL and configuration resolution are defined in
  [../memory/runtime-configuration.md](../memory/runtime-configuration.md).
- Product and design intent belongs in `docs/`; development governance belongs
  in `harness/`. Do not duplicate either in package READMEs without a local
  consumer need.

For current API details, start with [../../docs/README.md](../../docs/README.md)
and follow its route to the smallest relevant generated feature page.

## Updating The Executable Contract

Update `dependency-rules.json` only when a reviewed architecture decision
changes a boundary. Then declare the matching dependency in
[../stack/framework.json](../stack/framework.json), add the import in the
owning module, add a focused regression test, and run
`node scripts/verify-harness.mjs`.
The checker rejects undeclared workspace dependencies and imports that point in
the wrong direction, including test-only and side-effect imports. It also fails
when a discovered workspace package is missing from the executable rules.
