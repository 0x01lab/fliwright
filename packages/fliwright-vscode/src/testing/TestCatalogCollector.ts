import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { CollectedFile } from './TestCatalogTree.js';

interface CollectionRequest {
  cwd: string;
  file: string;
  signal?: AbortSignal;
  resolve(value: CollectedFile): void;
  reject(reason: Error): void;
  abort(): void;
}
interface BatchFile extends CollectedFile { error?: string; }
interface BatchResult { files: Record<string, BatchFile>; }

/** Collect through the bundled CLI catalog worker, isolated from the extension host. */
export class TestCatalogCollector {
  private readonly queue: CollectionRequest[] = [];
  private active = false;
  private scheduled: ReturnType<typeof setTimeout> | undefined;
  constructor(
    private readonly worker = new URL('./catalog-worker.mjs', import.meta.url),
    private readonly timeoutMs = 30_000,
  ) {}

  collect(cwd: string, file: string, signal?: AbortSignal): Promise<CollectedFile> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) { reject(new Error('Test collection aborted')); return; }
      const request: CollectionRequest = { cwd, file, signal, resolve, reject,
        abort: () => reject(new Error('Test collection aborted')) };
      signal?.addEventListener('abort', request.abort, { once: true });
      this.queue.push(request);
      this.schedule();
    });
  }

  private schedule(): void {
    if (this.active || this.scheduled || !this.queue.length) return;
    // A tree expansion can request many files in one event-loop turn.
    this.scheduled = setTimeout(() => { this.scheduled = undefined; void this.drain(); }, 40);
  }

  private async drain(): Promise<void> {
    const waiting = this.queue.splice(0);
    const pending = waiting.filter(request => !request.signal?.aborted);
    for (const request of waiting) if (request.signal?.aborted) request.signal.removeEventListener('abort', request.abort);
    if (!pending.length) return;
    const cwd = pending[0].cwd;
    const batch: CollectionRequest[] = [];
    for (const request of pending) {
      if (request.cwd === cwd && batch.length < 32) batch.push(request);
      else this.queue.push(request);
    }
    this.active = true;
    const controller = new AbortController();
    const cancelBatch = () => {
      if (batch.every(request => request.signal?.aborted)) controller.abort();
    };
    for (const request of batch) request.signal?.addEventListener('abort', cancelBatch);
    try {
      const result = await this.runBatch(cwd, [...new Set(batch.map(request => request.file))], controller.signal);
      for (const request of batch) {
        if (request.signal?.aborted) continue;
        const file = result.files[request.file];
        if (file?.error) request.reject(new Error(file.error));
        else if (!file || !Array.isArray(file.nodes)) request.reject(new Error('Missing test collection response'));
        else request.resolve({ nodes: file.nodes });
      }
    } catch (error) {
      for (const request of batch) request.reject(error instanceof Error ? error : new Error(String(error)));
    } finally {
      for (const request of batch) {
        request.signal?.removeEventListener('abort', request.abort);
        request.signal?.removeEventListener('abort', cancelBatch);
      }
      this.active = false;
      this.schedule();
    }
  }

  private runBatch(cwd: string, files: string[], signal: AbortSignal): Promise<BatchResult> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) { reject(new Error('Test collection aborted')); return; }
      const grouped = process.platform !== 'win32';
      // VS Code may supply an Electron executable as process.execPath.
      const child = spawn(process.execPath, [fileURLToPath(this.worker), JSON.stringify({ cwd, files })], {
        cwd, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        stdio: ['ignore', 'pipe', 'pipe'], detached: grouped,
      });
      let stdout = '';
      let stderr = '';
      let bytes = 0;
      let failure: string | undefined;
      const stop = (reason: string): void => {
        failure ??= reason;
        try {
          if (grouped && child.pid) process.kill(-child.pid, 'SIGKILL');
          else child.kill('SIGKILL');
        } catch { /* Already exited. */ }
      };
      const abort = () => stop('Test collection aborted');
      const timer = setTimeout(() => stop(`Test collection timed out after ${this.timeoutMs}ms`), this.timeoutMs);
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
      signal?.addEventListener('abort', abort, { once: true });
      const append = (chunk: string, stream: 'stdout' | 'stderr') => {
        bytes += Buffer.byteLength(chunk);
        if (bytes > 8 * 1024 * 1024) { stop('Test collection output exceeded 8 MiB'); return; }
        if (stream === 'stdout') stdout += chunk;
        else stderr += chunk;
      };
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', chunk => append(chunk, 'stdout'));
      child.stderr.on('data', chunk => append(chunk, 'stderr'));
      child.once('error', error => { cleanup(); reject(error); });
      child.once('close', code => {
        cleanup();
        if (failure || code !== 0) {
          stop(failure ?? 'Test collection failed');
          reject(new Error(`${failure}${stderr.trim() ? `: ${stderr.trim()}` : ''}`));
          return;
        }
        try {
          const marker = 'FLIWRIGHT_EDITOR_CATALOG=';
          const lines = stdout.split(/\r?\n/).filter(line => line.startsWith(marker));
          if (lines.length !== 1) throw new Error('Expected exactly one catalog result');
          const result = JSON.parse(lines[0].slice(marker.length)) as BatchResult;
          if (!result.files || typeof result.files !== 'object') throw new Error('Invalid catalog result');
          resolve(result);
        } catch (cause) { reject(new Error('Invalid test collection response', { cause })); }
      });
    });
  }
}
