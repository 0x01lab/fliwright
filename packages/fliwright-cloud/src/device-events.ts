import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { CloudStore } from './CloudStore.js';

/** Browser invalidation stream. Device data stays behind the existing authenticated REST API. */
export function registerDeviceEvents(
  app: FastifyInstance,
  store: CloudStore,
  authorize: (request: FastifyRequest) => void,
) {
  const subscribers = new Set<FastifyReply>();
  let previous = '';
  const send = (reply: FastifyReply) => {
    if (reply.raw.writableEnded || reply.raw.destroyed) return;
    if (!reply.raw.write('data: {}\n\n')) reply.raw.end();
  };
  const refresh = () => {
    if (!subscribers.size) return;
    const snapshot = JSON.stringify(store.listDevices());
    if (snapshot === previous) return;
    previous = snapshot;
    for (const reply of subscribers) send(reply);
  };
  const unsubscribe = store.onControlChange(refresh);
  // Freshness/lease expiry also changes readiness without a native device event.
  const freshness = setInterval(refresh, 1000);
  const keepalive = setInterval(() => {
    for (const reply of subscribers) if (!reply.raw.write(': keepalive\n\n')) reply.raw.end();
  }, 15000);
  freshness.unref();
  keepalive.unref();
  app.get('/api/device-events', (request, reply) => {
    authorize(request);
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
      'Referrer-Policy': 'no-referrer',
    });
    if (!subscribers.size) previous = JSON.stringify(store.listDevices());
    subscribers.add(reply);
    // Reconnect always invalidates: events missed while disconnected need no replay.
    send(reply);
    const expiry = setTimeout(() => reply.raw.end(), 60000);
    const dispose = () => { clearTimeout(expiry); subscribers.delete(reply); };
    reply.raw.once('close', dispose);
    request.raw.once('aborted', () => reply.raw.end());
  });
  app.addHook('preClose', async () => {
    unsubscribe();
    clearInterval(freshness);
    clearInterval(keepalive);
    for (const reply of subscribers) reply.raw.end();
    subscribers.clear();
  });
}
