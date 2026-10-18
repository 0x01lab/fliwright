import { createConnection } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { CliError } from '../CommandRegistry.js';
export const SESSION_VERSION = 1;
export const SESSION_PACKAGE_VERSION: string = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
export interface SessionControl { id: string; generation: string; pid: number; version: number; packageVersion: string; socket: string; cwd: string; }
export function sessionDirectory(cwd: string, id: string): string {
  if (!/^[a-zA-Z0-9-]{1,64}$/.test(id)) throw new CliError('INVALID_INPUT', 'Invalid session ID.', 2);
  return join(resolve(cwd), '.fliwright', 'sessions', id);
}
export function sessionSocket(cwd: string, id: string): string {
  const hash = createHash('sha256').update(`${resolve(cwd)}:${id}`).digest('hex').slice(0, 24);
  return process.platform === 'win32' ? `\\\\.\\pipe\\fliwright-${hash}` : join(tmpdir(), `fliwright-${hash}.sock`);
}
export async function readSession(cwd: string, id: string): Promise<SessionControl> {
  try {
    const data = JSON.parse(await readFile(join(sessionDirectory(cwd, id), 'control.json'), 'utf8')) as SessionControl;
    if (data.version !== SESSION_VERSION || data.packageVersion !== SESSION_PACKAGE_VERSION || data.cwd !== resolve(cwd)) throw new CliError('SESSION_VERSION_MISMATCH', 'Session version/project mismatch. Close and reopen the session.', 4);
    return data;
  } catch (error) { if (error instanceof CliError) throw error; throw new CliError('SESSION_UNAVAILABLE', `Session ${id} is unavailable.`, 3); }
}
export async function sessionRequest(cwd: string, id: string, request: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
  signal?.throwIfAborted();
  const control = await readSession(cwd, id);
  return new Promise((resolve, reject) => {
    const socket = createConnection(control.socket);
    let body = '';
    const abort = () => { socket.destroy(); reject(signal?.reason); };
    socket.once('connect', () => socket.write(JSON.stringify({ ...request, generation: control.generation, version: SESSION_VERSION, packageVersion: SESSION_PACKAGE_VERSION }) + '\n'));
    socket.on('data', (chunk) => {
      body += String(chunk);
      if (!body.includes('\n')) return;
      socket.end();
      try {
        const response = JSON.parse(body.split('\n')[0]);
        if (response.error) reject(new CliError(response.error.code, response.error.message, response.error.exitCode, response.data));
        else resolve(response.data);
      } catch (error) { reject(error); }
    });
    socket.once('error', () => reject(new CliError('SESSION_UNAVAILABLE', 'Session worker is not reachable; open a new session.', 3)));
    socket.once('close', () => { signal?.removeEventListener('abort', abort); if (!body.includes('\n') && !signal?.aborted) reject(new CliError('SESSION_DISCONNECTED', 'Worker disconnected; inspect operation status before retrying.', 3)); });
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
  });
}
export async function sessionOpenCommand(options: { cwd: string; vmUrl?: string; deviceId?: string; target?: string; config?: string; projectId?: string; flutterArgs?: string[]; scenario?: string }, signal?: AbortSignal) {
  const id = randomUUID();
  const directory = sessionDirectory(options.cwd, id);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const startup = join(directory, 'startup.json');
  await writeFile(startup, JSON.stringify({ ...options, cwd: resolve(options.cwd), id }), { mode: 0o600 });
  const child = spawn(process.execPath, [fileURLToPath(new URL('./worker.js', import.meta.url)), startup], { cwd: options.cwd, detached: true, stdio: 'ignore' });
  let spawnError: Error | undefined;
  child.once('error', (error) => { spawnError = error; });
  child.unref();
  const startupSignal = AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(options.deviceId ? 180000 : 30000)]);
  let ready = false;
  try {
    while (!startupSignal.aborted) {
      if (spawnError || child.exitCode !== null || child.signalCode !== null) throw new CliError('SESSION_START_FAILED', spawnError?.message ?? 'Session worker exited during startup.', 3);
      try {
        const error = await readFile(join(directory, 'startup-error.json'), 'utf8').catch(() => undefined);
        if (error) throw new CliError('SESSION_START_FAILED', JSON.parse(error).message, 3);
        const data = await sessionRequest(options.cwd, id, { type: 'status' }, startupSignal);
        ready = true;
        return { sessionId: id, ...data as object };
      } catch (error) {
        if (error instanceof CliError && error.code === 'SESSION_START_FAILED') throw error;
        await delay(30, undefined, { signal: startupSignal }).catch(() => {});
      }
    }
    throw startupSignal.reason;
  } finally {
    if (!ready && child.pid) { try { process.kill(child.pid, 'SIGTERM'); } catch {} }
  }
}
export async function sessionListCommand(cwd: string) {
  const root = join(resolve(cwd), '.fliwright', 'sessions');
  const ids = await readdir(root).catch(() => []);
  return { sessions: await Promise.all(ids.map(async (id) => {
    try { return { sessionId: id, ...await sessionRequest(cwd, id, { type: 'status' }, AbortSignal.timeout(1000)) as object }; }
    catch { return { sessionId: id, connected: false, status: 'unreachable' }; }
  })) };
}
