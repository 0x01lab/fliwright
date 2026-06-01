---
module: "RiverpodExtension"
package: "fliwright-bridge"
source: "lib/src/extensions/riverpod.dart"
generated: "2026-06-01"
---

# RiverpodExtension

> Riverpod state management bridge — exposes provider operations.

## Prerequisites

Requires `RiverpodExtension.setProviderContainer(container)` to be called during app initialization with the app's `ProviderContainer`.

## Registered Extensions

### `ext.fliwright.riverpod.list`

**Parameters:** None

**Returns:** `{ providers: List, containerReady: bool }`

### `ext.fliwright.riverpod.read`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `provider` | `string` | Yes | Provider name |

**Returns:** `{ provider: string, value: any, found: bool }`

### `ext.fliwright.riverpod.override`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `provider` | `string` | Yes | Provider name |
| `value` | `string (JSON)` | Yes | New value as JSON string |

**Returns:** `{ provider: string, overridden: bool, message: string }`

### `ext.fliwright.riverpod.watch`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `provider` | `string` | Yes | Provider name |

**Returns:** `{ watching: true, provider: string }`

### `ext.fliwright.riverpod.unwatch`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `provider` | `string` | Yes | Provider name |

**Returns:** `{ watching: false, provider: string }`
