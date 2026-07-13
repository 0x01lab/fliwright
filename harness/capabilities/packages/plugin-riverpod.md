---
package: "@fliwright/plugin-riverpod"
path: "packages/fliwright-plugin-riverpod"
source_fingerprint: "a84e105326ebbb515ecc5e55fe8d26b8ff2147b8a6d8a28692c6d74e2ab9e284"
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
