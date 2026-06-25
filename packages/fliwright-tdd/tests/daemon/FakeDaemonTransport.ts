import type { DaemonMessage, DaemonTransport } from '../../src/daemon/DaemonTransport.js';

type RequestHandler = (method: string, params: Record<string, unknown>) => Promise<unknown>;

export class FakeDaemonTransport implements DaemonTransport {
  private readonly handlers = new Map<string, RequestHandler>();
  private readonly listeners = new Set<(message: DaemonMessage) => void>();
  public readonly requests: Array<{ method: string; params: Record<string, unknown> }> = [];
  public connectCount = 0;

  on(method: string, handler: RequestHandler): this {
    this.handlers.set(method, handler);
    return this;
  }

  emit(message: DaemonMessage): void {
    for (const listener of this.listeners) listener(message);
  }

  async connect(): Promise<void> {
    this.connectCount += 1;
  }

  async request<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    this.requests.push({ method, params });
    const handler = this.handlers.get(method);
    if (!handler) throw new Error(`FakeDaemonTransport: no handler for ${method}`);
    return await handler(method, params) as T;
  }

  onEvent(handler: (message: DaemonMessage) => void): () => void {
    this.listeners.add(handler);
    return () => {
      this.listeners.delete(handler);
    };
  }

  async dispose(): Promise<void> {}
}
