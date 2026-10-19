---
package: "@fliwright/plugin-riverpod"
path: "packages/fliwright-plugin-riverpod"
source_fingerprint: "505e1444c0262625d5f064a943185c5ff9bcc4f6110c1ada9ab4759d35d0436a"
generated: true
---

# Plugin Riverpod Capabilities

## Responsibility

Provide the core-side plugin and StateAdapter that consume the Dart Riverpod bridge surface.

## Boundary

### May Depend On

- `@fliwright/core`

### Must Not Own

- `Flutter Riverpod observation`
- `generic automation runtime behavior`
- `editor UI`

## Owned Capabilities

- `Riverpod state adapter`

## Package Entrypoints

- `.`

## Public Exports

- `riverpodPlugin`
- `RiverpodStateAdapter`

## Source Anchors

- `packages/fliwright-plugin-riverpod/src/RiverpodStateAdapter.ts`
- `packages/fliwright-plugin-riverpod/src/index.ts`
- `packages/fliwright-plugin-riverpod/src/plugin.ts`
