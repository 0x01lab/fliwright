import type { ProtocolMessage } from './types.js';

const PROTOCOL_VERSION = 1;

export class Protocol {
  private nextId = 0;

  createRequest(method: string, params?: Record<string, unknown>): ProtocolMessage & { id: string } {
    const id = String(++this.nextId);
    const resolvedParams = params ?? {};
    if (method === 'ext.fliwright.handshake') {
      resolvedParams.protocolVersion = PROTOCOL_VERSION;
    }
    return { jsonrpc: '2.0', id, method, params: resolvedParams };
  }

  parseResponse(message: ProtocolMessage): unknown {
    if (message.error) {
      throw new Error(`VM Service error [${message.error.code}]: ${message.error.message}`);
    }
    return message.result;
  }

  getProtocolVersion(): number { return PROTOCOL_VERSION; }
}
