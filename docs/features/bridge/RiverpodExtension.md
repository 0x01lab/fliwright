---
module: "RiverpodExtension"
package: "fliwright_bridge"
source: "lib/src/extensions/riverpod.dart"
generated: "2026-06-02"
---

# RiverpodExtension

> Bridge for Riverpod's `ProviderContainer` — list, read, override, watch, unwatch providers.

## Registered Methods

| Method | Description |
|--------|-------------|
| `ext.fliwright.riverpod.list` | Return all known providers |
| `ext.fliwright.riverpod.read` | Read current value |
| `ext.fliwright.riverpod.override` | Override a provider for the next build |
| `ext.fliwright.riverpod.watch` | Subscribe to a provider and emit state-change events |
| `ext.fliwright.riverpod.unwatch` | Stop subscribing |

## Setup

The bridge expects a `ProviderContainer` to be available. The host app must call `RiverpodExtension.attachContainer(container)` once (typically in `main()` after `ProviderScope` is set up) before the bridge methods are invoked.

## Method Details

### `ext.fliwright.riverpod.list`

No params. Returns `{ providers: ProviderInfo[] }`.

### `ext.fliwright.riverpod.read`

| Param | Type | Description |
|-------|------|-------------|
| `provider` | string | Provider key |

Returns `{ value: unknown }`.

### `ext.fliwright.riverpod.override`

| Param | Type | Description |
|-------|------|-------------|
| `provider` | string | Provider key |
| `value` | string | JSON-stringified value |

Permanently overrides the provider on the container.

### `ext.fliwright.riverpod.watch` / `unwatch`

Subscribing emits `Extension` events with `kind: 'riverpod.stateChanged'` and `data: { providerKey, oldValue, newValue }` whenever the provider's value changes.

## Related

- **TS counterpart:** [`RiverpodStateAdapter`](../plugin-riverpod/RiverpodStateAdapter.md)
- **Source:** `packages/fliwright-bridge/lib/src/extensions/riverpod.dart`
