import { expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import { WorkerControlClient } from '../src/WorkerControlClient.js';
import type { ExecutionLease } from '../src/contracts.js';

it('keeps heartbeats and lease ownership alive after diagnostic delivery times out', async () => {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address() as { port: number };
  server.on('connection', socket => socket.on('message', bytes => {
    const request = JSON.parse(String(bytes));
    // A stuck diagnostic writer must not interrupt the control connection.
    if (request.operation === '/api/worker/timeline') return;
    socket.send(JSON.stringify({ type: 'response', id: request.id, status: 200, body: { cancelRequested: false } }));
  }));
  const client = new WorkerControlClient(`http://127.0.0.1:${address.port}`, 'synthetic');
  let lost = false;
  try {
    await client.ready();
    const unwatch = client.watchLease({ request: { id: 'request' } } as ExecutionLease, reason => { if (reason === 'lost') lost = true; });
    await expect(client.request('/api/worker/timeline', { signal: AbortSignal.timeout(20) })).rejects.toThrow(/timed out|aborted/);
    expect(await client.request('/api/worker/heartbeat')).toEqual({ cancelRequested: false });
    expect(client.connected).toBe(true);
    expect(lost).toBe(false);
    unwatch();
  } finally {
    client.close();
    for (const socket of server.clients) socket.terminate();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

it('notifies inventory observers when the control connection reopens without replaying requests', async () => {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address() as { port: number };
  const client = new WorkerControlClient(`http://127.0.0.1:${address.port}`, 'synthetic', { reconnectMs: 10 });
  let opens = 0;
  try {
    const unsubscribe = client.onConnected(() => { opens++; });
    await client.ready();
    expect(opens).toBe(1);
    const reopened = new Promise<void>(resolve => { client.onConnected(resolve); });
    for (const socket of server.clients) socket.terminate();
    await reopened;
    expect(opens).toBe(2);
    unsubscribe();
  } finally {
    client.close();
    for (const socket of server.clients) socket.terminate();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
