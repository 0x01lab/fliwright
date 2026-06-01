# Fliwright VS Code Extension

VS Code extension shell for Fliwright local testing workflows.

## Current Scope

This implementation slice provides native sidebar workflows for local Flutter testing:

- `Mock APIs`: scans `.fliwright/mocks/api/*.json`, validates endpoint mock files, lists response rules, opens configs, and copies endpoint/rule data.
- `Devices`: connects and disconnects a running Flutter VM Service through `@fliwright/core`.
- `Mock APIs`: applies a selected rule, applies default rules, and clears runtime mock routes through `driver.mock`.
- `Form Data`: scans `.fliwright/forms/*.json`, previews generated values, and fills selected fields through `FormHelper`.

Mock files are JSON-only. Legacy YAML mock files are intentionally unsupported.

## Development

```bash
pnpm --filter @fliwright/vscode build
pnpm --filter @fliwright/vscode lint
pnpm --filter @fliwright/vscode test
pnpm --filter @fliwright/vscode test:integration
```

Open `packages/fliwright-vscode` in VS Code or launch an Extension Development Host using this package as the extension root.

## Local Packaging

```bash
pnpm --filter @fliwright/vscode package
```

The package script builds the extension and invokes `vsce` through `pnpm dlx`, so generated `dist/` output does not need to be committed.

Run the full release gate before publishing:

```bash
pnpm --filter @fliwright/vscode verify:release
```

Publish to the VS Code Marketplace with a configured `VSCE_PAT`:

```bash
pnpm --filter @fliwright/vscode publish:vsce
```
