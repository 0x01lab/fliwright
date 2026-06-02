---
module: "PluginRegistry"
package: "@fliwright/core"
source: "src/PluginRegistry.ts"
generated: "2026-06-02"
---

# PluginRegistry

> Plugin lifecycle management — register, initAll, test lifecycle hooks.

## Overview

Manages `FliwrightPlugin` instances and their registered adapters (StateAdapter, MockAdapter, FinderStrategy, HealingStrategy). Provides lifecycle hooks: `onInit`, `onTestStart`, `onTestEnd`, `onDispose`.

## Public Methods

### `register(plugin: FliwrightPlugin): void`

Registers a plugin. Throws if a plugin with the same name is already registered.

### `resolve(name: string): FliwrightPlugin`

Returns a registered plugin by name. Throws if not found.

### `getStateAdapter(name: string): StateAdapter`

Returns a registered StateAdapter.

### `getMockAdapter(name: string): MockAdapter`

Returns a registered MockAdapter.

### `getFinderStrategy(name: string): FinderStrategy`

Returns a registered FinderStrategy.

### `getHealingStrategy(name: string): HealingStrategy`

Returns a registered HealingStrategy.

### `initAll(sendRequest, eventSource?): Promise<void>`

Initializes all plugins with a PluginContext. Called once after VM Service connection.

### `notifyTestStart(testName: string): Promise<void>`

Calls `onTestStart` on all plugins.

### `notifyTestEnd(testName: string, result: TestResult): Promise<void>`

Calls `onTestEnd` on all plugins.

### `disposeAll(): Promise<void>`

Calls `onDispose` on all plugins.

## Properties

| Property | Type | Readonly | Description |
|----------|------|----------|-------------|
| `pluginNames` | `string[]` | Yes | Names of all registered plugins |

## Related

- **Used by:** [FliwrightDriver](./FliwrightDriver.md)
- **Source:** `src/PluginRegistry.ts`
