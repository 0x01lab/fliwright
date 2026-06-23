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

  async connect(): Promise<void> {
    if (this.child) return;

    this.child = spawn(this.opts.flutterBin ?? 'flutter', ['daemon', ...(this.opts.extraArgs ?? [])], {
      cwd: this.opts.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => {
      this.buffer += chunk;
      let nl: number;
      while ((nl = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, nl);
        this.buffer = this.buffer.slice(nl + 1);
        for (const message of parseDaemonLines(line)) this.dispatch(message);
      }
    });

    this.child.on('error', (error) => this.rejectAll(error));
    this.child.on('exit', (code, signal) => {
      this.rejectAll(new Error(`flutter daemon exited with code ${code ?? 'null'} signal ${signal ?? 'null'}`));
    });
  }

  request<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (!this.child) throw new Error('SubprocessDaemonTransport is not connected');

    const id = this.seq++;
    const line = `${JSON.stringify([{ id, method, params }])}\n`;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.child?.stdin.write(line, (error) => {
        if (!error) return;
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  onEvent(handler: (message: DaemonMessage) => void): () => void {
    this.listeners.add(handler);
    return () => {
      this.listeners.delete(handler);
    };
  }

  async dispose(): Promise<void> {
    const child = this.child;
    this.child = undefined;
    this.buffer = '';
    this.rejectAll(new Error('SubprocessDaemonTransport disposed'));
    child?.kill();
  }

  private dispatch(message: DaemonMessage): void {
    if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
      const id = Number(message.id);
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
      return;
    }

    if (message.event) {
      for (const listener of this.listeners) listener(message);
    }
  }

  private rejectAll(error: unknown): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}
