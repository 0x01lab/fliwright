---
module: "Protocol"
package: "@fliwright/core"
source: "src/Protocol.ts"
tests: "tests/Protocol.test.ts"
generated: "2026-06-02"
---

# Protocol

> JSON-RPC 2.0 request/response encoder/decoder for the VM Service WebSocket.

## Overview

Wraps each outbound call in a `{ jsonrpc: '2.0', id, method, params }` envelope and unwraps responses, throwing on `error`. The handshake method `ext.fliwright.handshake` automatically injects `protocolVersion: 1` into params.

## Constructor

```typescript
constructor()
```

## Public Methods

### `createRequest(method, params?): ProtocolMessage & { id: string }`

Allocates a sequential numeric id (stringified) and returns the wire message.

### `parseResponse(message): unknown`

Returns `message.result`. Throws `Error('VM Service error [code]: message')` if `message.error` is set.

### `getProtocolVersion(): number` — returns `1`.

## Example

```typescript
const protocol = new Protocol();
const req = protocol.createRequest('ext.fliwright.click', { x: 100, y: 200 });
ws.send(JSON.stringify(req));
// later:
const result = protocol.parseResponse(JSON.parse(raw));
```

## Related

- **Used by:** [VMServiceConnector](./VMServiceConnector.md)
- **Source:** `packages/fliwright-core/src/Protocol.ts`
