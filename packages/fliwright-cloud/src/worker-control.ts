import { WebSocketServer, WebSocket } from 'ws';
import type { Server, IncomingMessage } from 'node:http';
import { ZodError } from 'zod';
import { CloudError, workerControlRequestSchema, type WorkerControlMessage } from '@fliwright/cloud-protocol';
import type { CloudStore } from './CloudStore.js';

/** Only authenticated Workers may upgrade. HTTP uploads remain a separate data plane. */
export function attachWorkerControl(server: Server, options: {
  store: CloudStore;
  authenticate(request: IncomingMessage): string;
  handle(request: IncomingMessage, operation: string, body: unknown): unknown;
}) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 * 1024 + 65536, perMessageDeflate: false });
  const peers = new Map<WebSocket, { workerId: string; alive: boolean; slot?: { id: string; deviceId: string } }>();
  const send = (socket: WebSocket, message: WorkerControlMessage) => {
    if (socket.readyState !== WebSocket.OPEN) return;
    if (socket.bufferedAmount > 8 * 1024 * 1024) { socket.terminate(); return; }
    socket.send(JSON.stringify(message));
  };
  const upgrade = (request: IncomingMessage, socket: import('node:stream').Duplex, head: Buffer) => {
    if (request.url !== '/api/worker/connect') { socket.destroy(); return; }
    let workerId: string;
    try { workerId = options.authenticate(request); }
    catch {
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    wss.handleUpgrade(request, socket, head, ws => {
      const peer = { workerId, alive: true } as { workerId: string; alive: boolean; slot?: { id: string; deviceId: string } };
      peers.set(ws, peer);
      ws.on('error', () => {});
      ws.on('close', () => peers.delete(ws));
      ws.on('pong', () => {
        peer.alive = true;
        options.store.db.prepare('UPDATE workers SET seen_at=? WHERE id=?').run(options.store.now(), workerId);
        if (peer.slot) options.store.db.prepare('UPDATE slots SET runtime_seen_at=? WHERE worker_id=? AND id=? AND runtime_device_id=?')
          .run(options.store.now(), workerId, peer.slot.id, peer.slot.deviceId);
      });
      ws.on('message', (bytes, binary) => {
        let id: string | undefined;
        try {
          if (binary) { ws.close(1003, 'JSON required'); return; }
          const message = workerControlRequestSchema.parse(JSON.parse(bytes.toString()));
          id = message.id;
          const body = options.handle(request, message.operation, message.body);
          if (message.operation === '/api/worker/claim') {
            const input = message.body as { slotId: string; deviceId: string };
            peer.slot = { id: input.slotId, deviceId: input.deviceId };
          }
          send(ws, { type: 'response', id, status: 200, body });
        } catch (error) {
          if (!id) { ws.close(1008, 'Invalid control request'); return; }
          const status = error instanceof CloudError ? error.statusCode : error instanceof ZodError ? 400 : 500;
          send(ws, { type: 'response', id, status, body: { error: 'Worker control operation rejected' } });
        }
      });
      send(ws, { type: 'wake' });
    });
  };
  server.on('upgrade', upgrade);
  const unsubscribe = options.store.onControlChange((requestId, kind) => {
    for (const [socket, peer] of peers) {
      if (kind === 'worker-credential-revoked' && requestId === peer.workerId) { socket.terminate(); continue; }
      if (kind === 'device-inventory' && requestId !== peer.workerId) continue;
      if (kind === 'catalog-scan-updated' && requestId) {
        const scan = options.store.db.prepare('SELECT status,data FROM catalog_scans WHERE scan_id=?').get(requestId);
        if (scan?.status === 'cancelled' && JSON.parse(String(scan.data)).workerId === peer.workerId)
          send(socket, { type: 'scan-cancel', scanId: requestId });
      }
      if (kind === 'cancelled-requested' && requestId) {
        const request = options.store.getRequest(requestId);
        const latest = options.store.attempts(requestId).at(-1);
        if (request.state === 'cancel_requested' && latest?.workerId === peer.workerId)
          send(socket, { type: 'cancel', requestId });
      }
      send(socket, { type: 'wake' });
    }
  });
  const timer = setInterval(() => {
    for (const [socket, peer] of peers) {
      if (!peer.alive) { socket.terminate(); continue; }
      peer.alive = false;
      socket.ping();
    }
  }, 10000);
  timer.unref();
  return () => {
    unsubscribe();
    clearInterval(timer);
    server.removeListener('upgrade', upgrade);
    for (const socket of peers.keys()) socket.terminate();
    wss.close();
  };
}
