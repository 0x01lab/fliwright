---
module: "VMServiceConnector"
package: "@fliwright/core"
source: "src/VMServiceConnector.ts"
generated: "2026-06-02"
---

# VMServiceConnector

> WebSocket connection to Dart VM Service with request/response tracking and event streaming.

## Overview

Manages the WebSocket connection to a Dart VM Service. Handles JSON-RPC request/response correlation via pending request maps, discovers the main isolate automatically, and provides an event subscription API for VM Service stream notifications.

## Public Methods

### `connect(url: string): Promise<void>`

Opens a WebSocket connection to the VM Service URL.

### `sendRequest(method: string, params?: Record<string, unknown>): Promise<unknown>`

Sends a JSON-RPC request. Automatically injects `isolateId` for `ext.*` methods.

### `onEvent(callback: EventCallback): () => void`

Subscribes to VM Service events. Returns an unsubscribe function.

### `disconnect(): void`

Closes the WebSocket connection and clears state.

### `attachMock(mockWS: MockWebSocket): void`

Attaches a mock WebSocket for testing.

## Related

- **Depends on:** [Protocol](./Protocol.md)
- **Used by:** [FliwrightDriver](./FliwrightDriver.md)
- **Source:** `src/VMServiceConnector.ts`
