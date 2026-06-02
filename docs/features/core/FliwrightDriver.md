---
module: "FliwrightDriver"
package: "@fliwright/core"
source: "src/Driver.ts"
tests: "tests/Driver.test.ts"
generated: "2026-06-02"
---

# FliwrightDriver

> Main orchestrator that connects to the Flutter VM Service and provides access to Page, MockManager, SelfHealingEngine, RecorderController, and plugin system.

## Overview

`FliwrightDriver` is the entry point for all Fliwright interactions. It manages the WebSocket connection to the Dart VM Service via `VMServiceConnector`, lazily initializes subsystems (page, mock, healing, recorder), and coordinates plugin lifecycle hooks.

## Constructor

```typescript
constructor(options?: DriverOptions)
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `options.plugins` | `FliwrightPlugin[]` | No | Plugins to register on construction |

## Properties

| Property | Type | Readonly | Description |
|----------|------|----------|-------------|
| `page` | `Page` | Yes | Lazily-initialized Page object for widget interaction |
| `mock` | `MockManager` | Yes | Lazily-initialized mock route manager |
| `healing` | `SelfHealingEngine` | Yes | Lazily-initialized self-healing engine |
| `recorder` | `RecorderController` | Yes | Lazily-initialized interaction recorder |
| `state` | `StateAdapter` | Yes | Shortcut for `getStateAdapter('riverpod')` |

## Public Methods

### `connect(vmServiceUrl: string): Promise<void>`

Connects to the Flutter VM Service via WebSocket and initializes all registered plugins.

### `dispose(): Promise<void>`

Disconnects from VM Service and disposes all plugins.

### `attachMockConnector(mockWS: MockWebSocket): Promise<void>`

Attaches a mock WebSocket for testing without a real Flutter app.

### `sendRequest(method: string, params?: Record<string, unknown>): Promise<unknown>`

Sends a raw JSON-RPC request to the VM Service. Useful for custom extension calls.

### `getStateAdapter(name: string): StateAdapter`

Returns a registered StateAdapter by name.

### `getMockAdapter(name: string): MockAdapter`

Returns a registered MockAdapter by name.

### `getFinderStrategy(name: string): FinderStrategy`

Returns a registered FinderStrategy by name.

### `getHealingStrategy(name: string): HealingStrategy`

Returns a registered HealingStrategy by name.

### `notifyTestStart(testName: string): Promise<void>`

Notifies all plugins that a test has started.

### `notifyTestEnd(testName: string, result: TestResult): Promise<void>`

Notifies all plugins that a test has ended.

## Related

- **Depends on:** [VMServiceConnector](./VMServiceConnector.md), [Page](./Page.md), [MockManager](./MockManager.md), [SelfHealingEngine](./SelfHealingEngine.md), [RecorderController](./RecorderController.md), [PluginRegistry](./PluginRegistry.md)
- **Source:** `src/Driver.ts`
