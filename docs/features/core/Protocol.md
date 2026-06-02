---
module: "Protocol"
package: "@fliwright/core"
source: "src/Protocol.ts"
generated: "2026-06-02"
---

# Protocol

> JSON-RPC 2.0 message creation and response parsing for VM Service communication.

## Overview

`Protocol` creates JSON-RPC 2.0 request messages with auto-incrementing IDs and handles response parsing. It also injects `protocolVersion` into handshake requests.

## Public Methods

### `createRequest(method: string, params?: Record<string, unknown>): ProtocolMessage & { id: string }`

Creates a JSON-RPC 2.0 request message.

### `parseResponse(message: ProtocolMessage): unknown`

Parses a response message. Throws on error responses.

### `getProtocolVersion(): number`

Returns the protocol version (currently 1).

## Related

- **Used by:** [VMServiceConnector](./VMServiceConnector.md)
- **Source:** `src/Protocol.ts`
