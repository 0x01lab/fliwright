import type { SendRequest } from './types.js';

/** A transport-neutral, application-defined WebSocket channel rule. */
export interface WebSocketMockRule {
  id: string;
  connection: string;
  channel: string;
  suppressRemote?: boolean;
  onSubscribe?: WebSocketMockRulePush[];
}

/** A rule-local push inherits the enclosing rule's connection and channel. */
export interface WebSocketMockRulePush {
  payload: unknown;
  delayMs?: number;
}

/** A synthetic server message delivered by the application's adapter. */
export interface WebSocketMockPush {
  connection: string;
  channel: string;
  payload: unknown;
  delayMs?: number;
}

/** Delivery receipt returned by an application WebSocket mock delegate. */
export interface WebSocketMockPushResult {
  matchedSessions: number;
  deliveredSessions: number;
}

/** An application-reported WebSocket mock operation. */
export interface WebSocketMockCall {
  connection: string;
  channel?: string;
  direction: string;
  /** Application-provided value suitable for use as `WebSocketMockPush.payload`. */
  mockPayload?: unknown;
  payload?: unknown;
}

/**
 * Drives the optional `ext.fliwright.websocket.*` bridge extension.
 *
 * Fliwright deliberately treats `connection` and `channel` as opaque strings.
 * An app integration maps them to STOMP topics, Socket.IO events, or its own
 * realtime protocol without adding an app dependency to this package.
 */
export class WebSocketMockManager {
  constructor(private sendRequest: SendRequest) {}

  async setRules(rules: WebSocketMockRule[]): Promise<Record<string, unknown>> {
    return this.request('ext.fliwright.websocket.setRules', { rules: JSON.stringify(rules) });
  }

  /** Reports whether the connected bridge registered this optional module. */
  async isSupported(): Promise<boolean> {
    try {
      const result = unwrapExtensionPayload(await this.sendRequest('ext.fliwright.handshake', { protocolVersion: '1' }));
      if (!result || typeof result !== 'object') return false;
      const modules = (result as { bridgeCapabilities?: { modules?: unknown } }).bridgeCapabilities?.modules;
      return Array.isArray(modules) && modules.some((module) => (
        typeof module === 'object' && module !== null && (module as { id?: unknown }).id === 'websocketMock'
      ));
    } catch {
      return false;
    }
  }

  async clearRules(): Promise<void> {
    await this.request('ext.fliwright.websocket.clearRules');
  }

  async getRules(): Promise<WebSocketMockRule[]> {
    const result = await this.request('ext.fliwright.websocket.getRules');
    return Array.isArray(result.rules) ? result.rules as WebSocketMockRule[] : [];
  }

  async clearCalls(): Promise<void> {
    await this.request('ext.fliwright.websocket.clearCalls');
  }

  async push(push: WebSocketMockPush): Promise<WebSocketMockPushResult> {
    const result = await this.request('ext.fliwright.websocket.push', { push: JSON.stringify(push) });
    return {
      matchedSessions: numberValue(result.matchedSessions),
      deliveredSessions: numberValue(result.deliveredSessions),
    };
  }

  async getCalls(): Promise<WebSocketMockCall[]> {
    const result = await this.request('ext.fliwright.websocket.getCalls');
    return Array.isArray(result.calls) ? result.calls as WebSocketMockCall[] : [];
  }

  private async request(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>> {
    const result = unwrapExtensionPayload(await this.sendRequest(method, params));
    if (!result || typeof result !== 'object') {
      throw new Error(`WebSocket mock bridge returned an invalid response for ${method}`);
    }
    const payload = result as Record<string, unknown>;
    if (payload.success !== true) {
      throw new Error(typeof payload.error === 'string' ? payload.error : `WebSocket mock bridge rejected ${method}`);
    }
    return payload;
  }
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function unwrapExtensionPayload(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  for (const key of ['result', 'response'] as const) {
    if (!(key in value)) continue;
    const nested = (value as Record<string, unknown>)[key];
    if (typeof nested === 'string') {
      try {
        return unwrapExtensionPayload(JSON.parse(nested));
      } catch {
        return value;
      }
    }
    return unwrapExtensionPayload(nested);
  }
  return value;
}
