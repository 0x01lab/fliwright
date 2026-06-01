---
module: "FliwrightDriver"
package: "@fliwright/core"
source: "src/Driver.ts"
tests: "tests/Driver.test.ts"
generated: "2026-06-01"
---

# FliwrightDriver

> Main orchestrator that connects to a Flutter VM Service and provides access to Page, MockManager, SelfHealingEngine, RecorderController, and state adapters.

## Overview

`FliwrightDriver` is the entry point for all Fliwright operations. It manages the WebSocket connection to the Dart VM Service, initializes plugin extensions, and exposes lazy-initialized subsystems (page, mock, healing, recorder, state). Plugins are registered at construction time and initialized during `connect()`.

## Constructor

```typescript
constructor(options?: DriverOptions)
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `options` | `DriverOptions` | No | Configuration options |

### DriverOptions

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `plugins` | `FliwrightPlugin[]` | No | Plugins to register before connection |

## Public Methods

### `connect(vmServiceUrl: string): Promise<void>`

Connects to the Flutter VM Service via WebSocket. Initializes all registered plugins and the healing subsystem.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `vmServiceUrl` | `string` | Yes | WebSocket URL of the Dart VM Service |

### `dispose(): Promise<void>`

Disconnects from VM Service, disposes all plugins, and cleans up resources.

### `sendRequest(method: string, params?: Record<string, unknown>): Promise<unknown>`

Sends a JSON-RPC request to the VM Service.

### `getStateAdapter(name: string): StateAdapter`

Returns a named state adapter registered by a plugin.

### `getMockAdapter(name: string): MockAdapter`

Returns a named mock adapter registered by a plugin.

### `getFinderStrategy(name: string): FinderStrategy`

Returns a named finder strategy registered by a plugin.

### `getHealingStrategy(name: string): HealingStrategy`

Returns a named healing strategy registered by a plugin.

### `notifyTestStart(testName: string): Promise<void>`

Notifies all plugins that a test has started.

### `notifyTestEnd(testName: string, result: TestResult): Promise<void>`

Notifies all plugins that a test has ended.

### `attachMockConnector(mockWS: MockWebSocket): Promise<void>`

Attaches a mock WebSocket for testing the driver itself.

## Properties

| Property | Type | Readonly | Description |
|----------|------|----------|-------------|
| `page` | `Page` | Yes | Lazy-initialized Page object |
| `mock` | `MockManager` | Yes | Lazy-initialized MockManager |
| `healing` | `SelfHealingEngine` | Yes | Lazy-initialized SelfHealingEngine |
| `recorder` | `RecorderController` | Yes | Lazy-initialized RecorderController |
| `state` | `StateAdapter` | Yes | First registered state adapter |

## Related

- **Depends on:** [PluginRegistry](./PluginRegistry.md), [VMServiceConnector](./VMServiceConnector.md), [Page](./Page.md), [MockManager](./MockManager.md), [SelfHealingEngine](./SelfHealingEngine.md), [RecorderController](./RecorderController.md)
- **Source:** `src/Driver.ts`
