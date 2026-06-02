---
module: "MockManager"
package: "@fliwright/core"
source: "src/MockManager.ts"
generated: "2026-06-02"
---

# MockManager

> Manages mock routes for HTTP request interception, supporting both local and remote (Flutter-side) mock servers with rule switching.

## Overview

`MockManager` implements `MockAdapter` and provides a unified API for mock route management. It can operate in two modes: **local** (embedded `ToolMockServer`) or **remote** (delegating to a Flutter-side mock controller via `ext.fliwright.mock.setController`). It also supports loading and switching named mock rules from `.fliwright/mocks/` config files.

## Constructor

```typescript
constructor(sendRequest: SendRequest)
```

## Public Methods

### `route(path: string, response: MockRouteResponse & { method?: string }): Promise<void>`

Adds a mock route. In remote mode, sends to the Flutter controller; in local mode, registers on the embedded server.

### `removeRoute(path: string, method?: string): Promise<void>`

Removes a mock route.

### `clear(): Promise<void>`

Removes all mock routes.

### `setPassthrough(enabled: boolean): Promise<void>`

Enables/disables passthrough mode for unmatched requests.

### `getCalls(path?: string): Promise<MockCall[]>`

Returns recorded calls, optionally filtered by path.

### `listRoutes(): Promise<Array<{ id: string; method?: string; path: string }>>`

Lists all registered routes.

### `clearCalls(): Promise<void>`

Clears all recorded calls.

### `startServer(options?: ToolMockServerOptions): Promise<string>`

Starts the embedded mock server and returns its URL.

### `stopServer(): Promise<void>`

Stops the embedded mock server.

### `loadRules(mockDir?: string): Promise<void>`

Loads mock rules from a directory (default `.fliwright/mocks`) and applies active rules.

### `listRules(): Array<{ endpoint, method, rules[], activeRule }>`

Lists all loaded endpoints with their rules and active selection.

### `switchRule(endpoint: string, ruleName: string): Promise<void>`

Switches the active rule for an endpoint and applies it.

### `configureFlutterController(url?: string): Promise<void>`

Configures the Flutter-side mock controller URL via VM Service extension.

## Properties

| Property | Type | Readonly | Description |
|----------|------|----------|-------------|
| `controllerUrl` | `string \| null` | Yes | The active mock controller URL |

## Related

- **Depends on:** [ToolMockServer](./ToolMockServer.md), [MockRuleStore](./MockRuleStore.md)
- **Source:** `src/MockManager.ts`
