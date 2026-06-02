---
module: "RiverpodExtension"
package: "fliwright-bridge"
source: "lib/src/extensions/riverpod.dart"
generated: "2026-06-02"
---

# RiverpodExtension

> Riverpod ProviderContainer operations for state management in tests.

## Overview

Registers VM Service extensions for reading, overriding, watching, and listing Riverpod providers. Locates the `ProviderContainer` by walking the element tree to find an `UncontrolledProviderScope` widget.

## Registered Extensions

### `ext.fliwright.riverpod.read`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `provider` | `string` | Yes | Provider name/key |

Returns `{ value: unknown }` — the current provider value.

### `ext.fliwright.riverpod.override`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `provider` | `string` | Yes | Provider name/key |
| `value` | `string` | Yes | JSON-encoded value to set |

Overrides the provider's value for testing.

### `ext.fliwright.riverpod.watch`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `provider` | `string` | Yes | Provider name/key |

Starts watching a provider for state changes. Emits `riverpod.stateChanged` events on the stream.

### `ext.fliwright.riverpod.unwatch`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `provider` | `string` | Yes | Provider name/key |

Stops watching a provider.

### `ext.fliwright.riverpod.list`

Returns `{ providers: ProviderInfo[] }` — list of all available providers with name, type, and current value.
