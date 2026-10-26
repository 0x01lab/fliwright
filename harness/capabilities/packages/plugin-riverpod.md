---
package: "@fliwright/plugin-riverpod"
path: "packages/fliwright-plugin-riverpod"
source_fingerprint: "37bee3579c80b2224e927e40d195fe39bd021ea2b39dd723bc791a37badd6f6b"
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
