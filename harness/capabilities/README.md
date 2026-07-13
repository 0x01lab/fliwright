# Implemented Capability Catalog

This is the Harness-owned, version-controlled record of capabilities that exist
in the current source. It complements `docs/features/`: this catalog answers
"what is implemented and which package owns it"; generated feature docs answer
"what is the exact API."

Each generated package page contains four boundary layers:

- responsibility and work the package must not own;
- allowed workspace dependencies;
- public package or binary entry points; and
- runtime surface names where applicable, including MCP tool names,
  `ext.fliwright.*` VM-service methods, VS Code commands, and views.

Source-module lists are implementation anchors, not public contracts. In
particular, an MCP tool module can register several MCP tools, and a bridge
extension module can register several VM-service methods.

Flutter example applications are governed consumers in
`harness/architecture/dependency-rules.json`. They intentionally do not appear
in this catalog because they own no product runtime capability.

Read the smallest matching package page in `packages/` when the owner is known.
Use [catalog.json](./catalog.json) only to discover an unknown capability or
search across packages. Do not load the whole catalog as default context.

The catalog and package pages are generated from current source by:

```text
node scripts/generate-harness-capabilities.mjs
```

`node scripts/verify-harness.mjs` rejects stale capability records. Do not
hand-edit `catalog.json` or files under `packages/`.
