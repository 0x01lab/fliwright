---
module: "PluginRegistry"
package: "@fliwright/core"
source: "src/PluginRegistry.ts"
tests: "tests/PluginRegistry.test.ts"
generated: "2026-06-02"
---

# PluginRegistry

> Holds the list of registered plugins plus their contributed adapters (state / mock / finder / healing) and runs plugin lifecycle hooks.

## Overview

Plugins are registered before `connect()`. When `initAll` runs (during `FliwrightDriver.connect`), each plugin's `onInit(context)` is called with a `PluginContext` whose `registerX` callbacks populate the registry's adapter maps. The driver then looks up adapters by name (`getStateAdapter('riverpod')`).

## Constructor

```typescript
constructor()
```

## Public Methods

### `register(plugin): void`

Register a plugin. Throws if a plugin with the same `name` is already registered.

### `resolve(name): FliwrightPlugin` — return the plugin or throw.

### `pluginNames: string[]` — list of registered plugin names.

### `getStateAdapter(name)`, `getMockAdapter(name)`, `getFinderStrategy(name)`, `getHealingStrategy(name)`

Look up an adapter by name; throw if not registered.

### `initAll(sendRequest, eventSource?): Promise<void>`

Runs each plugin's `onInit` once with a `PluginContext`. Subsequent calls are no-ops.

### `notifyTestStart(testName): Promise<void>`, `notifyTestEnd(testName, result): Promise<void>`, `disposeAll(): Promise<void>`

Fan out lifecycle hooks. `disposeAll` also resets `initialized` so `initAll` could run again.

## Example

```typescript
const registry = new PluginRegistry();
registry.register(riverpodPlugin());
await registry.initAll(sendRequest, connector);
const riverpod = registry.getStateAdapter('riverpod');
```

## Related

- **Source:** `packages/fliwright-core/src/PluginRegistry.ts`
