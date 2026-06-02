---
module: "ToolMockServer"
package: "@fliwright/core"
source: "src/ToolMockServer.ts"
generated: "2026-06-02"
---

# ToolMockServer

> Embedded HTTP server for tool-side mock request interception with admin API and rule management.

## Overview

`ToolMockServer` is a Node.js HTTP server that handles mock requests. The Flutter bridge sends HTTP requests to this server, which matches them against registered routes and returns mock responses. It provides admin endpoints for route management (`/routes`), call logging (`/calls`), passthrough control, and a debug endpoint (`/debug`).

## Constructor

```typescript
constructor(options?: ToolMockServerOptions)
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `options.host` | `string` | No | Host to bind (default: `127.0.0.1`) |
| `options.port` | `number` | No | Port to bind (default: random free port) |
| `options.passthrough` | `boolean` | No | Default: `true` |

## Public Methods

### `start(): Promise<string>`

Starts the server and returns its URL.

### `stop(): Promise<void>`

Stops the server.

### `route(path: string, response: MockRouteResponse & { method?: string }): void`

Registers a mock route.

### `removeRoute(path: string, method?: string): void`

Removes a mock route.

### `clear(): void`

Removes all routes.

### `setPassthrough(enabled: boolean): void`

Sets passthrough mode for unmatched requests.

### `getCalls(path?: string): MockCall[]`

Returns recorded calls.

### `listRoutes(): Array<{ id, method?, path }>`

Lists registered routes.

### `loadRules(mockDir?: string): Promise<void>`

Loads rules from `.fliwright/mocks/` and registers active rules as routes.

### `switchRule(endpoint: string, ruleName: string): void`

Switches the active rule and re-registers the route.

### `handleMockRequest(request: ToolMockRequest): ToolMockResult`

Handles a mock request programmatically (used by Flutter bridge).

## Properties

| Property | Type | Readonly | Description |
|----------|------|----------|-------------|
| `url` | `string \| null` | Yes | Server URL (null when stopped) |
| `ruleStore` | `MockRuleStore` | Yes | Underlying rule store |

## Related

- **Depends on:** [MockRuleStore](./MockRuleStore.md)
- **Source:** `src/ToolMockServer.ts`
