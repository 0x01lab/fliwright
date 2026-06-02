---
module: "RiverpodStateAdapter"
package: "@fliwright/plugin-riverpod"
source: "src/RiverpodStateAdapter.ts"
generated: "2026-06-02"
---

# `RiverpodStateAdapter`

> `StateAdapter` implementation that talks to Riverpod's `ProviderContainer` over the Fliwright bridge to read, write, watch, list, and override providers from tests.

## Overview

The adapter is a thin TypeScript wrapper over five JSON-RPC methods exposed by the bridge's `RiverpodExtension`. It owns a per-key set of listener callbacks so a single VM Service `riverpod.stateChanged` event can fan out to multiple `watch()` subscribers. The plugin (`riverpodPlugin`) is responsible for pumping bridge events into `handleEvent()`; the adapter itself never subscribes to the event stream directly.

## Constructor

```typescript
type SendRequest = (method: string, params?: Record<string, unknown>) => Promise<unknown>;

export class RiverpodStateAdapter implements StateAdapter {
  constructor(sendRequest: SendRequest);
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sendRequest` | `(method, params?) => Promise<unknown>` | Yes | Callback used to invoke a JSON-RPC method on the running app. Typically `context.sendRequest` from the `PluginContext`, or `(method, params) => driver.sendRequest(method, params)` when used standalone. |

## Public Methods

### `read(key): Promise<unknown>`

Reads the current value of a provider.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `key` | `string` | Yes | Provider key (the Riverpod provider name). |

**Returns:** `Promise<unknown>` — the provider's current value (unwrapped from the bridge's `{ value }` envelope).

**Wire call:** `ext.fliwright.riverpod.read` with `{ provider: key }`.

**Example:**

```typescript
const count = await adapter.read<number>('counterProvider');
```

---

### `write(key, value): Promise<void>`

Overrides a provider's value for the duration of the test. Internally identical to `override()` — both call `ext.fliwright.riverpod.override` with `JSON.stringify(value)`.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `key` | `string` | Yes | Provider key. |
| `value` | `unknown` | Yes | New value. Stringified via `JSON.stringify` before sending. |

**Returns:** `Promise<void>`

**Wire call:** `ext.fliwright.riverpod.override` with `{ provider: key, value: JSON.stringify(value) }`.

**Example:**

```typescript
await adapter.write('themeProvider', { mode: 'dark' });
```

---

### `watch(key, callback): Promise<() => void>`

Subscribes to a provider's state changes. Multiple callbacks may be registered for the same key; the adapter coalesces them into a single `ext.fliwright.riverpod.watch` call. When the last callback for a key unsubscribes, the adapter automatically issues `ext.fliwright.riverpod.unwatch`.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `key` | `string` | Yes | Provider key. |
| `callback` | `(oldValue, newValue) => void` | Yes | Listener fired by `handleEvent()` on each `riverpod.stateChanged` event for this key. |

**Returns:** `Promise<() => void>` — unsubscribe function. Calling it removes the callback; if no callbacks remain for the key, fires `ext.fliwright.riverpod.unwatch` (errors swallowed).

**Wire calls:** `ext.fliwright.riverpod.watch` on subscribe, `ext.fliwright.riverpod.unwatch` on last unsubscribe.

**Example:**

```typescript
const unsubscribe = await adapter.watch<number>(
  'counterProvider',
  (oldVal, newVal) => console.log('delta:', newVal - oldVal),
);
// ...later
unsubscribe();
```

---

### `unwatch`

There is no standalone `unwatch()` method — call the function returned from `watch()` instead.

---

### `listProviders(): Promise<ProviderInfo[]>`

Returns metadata about every provider currently known to the running app's `ProviderContainer`.

**Returns:** `Promise<ProviderInfo[]>` — array of `ProviderInfo` records as defined in `@fliwright/core`. Empty array is returned if the bridge response is missing the `providers` field.

**Wire call:** `ext.fliwright.riverpod.list`.

**Example:**

```typescript
const providers = await adapter.listProviders();
for (const p of providers) console.log(p.name, p.type);
```

---

### `override(key, value): Promise<void>`

Alias for `write()` — both methods send the same `ext.fliwright.riverpod.override` envelope. Provided for symmetry with the bridge's RPC naming.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `key` | `string` | Yes | Provider key. |
| `value` | `unknown` | Yes | Override value (JSON-stringified). |

**Returns:** `Promise<void>`

**Wire call:** `ext.fliwright.riverpod.override` with `{ provider: key, value: JSON.stringify(value) }`.

---

### `handleEvent(providerKey, oldValue, newValue): void`

Entry point used by [`riverpodPlugin`](./plugin.md) to deliver `riverpod.stateChanged` events from the VM Service stream. Looks up the listener set for `providerKey` and invokes each callback with `(oldValue, newValue)`. No-op if there are no subscribers for that key.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `providerKey` | `string` | Yes | Provider key from the event payload. |
| `oldValue` | `unknown` | Yes | Previous provider value. |
| `newValue` | `unknown` | Yes | New provider value. |

**Returns:** `void`

This method is synchronous (events are delivered synchronously from `PluginContext.onEvent`) and never throws — listener errors propagate to the caller.

## Related

- **Implements:** `@fliwright/core` `StateAdapter`
- **Depends on:** `@fliwright/core` types — `StateAdapter`, `ProviderInfo`
- **Used by:** [`riverpodPlugin`](./plugin.md) which wires it into the `PluginRegistry` and event pipeline
- **Bridge counterpart:** `packages/fliwright-bridge/lib/src/extensions/riverpod.dart` (handles `ext.fliwright.riverpod.*` calls and emits `riverpod.stateChanged` events)
- **Source:** `packages/fliwright-plugin-riverpod/src/RiverpodStateAdapter.ts`
