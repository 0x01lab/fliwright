import WebSocket from 'ws';
import { Protocol } from './Protocol.js';
import type { VMServiceEvent, ProtocolMessage } from './types.js';

type EventCallback = (event: VMServiceEvent) => void;

export class VMServiceConnector {
  private protocol = new Protocol();
  private ws: WebSocket | { on: (event: string, fn: Function) => void; send: (data: string) => void; close: () => void } | null = null;
  private pendingRequests = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private eventListeners: EventCallback[] = [];

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

  onEvent(callback: EventCallback): void { this.eventListeners.push(callback); }

  disconnect(): void { if (this.ws) { this.ws.close(); this.ws = null; } }

  attachMock(mockWS: { on: (event: string, fn: Function) => void; send: (data: string) => void; close: () => void }): void {
    this.ws = mockWS;
    mockWS.on('message', (data: string) => this.handleMessage(data));
    mockWS.on('close', () => this.rejectAllPending(new Error('WebSocket connection closed')));
  }

  private handleMessage(raw: string): void {
    const msg = JSON.parse(raw) as ProtocolMessage;
    if (msg.id && this.pendingRequests.has(msg.id)) {
      const { resolve, reject } = this.pendingRequests.get(msg.id)!;
      this.pendingRequests.delete(msg.id);
      try { resolve(this.protocol.parseResponse(msg)); } catch (err) { reject(err); }
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
