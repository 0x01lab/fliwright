---
module: "FliwrightDriver"
package: "@fliwright/core"
source: "src/Driver.ts"
tests: "tests/Driver.test.ts"
generated: "2026-06-02"
---

# FliwrightDriver

> Top-level entry point that owns the VM Service connection and lazily instantiates `Page`, `MockManager`, `SelfHealingEngine`, `RecorderController`, and the plugin registry.

## Overview

`FliwrightDriver` is the single object tests interact with. Construction is cheap — it only initializes a `PluginRegistry` and a `VMServiceConnector`. Calling `connect(vmServiceUrl)` opens the WebSocket, runs every registered plugin's `onInit` hook, and makes the rest of the subsystems usable. Sub-systems are lazy: `page`, `mock`, `healing`, and `recorder` are constructed on first access.

## Constructor

```typescript
constructor(options?: DriverOptions)

interface DriverOptions {
  plugins?: FliwrightPlugin[];
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `options.plugins` | `FliwrightPlugin[]` | No | Plugins registered before `connect` runs their `onInit` |

## Public Methods

### `connect(vmServiceUrl): Promise<void>`

Opens the VM Service WebSocket, then runs `onInit` on every registered plugin with the driver's `sendRequest` channel and `VMServiceConnector`.

| Parameter | Type | Description |
|-----------|------|-------------|
| `vmServiceUrl` | string | Dart VM Service WebSocket URL |

---

### `attachMockConnector(mockWS): Promise<void>`

For testing: bypasses the WebSocket and uses a fake/in-process connection.

---

### `sendRequest(method, params?): Promise<unknown>`

Low-level escape hatch — call any RPC method on the bridge.

---

### `dispose(): Promise<void>`

Runs `onDispose` on every plugin, then closes the WebSocket.

## Properties

| Property | Type | Lazy | Description |
|----------|------|------|-------------|
| `page` | `Page` | Yes | Page-object entry |
| `mock` | `MockManager` | Yes | Mock route manager |
| `healing` | `SelfHealingEngine` | Yes | Healing engine (default `MultiDimensionalHealingStrategy`) |
| `recorder` | `RecorderController` | Yes | Recording controller |
| `state` | `StateAdapter` | No | Returns `riverpod` state adapter if registered |

## Plugin Lookup

- `getStateAdapter(name)`, `getMockAdapter(name)`, `getFinderStrategy(name)`, `getHealingStrategy(name)` — return registered adapter by name.
- `notifyTestStart(name)` / `notifyTestEnd(name, result)` — fan out to plugin lifecycle hooks.

## Example

```typescript
import { FliwrightDriver } from '@fliwright/core';
import { riverpodPlugin } from '@fliwright/plugin-riverpod';

const driver = new FliwrightDriver({ plugins: [riverpodPlugin()] });
await driver.connect('ws://127.0.0.1:54321/abc=');

try {
  await driver.page.locator({ text: 'Login' }).click();
} finally {
  await driver.dispose();
}
```

## Related

- **Depends on:** [Page](./Page.md), [MockManager](./MockManager.md), [SelfHealingEngine](./SelfHealingEngine.md), [RecorderController](./RecorderController.md), [PluginRegistry](./PluginRegistry.md), [VMServiceConnector](./VMServiceConnector.md)
- **Source:** `packages/fliwright-core/src/Driver.ts`
