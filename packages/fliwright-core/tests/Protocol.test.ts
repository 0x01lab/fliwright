import { describe, it, expect } from 'vitest';
import { Protocol } from '../src/Protocol.js';

describe('Protocol', () => {
  it('creates a request message with auto-incrementing id', () => {
    const proto = new Protocol();
    const msg = proto.createRequest('ext.fliwright.click', { x: 100, y: 200 });
    expect(msg.jsonrpc).toBe('2.0');
    expect(msg.method).toBe('ext.fliwright.click');
    expect(msg.params).toEqual({ x: 100, y: 200 });
    expect(msg.id).toBe('1');
  });

  it('increments id for subsequent requests', () => {
    const proto = new Protocol();
    const msg1 = proto.createRequest('ext.fliwright.ping');
    const msg2 = proto.createRequest('ext.fliwright.ping');
    expect(msg1.id).toBe('1');
    expect(msg2.id).toBe('2');
  });

  it('parses a success response', () => {
    const proto = new Protocol();
    const result = proto.parseResponse({ jsonrpc: '2.0', id: '1', result: { status: 'ok' } });
    expect(result).toEqual({ status: 'ok' });
  });

  it('throws on error response', () => {
    const proto = new Protocol();
    expect(() => proto.parseResponse({
      jsonrpc: '2.0', id: '1', error: { code: -32000, message: 'Widget not found' },
    })).toThrow('VM Service error [-32000]: Widget not found');
  });

  it('includes version in handshake params', () => {
    const proto = new Protocol();
    const msg = proto.createRequest('ext.fliwright.handshake');
    expect(msg.params).toHaveProperty('protocolVersion');
    expect(typeof msg.params!.protocolVersion).toBe('number');
  });
});
