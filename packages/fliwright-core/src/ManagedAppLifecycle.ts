import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { normalizeVmServiceUrl } from './VmServiceEndpoint.js';
import { parseAndroidAppExpectation, type AndroidAppExpectation } from './native/AndroidAppReadback.js';
import { scenarioDeviceCapabilityDiagnostic } from './ScenarioDevicePreparation.js';

/** Private, ephemeral supervisor access. Never serialize into project config or artifacts. */
export interface ManagedAppControl { url: string; token: string; sessionId: string; timeoutMs: number; }
export interface ManagedAppAttemptRequest { attemptKey: string; scenarioName?: string; scenarioFingerprint?: string; }
export interface ManagedAppLaunchEndpoint { url: string; nativeApp?: AndroidAppExpectation; }
export interface ManagedAppAttemptEndpoint extends ManagedAppLaunchEndpoint { generation: string; }
export const MANAGED_APP_CONTROL_ENV = 'FLIWRIGHT_MANAGED_APP_CONTROL';

const preparationPhases = ['preparation', 'validate-scenario', 'build-app', 'install-app', 'stop-app', 'prepare-device', 'launch-app', 'verify-endpoint'] as const;
export type ManagedAppPreparationPhase = typeof preparationPhases[number];
/** Reports a fixed phase name only; paths, URLs and platform error text are never public. */
export type ManagedAppPhaseReporter = (phase: ManagedAppPreparationPhase) => void;

export interface ManagedAppLifecycleOptions {
  /** Owner performs stop -> device preparation -> launch -> endpoint verification. */
  prepare(request: ManagedAppAttemptRequest, signal: AbortSignal, reportPhase: ManagedAppPhaseReporter): Promise<ManagedAppLaunchEndpoint>;
  timeoutMs?: number;
  cleanupTimeoutMs?: number;
  signal?: AbortSignal;
  /** Supervisor-only diagnosis; never returned over the private control protocol. */
  onError?(error: unknown): void;
}

/** One authenticated loopback channel per owned managed app. Writes are never replayed. */
export class ManagedAppLifecycle {
  private server?: Server;
  private control?: ManagedAppControl;
  private readonly token = randomBytes(32).toString('hex');
  private readonly sessionId = randomUUID();
  private readonly seen = new Set<string>();
  private readonly lifetime = new AbortController();
  private active?: { controller: AbortController; settled: Promise<void> };
  private unusable = false;
  private failureSummary?: string;
  private closed = false;
  private closing?: Promise<void>;

  constructor(private readonly options: ManagedAppLifecycleOptions) {
    for (const value of [options.timeoutMs ?? 120000, options.cleanupTimeoutMs ?? 15000]) {
      if (!Number.isSafeInteger(value) || value <= 0 || value > 600000) throw new Error('Managed app budgets must be positive and at most 600000ms.');
    }
  }

  async start(): Promise<ManagedAppControl> {
    if (this.server || this.closed) throw new Error('Managed app control cannot start twice.');
    this.options.signal?.throwIfAborted();
    const server = createServer((request, response) => {
      void this.handle(request, response).catch(() => reply(response, 400, { error: 'Invalid managed app request.' }));
    });
    this.server = server;
    server.headersTimeout = 5000; server.requestTimeout = 5000; server.maxHeadersCount = 20;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Managed app control could not bind loopback.');
    this.control = { url: `http://127.0.0.1:${address.port}`, token: this.token, sessionId: this.sessionId, timeoutMs: this.options.timeoutMs ?? 120000 };
    return { ...this.control };
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const expected = Buffer.from(`Bearer ${this.token}`), auth = Buffer.from(request.headers.authorization ?? '');
    if (auth.length !== expected.length || !timingSafeEqual(auth, expected)) { reply(response, 401, { error: 'Managed app authorization failed.' }); return; }
    if (request.method !== 'POST' || request.url !== '/prepare') { reply(response, 404, {}); return; }
    if (this.closed || this.options.signal?.aborted || this.unusable) {
      reply(response, 409, { error: `Managed app lifecycle is unusable; start a new managed run.${this.failureSummary ? ` Original failure: ${this.failureSummary}` : ''}` }); return;
    }
    if (this.active) { reply(response, 409, { error: 'Managed app lifecycle is busy.' }); return; }
    const body = await readBody(request);
    if (body.protocolVersion !== 1 || body.sessionId !== this.sessionId || !validRequest(body)
      || Object.keys(body).some(key => !['protocolVersion', 'sessionId', 'attemptKey', 'scenarioName', 'scenarioFingerprint'].includes(key))) {
      reply(response, 400, { error: 'Invalid managed app protocol or attempt.' }); return;
    }
    // A second request may arrive while the first one is reading its body.
    if (this.active || this.closed || this.unusable) { reply(response, 409, { error: 'Managed app lifecycle is busy or unusable.' }); return; }
    if (this.seen.has(body.attemptKey)) { reply(response, 409, { error: 'Managed app attempt was already requested; writes cannot be replayed.' }); return; }
    if (this.seen.size >= 10000) { reply(response, 409, { error: 'Managed app attempt limit reached.' }); return; }
    this.seen.add(body.attemptKey);
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, this.lifetime.signal,
      ...(this.options.signal ? [this.options.signal] : [])]);
    const timeout = setTimeout(() => controller.abort(new Error('Managed app preparation timed out.')), this.control!.timeoutMs);
    const disconnect = () => { if (!response.writableFinished) controller.abort(new Error('Managed app client disconnected.')); };
    response.once('close', disconnect);
    let abort: (() => void) | undefined;
    let phase: ManagedAppPreparationPhase = 'preparation';
    let reportingClosed = false;
    const reportPhase: ManagedAppPhaseReporter = next => {
      if (!preparationPhases.includes(next)) throw new Error('Invalid managed app preparation phase.');
      if (!reportingClosed) phase = next;
    };
    const work = Promise.resolve().then(() => {
      signal.throwIfAborted();
      return this.options.prepare({ attemptKey: body.attemptKey, scenarioName: body.scenarioName, scenarioFingerprint: body.scenarioFingerprint }, signal, reportPhase);
    });
    const state = { controller, settled: work.then(() => undefined, () => undefined) };
    this.active = state;
    // Keep unfinished work visible after its request deadline, fencing all future writes.
    void state.settled.then(() => { if (this.active === state) this.active = undefined; });
    try {
      const endpoint = await Promise.race([work, new Promise<never>((_, reject) => {
        abort = () => reject(signal.reason);
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
      })]);
      signal.throwIfAborted();
      reportPhase('verify-endpoint');
      const url = normalizeVmServiceUrl(endpoint.url);
      if (!url) throw new Error('Invalid managed VM endpoint.');
      const nativeApp = endpoint.nativeApp === undefined ? undefined : parseAndroidAppExpectation(endpoint.nativeApp, body);
      reply(response, 200, { url, generation: randomUUID(), ...(nativeApp ? { nativeApp } : {}) });
    } catch (error) {
      this.unusable = true;
      try { this.options.onError?.(error); } catch { /* Preserve lifecycle failure. */ }
      const diagnostic = (phase as ManagedAppPreparationPhase) === 'prepare-device' ? scenarioDeviceCapabilityDiagnostic(error) : undefined;
      this.failureSummary = `Managed app preparation failed during ${phase}; its outcome may be unknown. Start a new managed run.${diagnostic ? ` ${diagnostic}` : ''}`;
      reply(response, 500, { error: this.failureSummary });
    } finally {
      reportingClosed = true;
      clearTimeout(timeout); response.removeListener('close', disconnect);
      if (abort) signal.removeEventListener('abort', abort);
    }
  }

  dispose(): Promise<void> {
    return this.closing ??= (async () => {
      this.closed = true; this.lifetime.abort(new Error('Managed app lifecycle closed.'));
      if (this.server?.listening) await new Promise<void>(resolve => { this.server!.close(() => resolve()); this.server!.closeAllConnections(); });
      if (this.active) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([this.active.settled, new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('Managed app cleanup could not be confirmed: preparation is still running.')), this.options.cleanupTimeoutMs ?? 15000);
          })]);
        } finally { clearTimeout(timer); }
      }
    })();
  }
}

export function readManagedAppControl(environment: Record<string, string | undefined> = process.env): ManagedAppControl | undefined {
  const encoded = environment[MANAGED_APP_CONTROL_ENV];
  if (!encoded) return;
  let control: ManagedAppControl;
  try { control = JSON.parse(encoded); } catch { throw new Error('Invalid managed app control.'); }
  validateControl(control);
  return control;
}

/** Request once; a lost response never causes a relaunch to be sent again. */
export async function prepareManagedAppAttempt(control: ManagedAppControl, input: ManagedAppAttemptRequest,
  options: { signal?: AbortSignal } = {}): Promise<ManagedAppAttemptEndpoint> {
  validateControl(control);
  if (!validRequest(input)) throw new Error('Invalid managed app attempt request.');
  input = { ...input };
  const signal = AbortSignal.any([AbortSignal.timeout(control.timeoutMs + 1000), ...(options.signal ? [options.signal] : [])]);
  const response = await fetch(`${control.url}/prepare`, { method: 'POST', redirect: 'error', signal,
    headers: { authorization: `Bearer ${control.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ protocolVersion: 1, sessionId: control.sessionId, ...input }) });
  const body = await readBody(response.body!);
  if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Managed app preparation failed.');
  if (Object.keys(body).some(key => !['url', 'generation', 'nativeApp'].includes(key))
    || typeof body.url !== 'string' || !normalizeVmServiceUrl(body.url) || typeof body.generation !== 'string' || !body.generation) throw new Error('Invalid managed app endpoint response.');
  const nativeApp = body.nativeApp === undefined ? undefined : parseAndroidAppExpectation(body.nativeApp, input);
  return { url: body.url, generation: body.generation, ...(nativeApp ? { nativeApp } : {}) };
}

function validateControl(control: ManagedAppControl): void {
  let url: URL;
  try { url = new URL(control?.url); } catch { throw new Error('Managed app control requires an explicit loopback URL.'); }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash
    || !/^[a-f0-9]{64}$/.test(control.token) || typeof control.sessionId !== 'string' || !control.sessionId
    || !Number.isSafeInteger(control.timeoutMs) || control.timeoutMs <= 0 || control.timeoutMs > 600000) throw new Error('Managed app control requires valid credentials, budget and loopback URL.');
}
function validRequest(body: object): body is ManagedAppAttemptRequest {
  const input = body as ManagedAppAttemptRequest;
  return !!input && typeof input.attemptKey === 'string' && input.attemptKey.length > 0 && input.attemptKey.length <= 512
    && ((input.scenarioName === undefined && input.scenarioFingerprint === undefined)
      || (typeof input.scenarioName === 'string' && input.scenarioName.length > 0 && input.scenarioName.length <= 256
        && typeof input.scenarioFingerprint === 'string' && /^[a-f0-9]{64}$/.test(input.scenarioFingerprint)));
}
async function readBody(source: AsyncIterable<Uint8Array>): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of source) {
    size += chunk.length; if (size > 32768) throw new Error('Managed app request exceeds the size limit.');
    chunks.push(Buffer.from(chunk));
  }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid managed app message.');
  return value as Record<string, unknown>;
}
function reply(response: ServerResponse, status: number, body: unknown): void {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
}
