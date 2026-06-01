---
module: "RiverpodStateAdapter"
package: "@fliwright/plugin-riverpod"
source: "src/RiverpodStateAdapter.ts"
generated: "2026-06-01"
---

# RiverpodStateAdapter

> StateAdapter implementation for Riverpod state management.

## Overview

`RiverpodStateAdapter` communicates with the bridge's Riverpod extension to read, write, watch, and override Riverpod providers. It handles event subscription for real-time state change notifications.

## Constructor

```typescript
constructor(sendRequest: SendRequest)
```

## Public Methods

### `read(key: string): Promise<unknown>`

Reads the current value of a provider.

### `write(key: string, value: unknown): Promise<void>`

Overrides a provider with a new value (alias for `override`).

### `watch(key: string, callback: (oldValue, newValue) => void): Promise<() => void>`

Watches a provider for changes. Returns an unsubscribe function.

### `listProviders(): Promise<ProviderInfo[]>`

Lists all available Riverpod providers.

### `override(key: string, value: unknown): Promise<void>`

Overrides a provider's value via the bridge extension.

### `handleEvent(providerKey: string, oldValue: unknown, newValue: unknown): void`

Dispatches state change events to registered watchers. Called by the plugin's event handler.

## Bridge Extension Methods

| Method | Extension |
|--------|-----------|
| `ext.fliwright.riverpod.read` | Read provider |
| `ext.fliwright.riverpod.override` | Override provider |
| `ext.fliwright.riverpod.watch` | Watch provider |
| `ext.fliwright.riverpod.list` | List providers |

## Related

- **Implements:** `StateAdapter` from `@fliwright/core`
- **Registered by:** `riverpodPlugin()`
- **Source:** `src/RiverpodStateAdapter.ts`
