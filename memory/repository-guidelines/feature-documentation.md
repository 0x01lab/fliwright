# Feature Documentation

AI-consumable feature documentation is generated under `docs/features/` by the
`/document-features` command. It summarizes every implemented feature with API
signatures, type definitions, and usage examples, organized for fast lookup by
AI agents. Feature documentation is the single source of truth for "what is
implemented and where to find details"; AGENTS.md does not duplicate these
routes.

## Current State

Present and current as of 2026-06-14. 98 markdown files covering all 8
packages, generated from the actual source code. Regenerate with
`/document-features` whenever source code changes significantly.

## Routes

- [docs/features/index.md](../../docs/features/index.md) - start here: routing
  table by package and by feature slice, MCP tool quick reference, and an agent
  quick-start guide.

### Per-package overviews

- [core/README.md](../../docs/features/core/README.md) - `@fliwright/core`
- [mcp/README.md](../../docs/features/mcp/README.md) - `@fliwright/mcp`
- [vitest/README.md](../../docs/features/vitest/README.md) - `@fliwright/vitest`
- [cli/README.md](../../docs/features/cli/README.md) - `@fliwright/cli`
- [plugin-riverpod/README.md](../../docs/features/plugin-riverpod/README.md) -
  `@fliwright/plugin-riverpod`
- [bridge/README.md](../../docs/features/bridge/README.md) - `fliwright-bridge`
  (Dart), including the [bridge-riverpod](../../docs/features/bridge/bridge-riverpod.md)
  companion
- [vscode/README.md](../../docs/features/vscode/README.md) - `@fliwright/vscode`

### Per-class detailed docs

Each package sub-directory contains one `.md` per exported class or utility,
for example [core/FliwrightDriver.md](../../docs/features/core/FliwrightDriver.md),
[core/Page.md](../../docs/features/core/Page.md), and
[core/types.md](../../docs/features/core/types.md).

### Cross-cutting pipelines

- [self-healing-pipeline.md](../../docs/features/self-healing-pipeline.md)
- [recording-pipeline.md](../../docs/features/recording-pipeline.md)
- [form-filling-pipeline.md](../../docs/features/form-filling-pipeline.md)
- [mcp-integration.md](../../docs/features/mcp-integration.md)

## When To Read

Read the relevant package README and the matching cross-cutting pipeline before
changing MCP tools, selectors, protocol behavior, code generation, self-healing,
form filling, Riverpod support, or any feature an agent would need to discover.
