---
module: "PluginRegistry"
package: "@fliwright/core"
source: "src/PluginRegistry.ts"
generated: "2026-06-01"
---

# PluginRegistry

> Plugin lifecycle management and adapter registry.

## Overview

`PluginRegistry` manages plugin registration, initialization, lifecycle events, and adapter lookups. Plugins can register state adapters, mock adapters, finder strategies, and healing strategies.

## Constructor

```typescript
constructor()
```

## Public Methods

### `register(plugin: FliwrightPlugin): void`

Registers a plugin.

### `resolve(name: string): FliwrightPlugin`

Returns a plugin by name. Throws if not found.

### `getStateAdapter(name: string): StateAdapter`

Returns a registered state adapter.

### `getMockAdapter(name: string): MockAdapter`

Returns a registered mock adapter.

### `getFinderStrategy(name: string): FinderStrategy`

Returns a registered finder strategy.

### `getHealingStrategy(name: string): HealingStrategy`

Returns a registered healing strategy.

### `initAll(sendRequest: SendRequest, eventSource?: { onEvent }): Promise<void>`

Initializes all registered plugins by calling their `onInit` method.

### `notifyTestStart(testName: string): Promise<void>`

Calls `onTestStart` on all plugins.

### `notifyTestEnd(testName: string, result: TestResult): Promise<void>`

Calls `onTestEnd` on all plugins.

### `disposeAll(): Promise<void>`

Calls `onDispose` on all plugins.

## Properties

| Property | Type | Readonly | Description |
|----------|------|----------|-------------|
| `pluginNames` | `string[]` | Yes (getter) | Names of all registered plugins |

## Related

- **Used by:** [FliwrightDriver](./FliwrightDriver.md)
- **Source:** `src/PluginRegistry.ts`
