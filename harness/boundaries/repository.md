# Repository Boundaries

Open this when selecting the owning package, deciding whether a change crosses a
public contract, or locating its nearest tests. For current API details, route
from [../memory/feature-documentation.md](../memory/feature-documentation.md)
to a named `docs/features/` page.

## Ownership

| Area | Owns |
| --- | --- |
| `packages/fliwright-core` | TypeScript automation runtime and public core APIs |
| `packages/fliwright-bridge` | Dart/Flutter VM-Service bridge and app instrumentation |
| `packages/fliwright-vitest` | Vitest integration and fixtures |
| `packages/fliwright-mcp` | MCP server and tool contracts |
| `packages/fliwright-cli` | Command-line workflows and capabilities |
| `packages/fliwright-vscode` | VS Code extension, views, and project integration |
| `packages/fliwright-plugin-riverpod` | TypeScript Riverpod integration |
| `packages/fliwright-bridge-riverpod` | Dart bridge Riverpod support |
| `packages/fliwright-tdd` | TDD execution and repair workflow |
| `e2e` | Smoke tests against a running Flutter VM service |
| `examples/riverpod_demo` | Flutter demo application and demo tests |

## Change Boundaries

- Keep a behavior change with its owner. Update a consumer only when the
  owner's public contract requires it.
- A bridge protocol change is cross-boundary: inspect both the Dart bridge and
  its TypeScript caller, then test the contract at both ends.
- A public core, MCP, CLI, Vitest, or VS Code behavior change may require its
  matching integration tests and generated feature reference.
- Runtime state belongs to the target project's `.fliwright/` directory and
  must not become source-controlled product configuration.
- Product and design intent belongs in `docs/`; development governance belongs
  in `harness/`. Do not duplicate either in package READMEs without a local
  consumer need.

For the full source/test layout and local runtime state, open
[../memory/project-structure.md](../memory/project-structure.md).
