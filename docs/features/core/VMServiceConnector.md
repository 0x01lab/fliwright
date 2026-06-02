---
module: "VMServiceConnector"
package: "@fliwright/core"
source: "src/VMServiceConnector.ts"
tests: "tests/VMServiceConnector.test.ts"
generated: "2026-06-02"
---

# VMServiceConnector

> WebSocket client for the Dart VM Service with isolate discovery, request/response correlation, and event-stream fan-out.

## Overview

`connect(url)` opens a `ws://` connection to the Dart VM Service. `sendRequest('ext.fliwright.*', params)` automatically injects `isolateId` (resolved once via `getVM`) so bridge extensions receive properly-scoped requests. Event listeners registered with `onEvent` receive `streamNotify` events (used by recording, riverpod state changes, etc.).

## Constructor

```typescript
constructor(protocol?: Protocol)
```

## Public Methods

### `connect(url): Promise<void>`

Opens the WebSocket. Resolves on `open`; rejects on connection error.

### `sendRequest(method, params?): Promise<unknown>`

For methods starting with `ext.`, automatically calls `getMainIsolateId()` and merges it into `params.isolateId`. Returns a promise that resolves when the matching response arrives.

### `onEvent(callback): () => void`

Subscribe to `streamNotify` events. Returns an unsubscribe function.

### `disconnect(): void`

Closes the WebSocket, clears pending requests with an error, and removes all event listeners.

### `attachMock(mockWS): void`

For testing: swap the real WebSocket for a fake one implementing `on('message'|'close')` and `send`.

## Properties

| Property | Type | Description |
|----------|------|-------------|
| `mainIsolateId` (private) | string? | Cached main isolate id |

## Errors

- `Error('Not connected. Call connect() first.')` when `sendRequest` runs without a WebSocket.
- `Error('No runnable Dart isolate found...')` when `getVM` returns no usable isolate.
- `Error('WebSocket connection closed')` rejects all pending requests when the socket closes.

## Example

```typescript
const connector = new VMServiceConnector();
await connector.connect('ws://127.0.0.1:54321/abc=');
const off = connector.onEvent((e) => console.log(e.kind));
const result = await connector.sendRequest('ext.fliwright.click', { x: 10, y: 20 });
connector.disconnect();
```

## Related

- **Depends on:** [Protocol](./Protocol.md)
- **Used by:** [FliwrightDriver](./FliwrightDriver.md)
- **Source:** `packages/fliwright-core/src/VMServiceConnector.ts`
