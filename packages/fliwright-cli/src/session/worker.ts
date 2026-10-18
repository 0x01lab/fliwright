import { createServer } from 'node:net';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ConnectionHost } from './ConnectionHost.js';
import { SESSION_VERSION, SESSION_PACKAGE_VERSION, sessionDirectory, sessionSocket } from './client.js';
import { classifyError } from '../CommandRegistry.js';

async function main(startup: string) {
  const options = JSON.parse(await readFile(startup, 'utf8'));
  const directory = sessionDirectory(options.cwd, options.id);
  const socketPath = sessionSocket(options.cwd, options.id);
  const generation = randomUUID();
  const host = new ConnectionHost(options);
  const active = new Map<string, AbortController>();
  const claimed = new Set<string>();
  let closing = false;
  let idleTimer: NodeJS.Timeout;
  const touch = () => { clearTimeout(idleTimer); idleTimer = setTimeout(() => { if (!active.size) void close(); else touch(); }, 30 * 60 * 1000); };
  async function persist(id: string, value: unknown) {
    const path = join(directory, 'operations', `${id}.json`);
    await mkdir(join(directory, 'operations'), { recursive: true, mode: 0o700 });
    await writeFile(`${path}.tmp`, JSON.stringify(value), { mode: 0o600 });
    await rename(`${path}.tmp`, path);
  }
  async function close(keepAppAlive = false) {
    if (closing) return;
    closing = true;
    clearTimeout(idleTimer);
    for (const controller of active.values()) controller.abort(new DOMException('Session closing.', 'AbortError'));
    try { await host.close(keepAppAlive); }
    finally { if (server.listening) server.close(); if (process.platform !== 'win32') await rm(socketPath, { force: true }); await rm(join(directory, 'control.json'), { force: true }); }
  }
  const server = createServer((socket) => {
    let body = '';
    socket.setEncoding('utf8');
    socket.on('error', () => {});
    socket.on('data', (chunk) => {
      body += chunk;
      if (body.length > 4 * 1024 * 1024) { socket.destroy(); return; }
      if (!body.includes('\n')) return;
      socket.removeAllListeners('data');
      void (async () => {
        let request: Record<string, any>;
        try {
          request = JSON.parse(body.split('\n')[0]);
          if (request.generation !== generation || request.version !== SESSION_VERSION || request.packageVersion !== SESSION_PACKAGE_VERSION) throw new Error('Session generation/version mismatch.');
          touch();
          let data: unknown;
          if (request.type === 'status') {
            if (request.operationId) {
              if (!/^[a-zA-Z0-9-]{1,64}$/.test(request.operationId)) throw new Error('Invalid operationId.');
              data = JSON.parse(await readFile(join(directory, 'operations', `${request.operationId}.json`), 'utf8'));
            } else data = { ...host.status(), sessionId: options.id, pid: process.pid, generation, version: SESSION_VERSION, operations: [...active.keys()] };
          } else if (request.type === 'cancel') {
            active.get(request.operationId)?.abort(new DOMException('Operation cancelled.', 'AbortError'));
            data = { operationId: request.operationId, cancellationRequested: active.has(request.operationId) };
          } else if (request.type === 'close') { await close(request.keepAppAlive); data = { closed: true }; }
          else if (request.type === 'reconnect') { await host.reconnect(); data = host.status(); }
          else if (request.type === 'execute' && !closing) {
            const operationId = request.operationId;
            if (!/^[a-zA-Z0-9-]{1,64}$/.test(operationId)) throw new Error('Invalid operationId.');
            // Never replay an operation after a lost response.
            if (claimed.has(operationId)) { socket.end(JSON.stringify({ data: { operationId, state: active.has(operationId) ? 'running' : 'unknown', statusCommand: 'session.status' } }) + '\n'); return; }
            claimed.add(operationId);
            const existing = await readFile(join(directory, 'operations', `${operationId}.json`), 'utf8').catch(() => undefined);
            if (existing) { data = JSON.parse(existing); socket.end(JSON.stringify({ data }) + '\n'); return; }
            const controller = new AbortController(); active.set(operationId, controller);
            await persist(operationId, { operationId, state: 'queued', command: request.command });
            try {
              data = await host.execute(request.command, request.input, { requestId: operationId, signal: controller.signal, onStart: () => persist(operationId, { operationId, state: 'running', command: request.command }) });
              socket.end(JSON.stringify({ data }) + '\n');
              await host.whenIdle();
              await persist(operationId, { operationId, state: 'succeeded', data });
            } catch (error) {
              const failure = classifyError(controller.signal.aborted ? controller.signal.reason : error);
              socket.end(JSON.stringify({ error: { code: failure.code, message: failure.message, exitCode: failure.exitCode }, data: failure.data }) + '\n');
              await host.whenIdle();
              await persist(operationId, { operationId, state: controller.signal.aborted ? 'cancelled' : 'failed', error: { code: failure.code, message: failure.message, exitCode: failure.exitCode }, data: failure.data });
            } finally { active.delete(operationId); }
            return;
          } else throw new Error('Unsupported session control request.');
          socket.end(JSON.stringify({ data }) + '\n');
        } catch (error) { socket.end(JSON.stringify({ error: (() => { const failure = classifyError(error); return { code: failure.code, message: failure.message, exitCode: failure.exitCode }; })() }) + '\n'); }
      })();
    });
  });
  const startupController = new AbortController();
  active.set(generation, startupController);
  process.once('SIGINT', () => void close()); process.once('SIGTERM', () => void close());
  try {
    startupController.signal.throwIfAborted();
    if (options.deviceId) {
      const { id: _id, cwd: _cwd, ...input } = options;
      await host.execute('tdd.start', input, { requestId: generation, signal: startupController.signal });
    }
    startupController.signal.throwIfAborted();
    await host.open(startupController.signal);
    startupController.signal.throwIfAborted();
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); });
    if (process.platform !== 'win32') await chmod(socketPath, 0o600);
    await writeFile(join(directory, 'control.json'), JSON.stringify({ id: options.id, cwd: options.cwd, socket: socketPath, generation, version: SESSION_VERSION, packageVersion: SESSION_PACKAGE_VERSION, pid: process.pid }), { mode: 0o600 });
    await rm(startup, { force: true });
    active.delete(generation);
    touch();
  } catch (error) {
    await writeFile(join(directory, 'startup-error.json'), JSON.stringify({ message: error instanceof Error ? error.message : String(error) }));
    await close();
    process.exitCode = 3;
  }
}
void main(process.argv[2]).catch((error) => { console.error(error); process.exitCode = 3; });
