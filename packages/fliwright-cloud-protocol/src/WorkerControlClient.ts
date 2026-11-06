import WebSocket from 'ws';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { CloudError, type ExecutionLease } from './contracts.js';
import { workerControlMessageSchema, workerOperationSchema, type CloudRequestClient } from './worker-control.js';

/** Outbound-only Worker control channel. Reconnect never replays an RPC or resumes a lease. */
export class WorkerControlClient implements CloudRequestClient {
  private socket?: WebSocket;
  private readonly events = new EventEmitter();
  private readonly pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>();
  private timer?: ReturnType<typeof setTimeout>;
  private watchdog?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private failure?: Error;
  private backoff = 0;
  private readonly url: URL;
  revision = 0;
  get connected(): boolean { return !this.stopped && this.socket?.readyState === WebSocket.OPEN; }

  constructor(serverUrl: string, private readonly token: string, private readonly options: { reconnectMs?: number } = {}) {
    this.url = new URL('/api/worker/connect', serverUrl);
    if (!['http:', 'https:'].includes(this.url.protocol) || new URL(serverUrl).username || new URL(serverUrl).password)
      throw new Error('Expected an HTTP(S) Cloud Server URL without credentials');
    this.url.protocol = this.url.protocol === 'https:' ? 'wss:' : 'ws:';
    this.connect();
  }
  private wake() { this.revision++; this.events.emit('wake'); }
  private connect() {
    if (this.stopped || this.failure) return;
    const socket = this.socket = new WebSocket(this.url, {
      headers: { authorization: `Bearer ${this.token}` },
      handshakeTimeout: 15000, maxPayload: 4 * 1024 * 1024 + 65536, perMessageDeflate: false,
    });
    const alive = () => {
      clearTimeout(this.watchdog);
      this.watchdog = setTimeout(() => socket.terminate(), 35000);
    };
    socket.on('open', () => { this.backoff = 0; alive(); this.wake(); this.events.emit('connected'); });
    socket.on('ping', alive);
    socket.on('message', (bytes, binary) => {
      try {
        if (binary) throw new Error('Expected JSON control message');
        const message = workerControlMessageSchema.parse(JSON.parse(bytes.toString()));
        if (message.type === 'wake') this.wake();
        else if (message.type === 'cancel') this.events.emit('cancel', message.requestId);
        else if (message.type === 'scan-cancel') this.events.emit('scan-cancel', message.scanId);
        else {
          const pending = this.pending.get(message.id);
          if (!pending) return;
          this.pending.delete(message.id);
          if (message.status >= 400) pending.reject(new CloudError(message.status, 'Worker control operation rejected'));
          else pending.resolve(message.body);
        }
      } catch { socket.terminate(); }
    });
    socket.on('unexpected-response', (_request, response) => {
      if ([401, 403].includes(response.statusCode ?? 0)) this.failure = new Error('Worker credential rejected');
      response.resume();
      socket.terminate();
    });
    socket.on('error', () => {}); // Close owns failure delivery and reconnect scheduling.
    socket.on('close', () => {
      clearTimeout(this.watchdog);
      for (const pending of this.pending.values()) pending.reject(new Error('Worker control disconnected; operation was not replayed'));
      this.pending.clear();
      this.events.emit('lost');
      this.events.emit('wake');
      if (!this.stopped && !this.failure) {
        const base = this.options.reconnectMs ?? 1000;
        const ms = Math.min(30000, base * 2 ** Math.min(this.backoff++, 5));
        this.timer = setTimeout(() => this.connect(), ms + Math.floor(Math.random() * ms * 0.2));
      }
    });
  }
  async ready(signal: AbortSignal = AbortSignal.timeout(15000)): Promise<void> {
    while (this.socket?.readyState !== WebSocket.OPEN) {
      if (this.failure) throw this.failure;
      if (this.stopped) throw new Error('Worker control closed');
      await this.wait(signal, () => this.socket?.readyState === WebSocket.OPEN || !!this.failure || this.stopped);
    }
  }
  private wait(signal: AbortSignal, changed: () => boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      const finish = (error?: unknown) => {
        this.events.removeListener('wake', wake);
        signal.removeEventListener('abort', abort);
        error ? reject(error) : resolve();
      };
      const wake = () => { if (changed()) finish(); };
      const abort = () => finish(signal.reason ?? new Error('Worker wait aborted'));
      this.events.on('wake', wake);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort(); else wake();
    });
  }
  async waitForWork(revision: number, signal: AbortSignal): Promise<void> {
    await this.wait(signal, () => this.revision !== revision || this.stopped || !!this.failure);
    await this.ready(signal);
  }
  async request<T>(path: string, options: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
    const operation = workerOperationSchema.parse(path);
    const signal = options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(15000)])
      : AbortSignal.timeout(15000);
    await this.ready(signal);
    const socket = this.socket!;
    const id = randomUUID();
    return new Promise<T>((resolve, reject) => {
      const done = (error?: Error, value?: unknown) => {
        this.pending.delete(id);
        signal.removeEventListener('abort', abort);
        error ? reject(error) : resolve(value as T);
      };
      const abort = () => {
        done(new Error('Worker control operation timed out or aborted'));
        // Timeline appends are explicitly idempotent diagnostics, independent of lease heartbeats.
        if (operation !== '/api/worker/timeline' && operation !== '/api/worker/diagnostics') socket.terminate();
      };
      this.pending.set(id, { resolve: value => done(undefined, value), reject: error => done(error) });
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) { abort(); return; }
      socket.send(JSON.stringify({ type: 'request', id, operation, body: options.body ?? {} }), error => { if (error) done(error); });
    });
  }
  /** Subscribe to successful connections, including reconnects, to reconcile host inventory. */
  onConnected(listener: () => void): () => void {
    this.events.on('connected', listener);
    return () => { this.events.removeListener('connected', listener); };
  }
  watchLease(lease: ExecutionLease, listener: (reason: 'lost' | 'cancelled') => void): () => void {
    const cancel = (id: string) => { if (id === lease.request.id) listener('cancelled'); };
    const lost = () => listener('lost');
    this.events.on('cancel', cancel);
    this.events.on('lost', lost);
    if (this.socket?.readyState !== WebSocket.OPEN) lost();
    return () => { this.events.removeListener('cancel', cancel); this.events.removeListener('lost', lost); };
  }
  watchScan(scanId: string, abort: () => void): () => void {
    const cancel = (id: string) => { if (id === scanId) abort(); };
    this.events.on('scan-cancel', cancel);
    this.events.on('lost', abort);
    if (this.socket?.readyState !== WebSocket.OPEN) abort();
    return () => { this.events.removeListener('scan-cancel', cancel); this.events.removeListener('lost', abort); };
  }
  close() {
    this.stopped = true;
    clearTimeout(this.timer);
    clearTimeout(this.watchdog);
    this.socket?.terminate();
    for (const pending of this.pending.values()) pending.reject(new Error('Worker control closed'));
    this.pending.clear();
    this.events.emit('lost');
    this.events.emit('wake');
  }
}
