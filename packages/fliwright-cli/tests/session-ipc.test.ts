import { afterEach, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sessionOpenCommand, sessionRequest, sessionDirectory } from '../dist/session/client.js';

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
it('uses a real worker, reuses its connection, journals commands, cancels blocked IO, and reconnects', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fliwright-ipc-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const vm = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise<void>((resolve) => vm.once('listening', resolve));
  cleanups.push(() => new Promise<void>((resolve) => { for (const client of vm.clients) client.terminate(); vm.close(() => resolve()); }));
  let connections = 0, snaps = 0, block = false;
  vm.on('connection', (socket) => {
    connections++;
    socket.on('message', (raw) => {
      const request = JSON.parse(String(raw));
      let result: unknown = {};
      if (request.method === 'getVM') result = { isolates: [{ id: 'isolates/1' }] };
      if (request.method === 'ext.fliwright.handshake') result = { protocolVersion: 2, dartSdkVersion: '3.test' };
      if (request.method === 'ext.fliwright.snap') {
        snaps++; if (block) return;
        result = { snapshot: 'button', refs: [], groupId: 'g', count: 0 };
      }
      socket.send(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));
    });
  });
  const vmUrl = `ws://127.0.0.1:${(vm.address() as { port: number }).port}/ws`;
  const opened = await sessionOpenCommand({ cwd: root, vmUrl });
  const id = opened.sessionId;
  cleanups.push(() => sessionRequest(root, id, { type: 'close' }, AbortSignal.timeout(5000)).catch(() => {}));
  await sessionRequest(root, id, { type: 'execute', operationId: 'one', command: 'app.snapshot', input: {} });
  await sessionRequest(root, id, { type: 'execute', operationId: 'two', command: 'app.snapshot', input: {} });
  expect(connections).toBe(1);
  expect(snaps).toBe(2);
  await sessionRequest(root, id, { type: 'execute', operationId: 'one', command: 'app.snapshot', input: {} });
  expect(snaps).toBe(2);
  block = true;
  const work = sessionRequest(root, id, { type: 'execute', operationId: 'blocked', command: 'app.snapshot', input: {} });
  const rejection = expect(work).rejects.toMatchObject({ code: 'CANCELLED', exitCode: 130 });
  for (let i = 0; i < 100 && snaps < 3; i++) await new Promise((resolve) => setTimeout(resolve, 10));
  expect(snaps).toBe(3);
  await sessionRequest(root, id, { type: 'cancel', operationId: 'blocked' });
  await rejection;
  block = false;
  await sessionRequest(root, id, { type: 'reconnect' });
  await sessionRequest(root, id, { type: 'execute', operationId: 'three', command: 'app.snapshot', input: {} });
  expect(connections).toBe(2);
  const control = JSON.parse(await readFile(join(sessionDirectory(root, id), 'control.json'), 'utf8'));
  expect(control).toMatchObject({ version: 1, cwd: root });
  const status = await sessionRequest(root, id, { type: 'status', operationId: 'blocked' });
  expect(status).toMatchObject({ operationId: 'blocked', state: 'cancelled' });
}, 20000);
