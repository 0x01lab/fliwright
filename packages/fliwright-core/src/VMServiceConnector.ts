import WebSocket from 'ws';
import { Protocol } from './Protocol.js';
import type { VMServiceEvent, ProtocolMessage } from './types.js';

type EventCallback = (event: VMServiceEvent) => void;

/** Global debug logger — set by the host application (e.g. VS Code extension). */
let _debugLog: ((message: string) => void) | undefined;

export function setConnectorDebugLog(fn: ((message: string) => void) | undefined): void {
  _debugLog = fn;
}

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
  private diagnosticEvents: VMServiceEvent[] = [];
  private diagnosticLimit = 100;
  private mainIsolateId: string | null = null;

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

  async sendRequest(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const resolvedParams = method.startsWith('ext.')
      ? { ...(params ?? {}), isolateId: await this.getMainIsolateId() }
      : params;
    return this.sendProtocolRequest(method, resolvedParams);
  }

  async reloadSources(): Promise<unknown> {
    return this.sendProtocolRequest('reloadSources', {
      isolateId: await this.getMainIsolateId(),
    });
  }

  async listenToStreams(streamIds: string[]): Promise<void> {
    for (const streamId of streamIds) {
      try {
        await this.sendProtocolRequest('streamListen', { streamId });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/already/i.test(message)) throw error;
      }
    }
  }

  getDiagnostics(options: { limit?: number; kinds?: string[]; streams?: string[] } = {}): VMServiceEvent[] {
    const limit = options.limit ?? this.diagnosticLimit;
    const kinds = options.kinds == null ? null : new Set(options.kinds);
    const streams = options.streams == null ? null : new Set(options.streams);
    return this.diagnosticEvents
      .filter((event) => kinds == null || kinds.has(event.kind))
      .filter((event) => streams == null || (event.streamId != null && streams.has(event.streamId)))
      .slice(-limit);
  }

  clearDiagnostics(): void {
    this.diagnosticEvents.length = 0;
  }

  private sendProtocolRequest(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (!this.ws) throw new Error('Not connected. Call connect() first.');
    const msg = this.protocol.createRequest(method, params);
    const promise = new Promise<unknown>((resolve, reject) => { this.pendingRequests.set(msg.id, { resolve, reject }); });
    this.ws.send(JSON.stringify(msg));
    return promise;
  }

  private async getMainIsolateId(): Promise<string> {
    if (this.mainIsolateId) return this.mainIsolateId;

    const vm = await this.sendProtocolRequest('getVM') as {
      isolates?: Array<{ id?: string; isSystemIsolate?: boolean }>;
    };
    const isolate = (vm.isolates ?? []).find((entry) => entry.id && !entry.isSystemIsolate)
      ?? (vm.isolates ?? []).find((entry) => entry.id);
    if (!isolate?.id) {
      throw new Error('No runnable Dart isolate found in VM Service response.');
    }
    this.mainIsolateId = isolate.id;
    return this.mainIsolateId;
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
    this.mainIsolateId = null;
    this.eventListeners.length = 0;
    this.clearDiagnostics();
  }

  attachMock(mockWS: MockWebSocket): void {
    this.ws = mockWS;
    this.mainIsolateId = null;
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
      // Dart VM Service Extension events use extensionKind / extensionData
      // (not kind / data).  Fall back to kind / data for backward-compat and
      // test mocks that use the simpler format.
      const event: VMServiceEvent = {
        kind: params.event?.extensionKind ?? params.event?.kind ?? 'unknown',
        timestamp: Date.now(),
        data: params.event?.extensionData ?? params.event?.data ?? params.event ?? {},
        streamId: params.streamId,
      };
      this.recordDiagnostic(event);
      const rawKind = params.event?.kind;
      const rawExtKind = params.event?.extensionKind;
      _debugLog?.(`[VM] streamNotify: event.kind=${rawKind} event.extensionKind=${rawExtKind} → resolved=${event.kind} dataKeys=${Object.keys(event.data).join(',')}`);
      this.eventListeners.forEach((cb) => cb(event));
    } else if (msg.method) {
      _debugLog?.(`[VM] received: method=${msg.method}`);
    }
  }

  private rejectAllPending(error: Error): void {
    for (const { reject } of this.pendingRequests.values()) { reject(error); }
    this.pendingRequests.clear();
  }

  private recordDiagnostic(event: VMServiceEvent): void {
    this.diagnosticEvents.push(event);
    if (this.diagnosticEvents.length > this.diagnosticLimit) {
      this.diagnosticEvents.splice(0, this.diagnosticEvents.length - this.diagnosticLimit);
    }
  }
}
