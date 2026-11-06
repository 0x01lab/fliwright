---
package: "@fliwright/plugin-riverpod"
path: "packages/fliwright-plugin-riverpod"
source_fingerprint: "953c8f5fa969ca0915b5b580c39777d4dc4234aee1dcd3e37a6baa457defa82c"
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
