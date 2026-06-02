---
package: "@fliwright/plugin-riverpod"
version: "0.1.0"
layer: plugin
status: implemented
generated: "2026-06-02"
---

# @fliwright/plugin-riverpod

> Fliwright plugin that exposes Riverpod's `ProviderContainer` to tests via a `StateAdapter` — read, write, watch, list, and override any provider from TypeScript.

## Modules

| Module | Description | Doc |
|--------|-------------|-----|
| `RiverpodStateAdapter` | `StateAdapter` implementation that calls `ext.fliwright.riverpod.*` JSON-RPC methods on the running Flutter app. | [RiverpodStateAdapter.md](./RiverpodStateAdapter.md) |
| `riverpodPlugin` | `FliwrightPlugin` factory that wires the adapter into the `PluginRegistry` and forwards VM Service events to it. | [plugin.md](./plugin.md) |

## Dependencies

- `@fliwright/core` — `workspace:*` (`FliwrightPlugin`, `PluginContext`, `StateAdapter`, `ProviderInfo`)

## Usage Example

```typescript
import { FliwrightDriver } from '@fliwright/core';
import { riverpodPlugin } from '@fliwright/plugin-riverpod';

const driver = new FliwrightDriver();
driver.plugins.register(riverpodPlugin());
await driver.connect('ws://127.0.0.1:8181/ws');

// Read a provider value
const counter = await driver.state.read<number>('counterProvider');

// Override a provider for the duration of a test
await driver.state.write('counterProvider', 42);

// Watch a provider — callback fires on every state change
const unsubscribe = await driver.state.watch<number>(
  'counterProvider',
  (oldVal, newVal) => console.log('counter:', oldVal, '->', newVal),
);

// List all providers known to the running app
const providers = await driver.state.listProviders?.() ?? [];

// Clean up
await unsubscribe();
await driver.dispose();
```

The plugin registers itself under the name `'riverpod'` and binds the adapter to the same key, so consumers reach it via `driver.state` (the `StateAdapterRegistry` resolves the default adapter) or explicitly via `driver.plugins.getStateAdapter('riverpod')`.
