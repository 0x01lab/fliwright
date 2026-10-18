import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { DaemonMessage, DaemonTransport } from './DaemonTransport.js';

export function parseDaemonLines(line: string): DaemonMessage[] {
  const trimmed = line.trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return Array.isArray(parsed) ? parsed as DaemonMessage[] : [parsed as DaemonMessage];
  } catch {
    return [];
  }
}

export interface SubprocessDaemonTransportOptions {
  flutterBin?: string;
  cwd?: string;
  extraArgs?: string[];
}

export class SubprocessDaemonTransport implements DaemonTransport {
  private child?: ChildProcessWithoutNullStreams;
  private buffer = '';
  private seq = 0;
  private readonly pending = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: unknown) => void;
  }>();
  private readonly listeners = new Set<(message: DaemonMessage) => void>();

  constructor(private readonly opts: SubprocessDaemonTransportOptions = {}) {}

  private connected = false;
  private starting?: { resolve: (value: unknown) => void; reject: (error: unknown) => void };
  private stderr = '';
  private startingApp?: Record<string, unknown>;

  async connect(): Promise<void> { this.connected = true; }

  private launch(params: Record<string, unknown>): Promise<unknown> {
    if (this.child) throw new Error('A managed Flutter app is already running.');
    if (params.mode === 'drive') throw new Error('Managed VM Service launch uses flutter run; drive mode is not supported.');
    const bin = this.opts.flutterBin ?? 'flutter';
    const args = ['run', '--machine', '-d', String(params.deviceId), '-t', String(params.target ?? 'lib/main.dart'),
      ...(Array.isArray(params.flutterArgs) ? params.flutterArgs.map(String) : []), ...(this.opts.extraArgs ?? [])];
    this.stderr = ''; this.buffer = ''; this.startingApp = undefined;
    return new Promise((resolve, reject) => {
      this.starting = { resolve, reject };
      const child = spawn(bin, args, { cwd: typeof params.projectId === 'string' ? params.projectId : this.opts.cwd,
        stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
      this.child = child;
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        this.buffer += chunk;
        let nl: number;
        while ((nl = this.buffer.indexOf('\n')) >= 0) {
          const line = this.buffer.slice(0, nl); this.buffer = this.buffer.slice(nl + 1);
          for (const message of parseDaemonLines(line)) this.dispatch(message);
        }
      });
      child.stderr.on('data', (chunk) => { this.stderr = (this.stderr + String(chunk)).slice(-8192); });
      child.on('error', (error) => this.rejectAll(new Error(`Failed to start ${bin} run --machine: ${error.message}`)));
      child.on('exit', (code, signal) => {
        if (this.child === child) {
          this.child = undefined;
          this.rejectAll(new Error(`flutter run --machine exited with code ${code ?? 'null'} signal ${signal ?? 'null'}${this.stderr ? `: ${this.stderr}` : ''}`));
        }
      });
    });
  }

  request<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (!this.connected) throw new Error('SubprocessDaemonTransport is not connected');
    // app.start is the controller's launch abstraction. Flutter itself launches
    // through run --machine and emits app.start; it has no app.start RPC.
    if (method === 'app.start') return this.launch(params) as Promise<T>;
    if (!this.child) throw new Error('No managed Flutter app is running');
    const id = this.seq++;
    const line = `${JSON.stringify([{ id, method, params }])}\n`;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.child?.stdin.write(line, (error) => {
        if (!error) return;
        this.pending.delete(id); reject(error);
      });
    });
  }

  onEvent(handler: (message: DaemonMessage) => void): () => void {
    this.listeners.add(handler);
    return () => {
      this.listeners.delete(handler);
    };
  }

  async dispose(options: { keepAppAlive?: boolean } = {}): Promise<void> {
    const child = this.child;
    this.child = undefined;
    this.buffer = '';
    this.rejectAll(new Error('SubprocessDaemonTransport disposed'));
    this.connected = false;
    if (child?.pid && child.exitCode === null && child.signalCode === null) {
      if (options.keepAppAlive) {
        child.stdin.end();
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 2000);
          child.once('exit', () => { clearTimeout(timer); resolve(); });
        });
      }
      if (child.exitCode === null && child.signalCode === null) {
        const terminate = (signal: NodeJS.Signals) => { try { process.kill(process.platform === 'win32' ? child.pid! : -child.pid!, signal); } catch {} };
        terminate('SIGTERM');
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => { terminate('SIGKILL'); resolve(); }, 2000);
          child.once('exit', () => { clearTimeout(timer); resolve(); });
        });
      }
    }
  }

  private dispatch(message: DaemonMessage): void {
    if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
      const id = Number(message.id);
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      if (message.error) pending.reject(new Error(typeof message.error === 'string' ? message.error : message.error.message));
      else pending.resolve(message.result);
      return;
    }

    if (message.event === 'app.start' && this.starting) this.startingApp = message.params;
    if (message.event === 'app.started' && this.starting && message.params?.appId === this.startingApp?.appId) {
      this.starting.resolve(this.startingApp); this.starting = undefined;
    }
    if (message.event === 'app.stop' && this.starting) this.rejectAll(new Error(`Flutter app stopped during startup: ${JSON.stringify(message.params)}${this.stderr}`));
    if (message.event === 'app.log' && message.params?.error) this.stderr = (this.stderr + String(message.params.log ?? '')).slice(-8192);
    if (message.event) {
      for (const listener of this.listeners) listener(message);
    }
  }

  private rejectAll(error: unknown): void {
    this.starting?.reject(error); this.starting = undefined;
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}
