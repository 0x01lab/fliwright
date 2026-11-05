import { spawn } from 'node:child_process';

export interface ProcessOptions { cwd?: string; input?: string; signal?: AbortSignal; timeoutMs?: number; }
export type Execute = (command: string, args: string[], options: ProcessOptions) => Promise<string>;
/** Execute without a shell, bound output and time, and reap the owned process on cancellation. */
export const executeProcess: Execute = (command, args, options) => new Promise((resolve, reject) => {
  try { options.signal?.throwIfAborted(); } catch (error) { reject(error); return; }
  const child = spawn(command, args, { cwd: options.cwd, stdio: ['pipe', 'pipe', 'pipe'], shell: false, detached: process.platform !== 'win32' });
  const output: Buffer[] = [];
  let size = 0, failure: Error | undefined, killTimer: ReturnType<typeof setTimeout> | undefined;
  const kill = (signal: NodeJS.Signals) => {
    try { if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal); else child.kill(signal); } catch { /* Process already exited. */ }
  };
  const stop = (error: Error) => {
    failure ??= error; kill('SIGTERM');
    killTimer ??= setTimeout(() => kill('SIGKILL'), 500);
  };
  const abort = () => stop(options.signal?.reason instanceof Error ? options.signal.reason : new Error('Cancelled.'));
  const timer = setTimeout(() => stop(new Error(`${command} timed out.`)), options.timeoutMs ?? 120_000);
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) abort();
  child.stdout.on('data', (data: Buffer) => { size += data.length; if (size > 8 * 1024 * 1024) stop(new Error(`${command} output exceeds 8 MiB.`)); else output.push(data); });
  child.stderr.on('data', (data: Buffer) => { size += data.length; if (size > 8 * 1024 * 1024) stop(new Error(`${command} output exceeds 8 MiB.`)); });
  child.on('error', () => { failure ??= new Error(`Cannot start ${command}; check that it is installed and configured.`); });
  child.stdin.on('error', () => { /* Early exit is reported by close, without an unhandled EPIPE. */ });
  child.on('close', code => {
    clearTimeout(timer); if (killTimer) clearTimeout(killTimer);
    options.signal?.removeEventListener('abort', abort);
    if (failure) reject(failure);
    else if (code !== 0) reject(new Error(`${command} exited with code ${code}; check authentication and configuration.`));
    else resolve(Buffer.concat(output).toString('utf8'));
  });
  child.stdin.end(options.input);
});
