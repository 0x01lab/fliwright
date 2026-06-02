---
module: "state"
package: "@fliwright/vscode"
source: "src/state/"
generated: "2026-06-02"
---

# State

> Read and override Riverpod providers from the State tree view.

## Modules

| File | Role |
|------|------|
| `src/state/StateInjectionService.ts` | Wraps `@fliwright/plugin-riverpod` `RiverpodStateAdapter` |
| `src/views/StateTreeProvider.ts` | Tree view of providers with live values |

## Commands

| Command | Action |
|---------|--------|
| `fliwright.refreshStateProviders` | Refresh the State tree from the running app |
| `fliwright.readStateProvider` | Read a provider's value (prompt for name) |
| `fliwright.overrideStateProvider` | Override a provider's value (prompt for name + JSON) |

## Related

- **Plugin:** [@fliwright/plugin-riverpod](../plugin-riverpod/README.md)
- **Source:** `packages/fliwright-vscode/src/state/`
