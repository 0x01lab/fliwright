---
module: "RiverpodStateAdapter"
package: "@fliwright/plugin-riverpod"
source: "src/RiverpodStateAdapter.ts"
generated: "2026-06-02"
---

# RiverpodStateAdapter

> StateAdapter implementation for Riverpod state management via VM Service extensions.

## Overview

Implements `StateAdapter` to interact with Riverpod providers through Flutter VM Service extensions (`ext.fliwright.riverpod.*`). Supports reading, writing, watching, overriding, and listing providers. Event-driven watch uses the VM Service event stream to notify on state changes.

## Constructor

```typescript
constructor(sendRequest: SendRequest)
```

## Public Methods

### `read(key: string): Promise<unknown>`

Reads the current value of a provider via `ext.fliwright.riverpod.read`.

### `write(key: string, value: unknown): Promise<void>`

Writes a value to a provider via `ext.fliwright.riverpod.override`.

### `watch(key: string, callback: (oldValue, newValue) => void): Promise<() => void>`

Watches a provider for state changes. Returns an unsubscribe function.

### `listProviders(): Promise<ProviderInfo[]>`

Lists all available Riverpod providers via `ext.fliwright.riverpod.list`.

### `override(key: string, value: unknown): Promise<void>`

Overrides a provider's value for testing.

### `handleEvent(providerKey: string, oldValue: unknown, newValue: unknown): void`

Internal method to dispatch state change events to watchers. Called by the plugin when `riverpod.stateChanged` events arrive.

## Related

- **Implements:** StateAdapter (from @fliwright/core)
- **Registered by:** `riverpodPlugin()` in plugin.ts
- **Source:** `src/RiverpodStateAdapter.ts`
