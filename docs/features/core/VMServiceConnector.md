---
module: "VMServiceConnector"
package: "@fliwright/core"
source: "src/VMServiceConnector.ts"
generated: "2026-06-01"
---

# VMServiceConnector

> WebSocket connection to Dart VM Service with isolate management.

## Overview

`VMServiceConnector` manages the WebSocket connection to a Flutter VM Service. It handles JSON-RPC message routing, pending request tracking, isolate discovery, and event streaming.

## Constructor

```typescript
constructor(protocol?: Protocol)
```

## Public Methods

### `connect(url: string): Promise<void>`

Opens a WebSocket to the VM Service URL and discovers the main isolate.

### `sendRequest(method: string, params?: Record<string, unknown>): Promise<unknown>`

Sends a JSON-RPC request. Auto-injects `isolateId` for `ext.*` methods.

### `onEvent(callback: EventCallback): () => void`

Registers an event listener. Returns an unsubscribe function.

### `disconnect(): void`

Closes the WebSocket and clears all state.

### `attachMock(mockWS: MockWebSocket): void`

Attaches a mock WebSocket for testing.

## MockWebSocket (interface)

| Method | Signature |
|--------|-----------|
| `on` | `(event: string, fn: (...args: any[]) => void) => void` |
| `send` | `(data: string) => void` |
| `close` | `() => void` |

## Related

- **Depends on:** [Protocol](./Protocol.md)
- **Used by:** [FliwrightDriver](./FliwrightDriver.md)
- **Source:** `src/VMServiceConnector.ts`
