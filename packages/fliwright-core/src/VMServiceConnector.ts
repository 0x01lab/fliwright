import WebSocket from 'ws';
import { Protocol } from './Protocol.js';
import type { VMServiceEvent, ProtocolMessage } from './types.js';

type EventCallback = (event: VMServiceEvent) => void;

export interface MockWebSocket {
  on(event: string, fn: (...args: any[]) => void): void;
  send(data: string): void;
  close(): void;
}

export class VMServiceConnector {
  private protocol: Protocol;
  private ws: WebSocket | MockWebSocket | null = null;
  private pendingRequests = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private eventListeners: EventCallback[] = [];

  constructor(protocol?: Protocol) {
    this.protocol = protocol ?? new Protocol();
  }

  async connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url);
      this.ws.on('open', () => resolve());
      this.ws.on('error', (err: Error) => reject(err));
      this.ws.on('message', (data: any) => this.handleMessage(data.toString()));
      this.ws.on('close', () => this.rejectAllPending(new Error('WebSocket connection closed')));
    });
  }

  sendRequest(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (!this.ws) throw new Error('Not connected. Call connect() first.');
    const msg = this.protocol.createRequest(method, params);
    const promise = new Promise<unknown>((resolve, reject) => { this.pendingRequests.set(msg.id, { resolve, reject }); });
    this.ws.send(JSON.stringify(msg));
    return promise;
  }

  onEvent(callback: EventCallback): () => void {
    this.eventListeners.push(callback);
    return () => {
      const idx = this.eventListeners.indexOf(callback);
      if (idx >= 0) this.eventListeners.splice(idx, 1);
    };
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.eventListeners.length = 0;
  }

  attachMock(mockWS: MockWebSocket): void {
    this.ws = mockWS;
    mockWS.on('message', (data: string) => this.handleMessage(data));
    mockWS.on('close', () => this.rejectAllPending(new Error('WebSocket connection closed')));
  }

  private handleMessage(raw: string): void {
    let msg: ProtocolMessage;
    try {
      msg = JSON.parse(raw) as ProtocolMessage;
    } catch {
      console.error('[fliwright] Failed to parse message:', raw);
      return;
    }
    if (msg.id && this.pendingRequests.has(msg.id)) {
      const { resolve, reject } = this.pendingRequests.get(msg.id)!;
      this.pendingRequests.delete(msg.id);
      try { resolve(this.protocol.parseResponse(msg)); } catch (err) { reject(err instanceof Error ? err : new Error(String(err))); }
      return;
    }
    if (msg.method === 'streamNotify' && msg.params) {
      const params = msg.params as any;
      const event: VMServiceEvent = { kind: params.event?.kind ?? 'unknown', timestamp: Date.now(), data: params.event?.data ?? {} };
      this.eventListeners.forEach((cb) => cb(event));
    }
  }

  private rejectAllPending(error: Error): void {
    for (const { reject } of this.pendingRequests.values()) { reject(error); }
    this.pendingRequests.clear();
  }
}
