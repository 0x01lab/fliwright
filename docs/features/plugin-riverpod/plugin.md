---
module: "riverpodPlugin"
package: "@fliwright/plugin-riverpod"
source: "src/plugin.ts"
generated: "2026-06-02"
---

# `riverpodPlugin`

> `FliwrightPlugin` factory that registers a `RiverpodStateAdapter` under the `'riverpod'` key and pumps VM Service events into it.

## Overview

`riverpodPlugin()` returns a `FliwrightPlugin` whose `onInit` hook constructs the adapter with `context.sendRequest` bound in, registers it via `context.registerStateAdapter('riverpod', adapter)`, and subscribes to the bridge's event stream via `context.onEvent(...)`. The event handler filters for `event.kind === 'riverpod.stateChanged'` and forwards the `providerKey`, `oldValue`, and `newValue` payload into `adapter.handleEvent()`, which then fans the change out to any TypeScript `watch()` subscribers.

## Signature

```typescript
import type { FliwrightPlugin, PluginContext } from '@fliwright/core';

export function riverpodPlugin(): FliwrightPlugin;
```

**Returns:** `FliwrightPlugin` — the plugin descriptor:

```typescript
{
  name: 'riverpod',
  async onInit(context: PluginContext): Promise<void> { ... },
}
```

## Lifecycle Hooks

### `onInit(context): Promise<void>`

Called once by the `PluginRegistry` during driver initialization.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `context` | `PluginContext` | Yes | Provides `sendRequest`, `registerStateAdapter`, and `onEvent`. |

**Side effects:**

1. Constructs `new RiverpodStateAdapter((method, params) => context.sendRequest(method, params))`.
2. Registers the adapter under the key `'riverpod'` via `context.registerStateAdapter('riverpod', adapter)`.
3. Subscribes to all bridge events via `context.onEvent((event) => ...)`. For each event with `kind === 'riverpod.stateChanged'` and a truthy `event.data`, extracts `providerKey`, `oldValue`, `newValue` and calls `adapter.handleEvent(providerKey, oldValue, newValue)`.

**Returns:** `Promise<void>` — resolves once registration and event subscription are complete.

## Example

```typescript
import { FliwrightDriver } from '@fliwright/core';
import { riverpodPlugin } from '@fliwright/plugin-riverpod';

const driver = new FliwrightDriver();
driver.plugins.register(riverpodPlugin());
await driver.connect('ws://127.0.0.1:8181/ws');

// The adapter is now reachable via the global state facade:
await driver.state.watch('authProvider', (oldVal, newVal) => {
  console.log('auth changed:', oldVal, '->', newVal);
});
```

## Related

- **Returns:** `FliwrightPlugin` consumed by `@fliwright/core` [`PluginRegistry`](../core/PluginRegistry.md)
- **Wires up:** [`RiverpodStateAdapter`](./RiverpodStateAdapter.md)
- **Bridge counterpart:** `packages/fliwright-bridge/lib/src/extensions/riverpod.dart` (emits `riverpod.stateChanged`)
- **Source:** `packages/fliwright-plugin-riverpod/src/plugin.ts`
