import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { redactDiagnostic, workerLogSchema, type WorkerLog, type WorkerServiceReport, type CloudRequestClient } from '@fliwright/cloud-protocol';

export function readWorkerLogs(root: string): WorkerLog[] {
  const entries: WorkerLog[] = [];
  for (const suffix of ['.3', '.2', '.1', '']) {
    try {
      const text = readFileSync(join(root, 'logs', `worker.jsonl${suffix}`), 'utf8');
      for (const line of text.split('\n')) {
        try { const result = workerLogSchema.safeParse(JSON.parse(line)); if (result.success) entries.push(result.data); } catch { /* Interrupted final writes are skipped. */ }
      }
    } catch { /* No file yet, or a rotation raced the reader. */ }
  }
  return entries;
}

/** Durable service diagnostics exist independently of execution leases and network availability. */
export class WorkerDiagnostics {
  readonly sessionId = randomUUID();
  readonly startedAt = new Date().toISOString();
  readonly path: string;
  private seq = 0;
  private readonly started = performance.now();
  private state: WorkerServiceReport['state'] = 'healthy';
  private readonly components: WorkerServiceReport['components'] = {};
  private storageWarning = false;
  constructor(readonly root: string, private readonly options: { secrets?: string[]; maxBytes?: number } = {}) {
    this.path = join(root, 'logs', 'worker.jsonl');
    mkdirSync(join(root, 'logs'), { recursive: true, mode: 0o700 });
    chmodSync(join(root, 'logs'), 0o700);
    let previous: { sessionId?: string; state?: string; pid?: number } | undefined;
    try { previous = JSON.parse(readFileSync(join(root, 'logs', 'service.json'), 'utf8')); } catch { /* First run. */ }
    this.record('info', 'service.started', `Worker service started; Node ${process.version}; PID ${process.pid}`);
    if (previous && !['stopped', 'failed'].includes(previous.state ?? '')) {
      let alive = false;
      try { if (previous.pid) { process.kill(previous.pid, 0); alive = true; } } catch { /* Previous process is gone. */ }
      this.record('warn', alive ? 'service.concurrent_instance' : 'service.previous_unclean_exit', alive
        ? `Previous service session ${previous.sessionId ?? 'unknown'} has no shutdown record and PID ${previous.pid} still exists; check duplicate instances.`
        : `Previous service session ${previous.sessionId ?? 'unknown'} ended without a shutdown record; inspect the supervisor or OS logs.`);
    }
  }
  record(level: WorkerLog['level'], event: string, error: unknown = '', context: Pick<WorkerLog, 'slotId' | 'requestId' | 'attemptId' | 'spanId'> = {}) {
    if (level === 'fatal') this.state = 'failed';
    if (event === 'service.stopped' && this.state !== 'failed') this.state = 'stopped';
    const clean = (value: string, max: number) => redactDiagnostic(value, this.options.secrets).slice(0, max);
    const entry: WorkerLog = { sessionId: this.sessionId, seq: ++this.seq, at: new Date().toISOString(), level, event,
      message: clean(error instanceof Error ? error.message : String(error), 4000),
      ...(error instanceof Error && error.stack ? { stack: clean(error.stack, 8000) } : {}), ...context };
    try {
      const bytes = JSON.stringify(workerLogSchema.parse(entry)) + '\n';
      if (existsSync(this.path) && statSync(this.path).size + Buffer.byteLength(bytes) > (this.options.maxBytes ?? 1024 * 1024)) {
        if (existsSync(`${this.path}.3`)) unlinkSync(`${this.path}.3`);
        for (let i = 2; i >= 0; i--) { const from = `${this.path}${i ? `.${i}` : ''}`; if (existsSync(from)) renameSync(from, `${this.path}.${i + 1}`); }
      }
      appendFileSync(this.path, bytes, { mode: 0o600 }); chmodSync(this.path, 0o600);
      const statePath = join(this.root, 'logs', 'service.json');
      writeFileSync(statePath, JSON.stringify(this.snapshot()), { mode: 0o600 }); chmodSync(statePath, 0o600);
    } catch {
      if (!this.storageWarning) { this.storageWarning = true; process.stderr.write('Worker diagnostic storage unavailable; check disk space and permissions.\n'); }
    }
    if (level === 'error' || level === 'fatal') process.stderr.write(`[${event}] ${entry.message}\nDiagnostics: ${this.path}\n`);
  }
  component(name: string, state: WorkerServiceReport['components'][string]) { this.components[name] = state; }
  snapshot(eventLoopLagMs = 0): Omit<WorkerServiceReport, 'logs'> {
    return { sessionId: this.sessionId, startedAt: this.startedAt, pid: process.pid, nodeVersion: process.version,
      state: this.state === 'healthy' && Object.values(this.components).includes('failed') ? 'degraded' : this.state,
      uptimeMs: performance.now() - this.started, rssBytes: process.memoryUsage().rss, eventLoopLagMs,
      components: { ...this.components } };
  }
}

/** Bounded replay is deduplicated by Cloud; a failed upload never takes down the Worker. */
export function reportWorkerDiagnostics(log: WorkerDiagnostics, control: CloudRequestClient, intervalMs = 10000) {
  let pending: Promise<void> | undefined, last = performance.now(), stopped = false;
  let deliveryFailed = false;
  const delivered = new Map<string, number>();
  const send = () => {
    if (pending) return pending;
    const now = performance.now(), lag = Math.max(0, now - last - intervalMs); last = now;
    const logs = readWorkerLogs(log.root).filter(entry => entry.seq > (delivered.get(entry.sessionId) ?? 0)).slice(0, 100);
    pending = control.request('/api/worker/diagnostics', { body: { ...log.snapshot(lag), logs }, signal: AbortSignal.timeout(2000) })
      .then(() => {
        for (const entry of logs) delivered.set(entry.sessionId, Math.max(delivered.get(entry.sessionId) ?? 0, entry.seq));
        if (deliveryFailed) log.record('info', 'monitor.delivery_restored', 'Cloud diagnostics delivery resumed'); deliveryFailed = false;
      })
      .catch(error => { if (!deliveryFailed && !stopped) log.record('warn', 'monitor.delivery_failed', error); deliveryFailed = true; })
      .finally(() => { pending = undefined; });
    return pending;
  };
  const connected = control.onConnected?.(() => { if (!stopped) { log.record('info', 'monitor.connected', 'Cloud monitoring connection established'); void send(); } });
  void send();
  const timer = setInterval(() => void send(), intervalMs); timer.unref();
  return async () => { stopped = true; clearInterval(timer); connected?.(); await pending; await send(); };
}
