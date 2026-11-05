import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { NativeError, type NativeOperationContext } from '@fliwright/core';

interface Pending {
  requestId: string;
  parentRequestId: string;
  operation: string;
  payload: unknown;
  context: NativeOperationContext;
  delivered: boolean;
  resolve(value: unknown): void;
  reject(error: unknown): void;
}

export const runnerProtocolVersion = 2;

/** Loopback command broker consumed by the owned XCTest Runner, not WebDriver. */
export class RunnerBroker {
  private readonly token = randomBytes(32).toString('hex');
  private readonly sessionId = randomUUID();
  private server?: Server;
  private url?: string;
  private ready = false;
  private activeRunnerPid?: number;
  private activeRecoveryPort?: number;
  private closed = false;
  private unfinished = false;
  private pending?: Pending;
  private poll?: { response: ServerResponse; timer: ReturnType<typeof setTimeout> };
  private readonly readyListeners = new Set<() => void>();

  constructor(private readonly identity: { deviceId: string; appId: string; generation: string }) {}

  get runnerPid(): number | undefined { return this.activeRunnerPid; }
  get recoveryPort(): number | undefined { return this.activeRecoveryPort; }

  async start(): Promise<void> {
    if (this.server || this.closed) throw new NativeError('precondition_failed', 'Runner broker cannot be started twice.');
    const server = createServer((request, response) => {
      void this.handle(request, response).catch(() => this.respond(response, 400, { error: 'Invalid runner request.' }));
    });
    this.server = server;
    server.requestTimeout = 5000;
    server.headersTimeout = 5000;
    server.maxHeadersCount = 20;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new NativeError('runner_unavailable', 'Runner broker failed to bind.');
    this.url = `http://127.0.0.1:${address.port}`;
  }

  environment(): Record<string, string> {
    if (!this.url) throw new NativeError('runner_unavailable', 'Runner broker has not started.');
    return { FLIWRIGHT_RUNNER_URL: this.url, FLIWRIGHT_RUNNER_TOKEN: this.token, FLIWRIGHT_RUNNER_SESSION: this.sessionId,
      FLIWRIGHT_RUNNER_GENERATION: this.identity.generation, FLIWRIGHT_RUNNER_DEVICE: this.identity.deviceId,
      FLIWRIGHT_RUNNER_APP: this.identity.appId };
  }

  waitUntilReady(options: { signal: AbortSignal }): Promise<void> {
    if (this.ready) return Promise.resolve();
    if (this.closed) return Promise.reject(new NativeError('runner_unavailable', 'Runner broker closed before readiness.'));
    return new Promise((resolve, reject) => {
      const abort = () => { cleanup(); reject(new NativeError('runner_unavailable', 'XCTest Runner did not become ready before startup was cancelled or timed out.')); };
      const listener = () => { cleanup(); this.ready ? resolve() : reject(new NativeError('runner_unavailable', 'Runner broker closed.')); };
      const cleanup = () => { this.readyListeners.delete(listener); options.signal.removeEventListener('abort', abort); };
      this.readyListeners.add(listener);
      options.signal.addEventListener('abort', abort, { once: true });
      if (options.signal.aborted) abort();
    });
  }

  async request(operation: string, payload: unknown, context: NativeOperationContext): Promise<unknown> {
    if (!this.ready || this.closed) throw new NativeError('runner_unavailable', 'XCTest Runner is not ready.');
    if (this.unfinished) throw new NativeError('precondition_failed', 'A delivered XCTest request did not finish; close and prepare a new Runner session.');
    if (this.pending) throw new NativeError('precondition_failed', 'Runner accepts one operation at a time.');
    if (!['snapshot', 'click', 'fill', 'swipe', 'screenshot'].includes(operation)) throw new NativeError('unsupported_capability', 'Unsupported XCTest operation.');
    const budget = context.deadline - Date.now();
    if (budget <= 0 || context.signal.aborted) throw new NativeError('cancelled', 'Runner operation cancelled before delivery.');
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending: Pending | undefined;
    let abort: (() => void) | undefined;
    try {
      return await new Promise((resolve, reject) => {
        pending = { requestId: randomUUID(), parentRequestId: context.requestId, operation, payload, context, delivered: false, resolve, reject };
        const cancelled = () => {
          const writing = !['snapshot', 'screenshot'].includes(operation);
          if (pending!.delivered) this.unfinished = true;
          reject(new NativeError(pending!.delivered && writing ? 'action_outcome_unknown' : 'timeout',
            pending!.delivered && writing ? 'XCTest action outcome is unknown; it must not be replayed.' : 'XCTest request timed out or was cancelled.'));
        };
        timer = setTimeout(cancelled, budget);
        abort = cancelled;
        context.signal.addEventListener('abort', abort, { once: true });
        this.pending = pending;
        this.deliver();
      });
    } finally {
      clearTimeout(timer);
      if (abort) context.signal.removeEventListener('abort', abort);
      if (this.pending === pending) this.pending = undefined;
    }
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const auth = request.headers.authorization ?? '';
    const expected = `Bearer ${this.token}`;
    if (Buffer.byteLength(auth) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(auth), Buffer.from(expected))) {
      this.respond(response, 401, {}); return;
    }
    if (this.closed) { this.respond(response, 503, {}); return; }
    if (request.method === 'POST' && request.url === '/ready') {
      const body = await this.readBody(request);
      if (body.protocolVersion !== runnerProtocolVersion || body.sessionId !== this.sessionId || body.generation !== this.identity.generation
        || body.deviceId !== this.identity.deviceId || body.appId !== this.identity.appId
        || !Number.isSafeInteger(body.runnerPid) || (body.runnerPid as number) <= 0
        || !Number.isSafeInteger(body.recoveryPort) || (body.recoveryPort as number) < 1 || (body.recoveryPort as number) > 65535
        || this.ready && (this.activeRunnerPid !== body.runnerPid || this.activeRecoveryPort !== body.recoveryPort)) { this.respond(response, 409, {}); return; }
      this.activeRunnerPid = body.runnerPid as number;
      this.activeRecoveryPort = body.recoveryPort as number;
      this.ready = true;
      this.respond(response, 200, {});
      for (const listener of [...this.readyListeners]) listener();
      return;
    }
    if (!this.ready) { this.respond(response, 409, {}); return; }
    if (request.method === 'GET' && request.url === '/next') {
      if (this.poll) { this.respond(response, 409, {}); return; }
      const timer = setTimeout(() => { this.poll = undefined; this.respond(response, 204); }, 2000);
      this.poll = { response, timer };
      response.on('close', () => {
        if (this.poll?.response === response) { clearTimeout(timer); this.poll = undefined; }
      });
      this.deliver();
      return;
    }
    if (request.method === 'POST' && request.url === '/result') {
      const body = await this.readBody(request);
      const pending = this.pending;
      if (!pending?.delivered || body.requestId !== pending.requestId) { this.respond(response, 409, {}); return; }
      this.pending = undefined;
      this.respond(response, 200, {});
      if (body.error && typeof body.error === 'object') {
        const error = body.error as { code?: unknown; message?: unknown };
        const code = error.code === 'target_not_found' || error.code === 'not_interactable' || error.code === 'unsupported_capability'
          || error.code === 'precondition_failed' || error.code === 'action_outcome_unknown' ? error.code : 'protocol_mismatch';
        pending.reject(new NativeError(code, typeof error.message === 'string' ? error.message : 'XCTest operation failed.'));
      } else pending.resolve(body.result);
      return;
    }
    this.respond(response, 404, {});
  }

  private deliver(): void {
    const pending = this.pending, poll = this.poll;
    if (!pending || pending.delivered || !poll) return;
    clearTimeout(poll.timer);
    this.poll = undefined;
    const budgetMs = pending.context.deadline - Date.now();
    if (budgetMs <= 0 || pending.context.signal.aborted) { this.respond(poll.response, 204); return; }
    pending.delivered = true;
    this.respond(poll.response, 200, { protocolVersion: runnerProtocolVersion, sessionId: this.sessionId, generation: this.identity.generation,
      requestId: pending.requestId, parentRequestId: pending.parentRequestId, operation: pending.operation, budgetMs, payload: pending.payload });
  }

  private async readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 16 * 1024 * 1024) throw new Error('Runner request exceeds size limit.');
      chunks.push(Buffer.from(chunk));
    }
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Expected object.');
    return body as Record<string, unknown>;
  }
  private respond(response: ServerResponse, status: number, body?: unknown): void {
    if (response.writableEnded || response.destroyed) return;
    response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    response.end(body === undefined ? undefined : JSON.stringify(body));
  }

  async dispose(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.poll) { clearTimeout(this.poll.timer); this.respond(this.poll.response, 503, {}); this.poll = undefined; }
    const pending = this.pending;
    this.pending = undefined;
    if (pending) pending.reject(new NativeError(pending.delivered && !['snapshot', 'screenshot'].includes(pending.operation)
      ? 'action_outcome_unknown' : 'runner_unavailable', 'XCTest command broker closed.'));
    for (const listener of [...this.readyListeners]) listener();
    if (this.server?.listening) await new Promise<void>(resolve => { this.server!.close(() => resolve()); this.server!.closeAllConnections(); });
  }
}
