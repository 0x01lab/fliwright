import { afterEach, expect, it } from 'vitest';
import { createHmac, randomBytes } from 'node:crypto';
import { createServer, type Server, type Socket } from 'node:net';
import { RunnerRecoveryClient } from '../../src/ios/RunnerRecoveryClient.js';

const secret = 'a1'.repeat(32);
const identity = { sessionId: '00000000-0000-4000-8000-000000000001', generation: '00000000-0000-4000-8000-000000000002',
  deviceId: '00000000-0000-4000-8000-000000000003', simulatorBootedAt: '2026-11-04T02:00:00.000Z', runnerPid: 456 };
const resources: { server: Server; sockets: Set<Socket> }[] = [];
afterEach(async () => {
  await Promise.all(resources.splice(0).map(async ({ server, sockets }) => {
    sockets.forEach(socket => socket.destroy());
    await new Promise<void>(resolve => server.close(() => resolve()));
  }));
});
const context = (timeout = 1000, signal = new AbortController().signal) => ({ requestId: 'recovery', deadline: Date.now() + timeout, signal });
type Envelope = Record<string, unknown>;
function signature(body: Envelope, key = secret): string {
  return createHmac('sha256', Buffer.from(key, 'hex')).update(['fliwright-runner-recovery', '1', body.direction,
    body.operation, body.nonce, body.sessionId, body.generation, body.deviceId, body.simulatorBootedAt,
    String(body.runnerPid), body.status ?? ''].join('\n')).digest('hex');
}
function response(request: Envelope): Envelope {
  const result = { ...request, direction: 'response', status: request.operation === 'identify' ? 'identified' : 'stopping' };
  return { ...result, signature: signature(result) };
}
async function serverFor(handle: (request: Envelope, socket: Socket) => void) {
  const sockets = new Set<Socket>();
  const server = createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {});
    let input = '';
    socket.on('data', chunk => {
      input += chunk.toString('utf8');
      if (input.endsWith('\n')) handle(JSON.parse(input), socket);
    });
  });
  resources.push({ server, sockets });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  return new RunnerRecoveryClient({ ...identity, recoveryPort: port, recoveryKey: secret });
}

it('authenticates a fresh, identity-bound challenge and accepts a fragmented signed response', async () => {
  const nonces: string[] = [];
  const client = await serverFor((request, socket) => {
    expect(request).toMatchObject({ ...identity, version: 1, direction: 'request', operation: 'identify' });
    expect(request.signature).toBe(signature(request));
    expect(request.nonce).toMatch(/^[a-f0-9]{64}$/);
    nonces.push(request.nonce as string);
    const frame = JSON.stringify(response(request)) + '\n';
    socket.write(frame.slice(0, 12)); socket.end(frame.slice(12));
  });
  await expect(client.request('identify', context())).resolves.toBe('identified');
  await expect(client.request('identify', context())).resolves.toBe('identified');
  expect(new Set(nonces).size).toBe(2);
});

it.each(['key', 'generation', 'device', 'nonce', 'direction', 'status', 'extra-field'] as const)(
  'refuses an unauthenticated or mismatched response (%s)', async scenario => {
    const client = await serverFor((request, socket) => {
      const reply = response(request);
      if (scenario === 'generation') reply.generation = '00000000-0000-4000-8000-000000000099';
      if (scenario === 'device') reply.deviceId = '00000000-0000-4000-8000-000000000099';
      if (scenario === 'nonce') reply.nonce = randomBytes(32).toString('hex');
      if (scenario === 'direction') reply.direction = 'request';
      if (scenario === 'status') reply.status = 'stopping';
      if (scenario === 'extra-field') reply.command = 'kill';
      reply.signature = signature(reply, scenario === 'key' ? 'b2'.repeat(32) : secret);
      socket.end(JSON.stringify(reply) + '\n');
    });
    await expect(client.request('identify', context())).rejects.toMatchObject({ code: 'device_mismatch' });
  },
);

it('sends shutdown once and fences later requests even when its reply is lost', async () => {
  let deliveries = 0;
  const client = await serverFor((request, socket) => { expect(request.operation).toBe('shutdown'); deliveries++; socket.destroy(); });
  await expect(client.request('shutdown', context())).rejects.toMatchObject({ code: 'action_outcome_unknown' });
  await expect(client.request('shutdown', context())).rejects.toMatchObject({ code: 'precondition_failed' });
  await expect(client.request('identify', context())).rejects.toMatchObject({ code: 'precondition_failed' });
  expect(deliveries).toBe(1);
});

it('returns only an authenticated shutdown acknowledgment without claiming platform absence', async () => {
  const client = await serverFor((request, socket) => socket.end(JSON.stringify(response(request)) + '\n'));
  await expect(client.request('shutdown', context())).resolves.toBe('stopping');
  await expect(client.request('shutdown', context())).rejects.toMatchObject({ code: 'precondition_failed' });
});

it('rejects oversized responses and never includes raw frames or keys in errors', async () => {
  const client = await serverFor((_request, socket) => socket.end(secret.repeat(100)));
  try { await client.request('identify', context()); throw new Error('Expected rejection'); }
  catch (error) {
    expect(error).toMatchObject({ code: 'device_mismatch' });
    expect(String(error)).not.toContain(secret);
  }
});

it('honors cancellation before connecting and deadline while a partial response is pending', async () => {
  let connections = 0;
  const client = await serverFor((_request, socket) => { connections++; socket.write('{'); });
  await expect(client.request('identify', context(1000, AbortSignal.abort()))).rejects.toMatchObject({ code: 'cancelled' });
  expect(connections).toBe(0);
  await expect(client.request('identify', context(40))).rejects.toMatchObject({ code: 'timeout' });
});

it.each([0, 65536, 1.5])('rejects an invalid endpoint before transport work (%s)', port => {
  expect(() => new RunnerRecoveryClient({ ...identity, recoveryPort: port, recoveryKey: secret })).toThrow();
});
