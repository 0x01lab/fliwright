---
module: "Protocol"
package: "@fliwright/core"
source: "src/Protocol.ts"
generated: "2026-06-01"
---

# Protocol

> JSON-RPC 2.0 protocol handler for VM Service communication.

## Overview

`Protocol` creates and parses JSON-RPC 2.0 messages for communication with the Dart VM Service. It auto-injects protocol version on handshake requests and manages request IDs.

## Constructor

```typescript
constructor()
```

## Public Methods

### `createRequest(method: string, params?: Record<string, unknown>): ProtocolMessage & { id: string }`

Creates a JSON-RPC 2.0 request with auto-incremented ID. Injects `protocolVersion` for handshake methods.

### `parseResponse(message: ProtocolMessage): unknown`

Parses a JSON-RPC response. Throws on error, returns `result` on success.

### `getProtocolVersion(): number`

Returns the protocol version: `1`.

## Related

- **Used by:** [VMServiceConnector](./VMServiceConnector.md)
- **Source:** `src/Protocol.ts`
