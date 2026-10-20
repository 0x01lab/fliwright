---
package: "@fliwright/plugin-riverpod"
path: "packages/fliwright-plugin-riverpod"
source_fingerprint: "3ecceec2425896d4144b1a2e7d7f0375fca809218a392bd9c01e1ecf0dbead6f"
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
