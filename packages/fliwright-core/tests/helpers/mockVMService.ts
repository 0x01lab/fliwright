/**
 * Shared Mock VM Service factory for integration tests.
 *
 * Simulates the Dart VM Service JSON-RPC protocol over a MockWebSocket,
 * letting integration tests exercise real code paths without a running Flutter app.
 */
import type { ProtocolMessage } from '../../src/types.js';
import type { MockWebSocket } from '../../src/VMServiceConnector.js';

const DEFAULT_ISOLATE_ID = 'isolates/main';
let nextId = 1;

export interface ProtocolMock {
  ws: MockWebSocket;
  /** All JSON-RPC messages sent through the mock WebSocket. */
  sentMessages: () => ProtocolMessage[];
  /** Register a handler for a specific extension method (e.g. 'ext.fliwright.inspect'). */
  mockExtension: (method: string, handler: (params: any) => any) => void;
  /** Inject a VM Service streamNotify event. */
  emitStreamEvent: (kind: string, data: Record<string, unknown>) => void;
  /** The isolate ID used in responses. */
  isolateId: string;
}

/**
 * Creates a MockWebSocket that faithfully simulates the JSON-RPC protocol
 * used by VMServiceConnector. Automatically resolves `getVM` requests.
 */
export function createProtocolMock(isolateId = DEFAULT_ISOLATE_ID): ProtocolMock {
  const listeners: Record<string, Array<(...args: any[]) => void>> = {};
  const sent: ProtocolMessage[] = [];
  const extensionHandlers = new Map<string, (params: any) => any>();

  const ws: MockWebSocket = {
    on(event: string, fn: (...args: any[]) => void) {
      (listeners[event] ??= []).push(fn);
    },
    send(data: string) {
      const msg = JSON.parse(data) as ProtocolMessage;
      sent.push(msg);

      // Auto-handle getVM
      if (msg.method === 'getVM') {
        respond(msg.id!, {
          isolates: [{ id: isolateId, name: 'main', isSystemIsolate: false }],
        });
        return;
      }

      // Auto-handle streamListen
      if (msg.method === 'streamListen') {
        respond(msg.id!, { type: 'Success' });
        return;
      }

      // Dispatch to registered extension handlers
      if (msg.method?.startsWith('ext.') && extensionHandlers.has(msg.method)) {
        try {
          const result = extensionHandlers.get(msg.method)!(msg.params ?? {});
          respond(msg.id!, result);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          respondError(msg.id!, -32000, errMsg);
        }
        return;
      }

      // Default: respond with empty result for unhandled extensions
      if (msg.method?.startsWith('ext.')) {
        respond(msg.id!, {});
      }
    },
    close() {},
  };

  function respond(id: string, result: unknown) {
    const json = JSON.stringify({ jsonrpc: '2.0', id, result });
    for (const fn of listeners['message'] ?? []) fn(json);
  }

  function respondError(id: string, code: number, message: string) {
    const json = JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } });
    for (const fn of listeners['message'] ?? []) fn(json);
  }

  function emitStreamEvent(kind: string, data: Record<string, unknown>) {
    const json = JSON.stringify({
      jsonrpc: '2.0',
      method: 'streamNotify',
      params: {
        streamId: 'Extension',
        event: { type: 'Extension', extensionKind: kind, timestamp: Date.now(), extensionData: data },
      },
    });
    for (const fn of listeners['message'] ?? []) fn(json);
  }

  return {
    ws,
    sentMessages: () => [...sent],
    mockExtension(method: string, handler: (params: any) => any) {
      extensionHandlers.set(method, handler);
    },
    emitStreamEvent,
    isolateId,
  };
}
