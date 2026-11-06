import { afterEach, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import { verifyInstalledAndroidEndpoint } from '../src/InstalledAndroidRun.js';

const servers: WebSocketServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => {
    for (const client of server.clients) client.terminate(); server.close(() => resolve());
  })));
});
async function fixture(options: { pid?: unknown; capabilities?: object; blockPid?: boolean } = {}) {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' }); servers.push(server);
  await new Promise<void>(resolve => server.once('listening', resolve));
  let connections = 0;
  const requests: Array<{ connection: number; method: string }> = [];
  let entered!: () => void;
  const pidRequested = new Promise<void>(resolve => { entered = resolve; });
  server.on('connection', socket => {
    const connection = ++connections;
    socket.on('message', raw => {
      const request = JSON.parse(String(raw)); requests.push({ connection, method: request.method });
      let result: unknown = {};
      if (request.method === 'getVM') {
        if (connection > 1) { entered(); if (options.blockPid) return; }
        result = { pid: options.pid === undefined ? 123 : options.pid, isolates: [{ id: 'isolates/1' }] };
      }
      if (request.method === 'ext.fliwright.handshake') result = { status: 'ok', compatible: true, initialized: true, protocolVersion: 2, bridgeCapabilities: options.capabilities ?? { snap: true } };
      socket.send(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));
    });
  });
  return { server, requests, pidRequested, url: `ws://127.0.0.1:${(server.address() as { port: number }).port}/auth=/ws` };
}

it('verifies the Bridge and then independently reads the current VM PID before allowing binding', async () => {
  const f = await fixture();
  expect(await verifyInstalledAndroidEndpoint(f.url, 123, ['snap'], new AbortController().signal)).toBe(123);
  expect(f.requests).toContainEqual({ connection: 1, method: 'ext.fliwright.handshake' });
  expect(f.requests).toContainEqual({ connection: 2, method: 'getVM' });
});
it.each([124, '123', null, -1])('rejects a mismatched or invalid VM process identity: %s', async pid => {
  const f = await fixture({ pid });
  await expect(verifyInstalledAndroidEndpoint(f.url, 123, [], new AbortController().signal)).rejects.toThrow(/PID/);
});
it('rejects missing required Bridge features before exposing an endpoint', async () => {
  const f = await fixture({ capabilities: {} });
  await expect(verifyInstalledAndroidEndpoint(f.url, 123, ['snap'], new AbortController().signal)).rejects.toThrow(/capabilities/);
  expect(f.requests.some(request => request.connection > 1)).toBe(false);
});
it('interrupts a blocked independent PID read and closes all owned connections', async () => {
  const f = await fixture({ blockPid: true }), controller = new AbortController();
  const work = verifyInstalledAndroidEndpoint(f.url, 123, [], controller.signal);
  const failed = expect(work).rejects.toThrow();
  await f.pidRequested; controller.abort(); await failed;
  await new Promise<void>(resolve => {
    if (![...f.server.clients].some(socket => socket.readyState === 1)) { resolve(); return; }
    for (const socket of f.server.clients) socket.once('close', () => resolve());
  });
});
