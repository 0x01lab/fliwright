# Feature Documentation

AI-consumable feature documentation for this repository lives under
`docs/features/`. It summarizes every implemented feature with API signatures,
type definitions, and usage examples, organized for fast lookup by AI agents.

## Where To Start

The single entry point is [docs/features/index.md](../../docs/features/index.md) —
a routing table by package and by feature slice, an MCP tool quick reference,
and an agent quick-start guide. Open it first; it links to every per-package
overview, per-class doc, and cross-cutting pipeline. The detailed route list is
kept there and is not duplicated here, so there is one source of truth.

## When To Read

Read `docs/features/index.md` and the relevant package README or cross-cutting
pipeline before changing MCP tools, selectors, protocol behavior, code
generation, self-healing, form filling, Riverpod support, or any feature an
agent would need to discover.

## Regeneration

`docs/features/` is a generated artifact (gitignored). Regenerate it with the
`/document-features` command whenever source code changes significantly.
