import Fastify, { type FastifyRequest } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z, ZodError } from 'zod';
import { CloudStore, digest } from './CloudStore.js';
import { ReportStore } from './ReportStore.js';
import {
  CloudError,
  idSchema,
  leaseKeySchema,
  outcomeSchema,
  resultSchema,
  publicationSchema,
  submissionSchema,
  targetSchema,
} from './contracts.js';

export type Role = 'member' | 'operator' | 'admin';
export interface CloudServerOptions {
  store: CloudStore;
  dataRoot: string;
  publicUrl: string;
  proxySecret: string;
  publicationSecret: string;
  users: Record<string, Role>;
  ciTokens: Array<{ name: string; hash: string }>;
  workerTokens: Array<{ workerId: string; hash: string }>;
  webRoot?: string;
  minFreeBytes?: number;
  maxStorageBytes?: number;
  retentionDays?: number;
}
type Identity = { kind: 'browser' | 'ci' | 'worker'; name: string; role: Role };
const equals = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const param = (req: FastifyRequest, key: string) =>
  idSchema.parse((req.params as Record<string, string>)[key]);
const query = (req: FastifyRequest) =>
  req.query as Record<string, string | undefined>;
const cookie = (req: FastifyRequest) => {
  const raw = req.headers.cookie
    ?.split(';')
    .map((v) => v.trim())
    .find((v) => v.startsWith('cloud_share='));
  return raw?.slice('cloud_share='.length) ?? '';
};
/** Management server. Worker credentials cannot access team or administrative routes. */
export function createCloudServer(options: CloudServerOptions) {
  const app = Fastify({
    logger: false,
    bodyLimit: 32 * 1024 * 1024,
    requestTimeout: 60000,
  });
  if (!options.proxySecret || !options.publicationSecret)
    throw new Error('Proxy and publication secrets are required');
  const { store } = options,
    publicUrl = new URL(options.publicUrl);
  const reports = new ReportStore(store, options.dataRoot, options);
  reports.reconcile();
  const secrets = [options.proxySecret, options.publicationSecret];
  const redact = (message: string) =>
    secrets
      .reduce(
        (text, secret) =>
          secret ? text.split(secret).join('[redacted]') : text,
        message,
      )
      .replace(/(?:wss?|https?):\/\/[^\s"']+/g, '[endpoint]')
      .slice(0, 4000);
  function identity(req: FastifyRequest): Identity {
    const authorization = req.headers.authorization;
    if (authorization?.startsWith('Bearer ')) {
      const hash = digest(authorization.slice(7));
      const worker = options.workerTokens.find((t) => equals(t.hash, hash));
      if (worker)
        return { kind: 'worker', name: worker.workerId, role: 'member' };
      const ci = options.ciTokens.find((t) => equals(t.hash, hash));
      if (ci) return { kind: 'ci', name: `ci:${ci.name}`, role: 'member' };
      throw new CloudError(401, 'Invalid service credential');
    }
    if (
      equals(
        String(req.headers['x-cloud-proxy-secret'] ?? ''),
        options.proxySecret,
      )
    ) {
      const name = String(req.headers['x-cloud-user'] ?? ''),
        role = Object.hasOwn(options.users, name)
          ? options.users[name]
          : undefined;
      if (role) {
        if (
          !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
          req.headers.origin !== publicUrl.origin
        )
          throw new CloudError(403, 'Invalid request origin');
        return { kind: 'browser', name, role };
      }
    }
    throw new CloudError(401, 'Team login required');
  }
  function team(req: FastifyRequest, role: Role = 'member') {
    const who = identity(req);
    if (
      who.kind === 'worker' ||
      ['member', 'operator', 'admin'].indexOf(who.role) <
        ['member', 'operator', 'admin'].indexOf(role)
    )
      throw new CloudError(403, 'Insufficient role');
    return who;
  }
  function worker(req: FastifyRequest) {
    const who = identity(req);
    if (who.kind !== 'worker')
      throw new CloudError(403, 'Worker credential required');
    return who;
  }
  function ownRequest(req: FastifyRequest, id: string) {
    const who = team(req),
      request = store.getRequest(id);
    if (who.kind === 'ci' && request.actor !== who.name)
      throw new CloudError(403, 'Request outside CI scope');
    return { who, request };
  }
  function lease(req: FastifyRequest) {
    const who = worker(req),
      key = leaseKeySchema.parse(req.body);
    if (key.workerId !== who.name)
      throw new CloudError(403, 'Wrong worker identity');
    return key;
  }
  function uploadToken(req: FastifyRequest) {
    return z
      .string()
      .min(16)
      .max(200)
      .parse(req.headers['x-publication-token']);
  }
  function reportScope(req: FastifyRequest, id: string) {
    // An explicit share route/session always stays within its granted scope.
    if (req.url.startsWith('/api/shared/'))
      return reports.authorizeShare(cookie(req), id).sensitive;
    const who = team(req);
    if (
      who.kind === 'ci' &&
      store.getRequest(reports.publication(id).requestId).actor !== who.name
    )
      throw new CloudError(403, 'Report outside CI scope');
    return true;
  }
  app.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer' },
    (_req, body, done) => done(null, body),
  );
  app.addHook('onSend', async (_req, reply) => {
    reply
      .header('Cache-Control', 'no-store')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Referrer-Policy', 'no-referrer')
      .header('X-Frame-Options', 'DENY');
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'",
    );
  });
  app.setErrorHandler((error, _req, reply) => {
    const err = error instanceof Error ? error : new Error('Unknown error');
    const status =
      error instanceof ZodError
        ? 400
        : error instanceof CloudError
          ? error.statusCode
          : 'statusCode' in err && typeof err.statusCode === 'number'
            ? err.statusCode
            : 500;
    reply.status(status).send({
      error: status >= 500 ? 'Service operation failed' : redact(err.message),
    });
  });
  app.get('/healthz', () => ({ status: 'ok' }));
  app.get('/api/me', (req) => team(req));
  app.get('/api/targets', (req) => {
    team(req);
    return store.targets().map((t) => ({
      id: t.id,
      name: t.name,
      suites: Object.keys(t.suites),
      scenarios: t.scenarios,
    }));
  });
  app.get('/api/admin/targets', (req) => {
    team(req, 'admin');
    return store.targets();
  });
  app.put('/api/admin/targets/:id', (req) => {
    const who = team(req, 'admin'),
      target = targetSchema.parse(req.body);
    if (target.id !== param(req, 'id'))
      throw new CloudError(400, 'Target identity mismatch');
    if (
      target.projectPath.startsWith('/') ||
      target.projectPath.split(/[\\/]/).includes('..')
    )
      throw new CloudError(400, 'Project must stay within checkout');
    store.transaction(() => {
      store.db
        .prepare(
          'INSERT INTO targets VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',
        )
        .run(target.id, JSON.stringify(target));
      store.event(null, 'target-updated', {
        actor: who.name,
        targetId: target.id,
      });
    });
    return { id: target.id };
  });
  app.delete('/api/admin/targets/:id', (req) => {
    const who = team(req, 'admin'),
      id = param(req, 'id');
    store.transaction(() => {
      store.db.prepare('DELETE FROM targets WHERE id=?').run(id);
      store.event(null, 'target-removed', { actor: who.name, targetId: id });
    });
    return { id };
  });
  app.get('/api/requests', (req) => {
    const who = team(req),
      q = query(req);
    if (who.kind === 'ci')
      throw new CloudError(403, 'Use the submitted request URL');
    const parsed = z
      .object({
        state: z.string().optional(),
        targetId: idSchema.optional(),
        search: z.string().max(200).optional(),
        offset: z.coerce.number().int().min(0).default(0),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      })
      .parse(q);
    const result = store.listRequests(parsed);
    return {
      ...result,
      items: result.items.map(({ target, ...r }) => r),
      queue: store.queue().map((r) => r.id),
    };
  });
  app.post('/api/requests', (req, reply) => {
    const who = team(req),
      r = store.submit(
        submissionSchema.parse(req.body),
        who.name,
        String(req.headers['idempotency-key'] ?? ''),
      );
    reply.status(201);
    return {
      id: r.id,
      state: r.state,
      url: new URL(`/requests/${r.id}`, publicUrl).href,
    };
  });
  app.get('/api/requests/:id', (req) => {
    const id = param(req, 'id'),
      { request } = ownRequest(req, id);
    const { target, ...safe } = request;
    return {
      ...safe,
      attempts: store.attempts(id),
      reports: reports.list(id),
      queuePosition: store.queue().findIndex((r) => r.id === id) + 1,
    };
  });
  app.post('/api/requests/:id/cancel', (req) => {
    const id = param(req, 'id'),
      { who, request } = ownRequest(req, id);
    if (who.role === 'member' && request.actor !== who.name)
      throw new CloudError(403, 'Only the submitter or an operator can cancel');
    const r = store.cancel(id, who.name);
    return { id: r.id, state: r.state };
  });
  app.post('/api/requests/:id/rerun', (req, reply) => {
    const who = team(req, 'operator'),
      original = store.getRequest(param(req, 'id')),
      r = store.submit(
        original.input,
        who.name,
        String(req.headers['idempotency-key'] ?? ''),
      );
    store.event(r.id, 'manual-rerun', {
      original: original.id,
      actor: who.name,
    });
    reply.status(201);
    return { id: r.id };
  });
  app.get('/api/requests/:id/events', async (req, reply) => {
    const id = param(req, 'id');
    ownRequest(req, id);
    let after = z.coerce
      .number()
      .int()
      .min(0)
      .safe()
      .parse(query(req).after ?? req.headers['last-event-id'] ?? 0);
    if (!req.headers.accept?.includes('text/event-stream'))
      return { events: store.events(id, after) };
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
      'Referrer-Policy': 'no-referrer',
    });
    const send = () => {
      for (const event of store.events(id, after)) {
        reply.raw.write(`id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`);
        after = event.seq;
      }
      reply.raw.write(': keepalive\n\n');
    };
    send();
    const timer = setInterval(send, 2000);
    const close = () => {
      clearInterval(timer);
      reply.raw.end();
    };
    req.raw.on('aborted', close);
    reply.raw.on('close', () => clearInterval(timer));
    // Short streams force proxy identity and permissions to be rechecked on reconnect.
    const expiry = setTimeout(close, 60000);
    reply.raw.on('close', () => clearTimeout(expiry));
  });
  app.get('/api/workers', (req) => {
    team(req);
    return store.listWorkers();
  });
  app.post('/api/workers/:id/pause', (req) => {
    const who = team(req, 'operator'),
      id = param(req, 'id'),
      { paused } = z.object({ paused: z.boolean() }).strict().parse(req.body);
    store.pauseWorker(id, paused, who.name);
    return { id, paused };
  });
  app.get('/api/operations', (req) => {
    team(req, 'operator');
    return {
      storage: reports.capacity(),
      events: store.events(
        null,
        z.coerce
          .number()
          .int()
          .min(0)
          .parse(query(req).after ?? 0),
      ),
    };
  });
  app.post('/api/worker/claim', (req) => {
    const who = worker(req),
      { slotId } = z.object({ slotId: idSchema }).strict().parse(req.body);
    return store.claim(who.name, slotId);
  });
  app.post('/api/worker/heartbeat', (req) => {
    const key = lease(req),
      body = z
        .object({
          stage: z.string().min(1).max(100),
          log: z.string().max(4000).optional(),
        })
        .passthrough()
        .parse(req.body);
    return store.heartbeat(
      key,
      body.stage,
      body.log ? redact(body.log) : undefined,
    );
  });
  app.post('/api/worker/result', (req) => {
    const key = lease(req),
      body = z.object({ result: resultSchema }).passthrough().parse(req.body);
    return store.recordResult(key, body.result);
  });
  app.post('/api/worker/finish', (req) => {
    const key = lease(req),
      { outcome } = z
        .object({ outcome: outcomeSchema })
        .passthrough()
        .parse(req.body);
    const r = store.finish(key, outcome);
    return { id: r.id, state: r.state };
  });
  app.post('/api/worker/recover', (req) => {
    const who = worker(req),
      body = z
        .object({ slotId: idSchema, evidence: z.string().min(1).max(1000) })
        .strict()
        .parse(req.body);
    store.expireLeases();
    store.recoverSlot(who.name, body.slotId, body.evidence);
    return { recovered: true };
  });
  app.post('/api/worker/publications', (req) => {
    const key = lease(req),
      body = z
        .object({ publication: publicationSchema })
        .passthrough()
        .parse(req.body);
    return reports.create(key, body.publication);
  });
  app.put('/api/publications/:id/file', (req) => {
    const id = param(req, 'id');
    if (!Buffer.isBuffer(req.body))
      throw new CloudError(400, 'Expected binary file');
    reports.put(
      id,
      uploadToken(req),
      z.string().parse(query(req).path),
      req.body,
    );
    return { stored: true };
  });
  app.post('/api/publications/:id/commit', (req) =>
    reports.commit(param(req, 'id'), uploadToken(req)),
  );
  for (const prefix of ['/api/reports', '/api/shared/reports']) {
    app.get(`${prefix}/:id`, (req) => {
      const id = param(req, 'id');
      return reports.view(id, reportScope(req, id));
    });
    app.get(`${prefix}/:id/file`, (req, reply) => {
      const id = param(req, 'id'),
        path = z.string().max(500).parse(query(req).path),
        body = reports.file(id, path, reportScope(req, id));
      const type =
        (
          {
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.webp': 'image/webp',
          } as Record<string, string>
        )[extname(path).toLowerCase()] ?? 'text/plain; charset=utf-8';
      reply.type(type);
      return reply.send(body);
    });
  }
  app.get('/api/reports/:id/shares', (req) => {
    team(req);
    return reports.shares(param(req, 'id'));
  });
  app.post('/api/reports/:id/shares', (req, reply) => {
    const who = team(req);
    if (who.kind !== 'browser')
      throw new CloudError(403, 'Browser member required');
    const input = z
        .object({
          ttlMs: z.number().int().positive(),
          sensitive: z.boolean().default(false),
        })
        .strict()
        .parse(req.body),
      share = reports.share(
        param(req, 'id'),
        who.name,
        input.ttlMs,
        input.sensitive,
      );
    reply.status(201);
    return { ...share, url: new URL(`/share#${share.token}`, publicUrl).href };
  });
  app.delete('/api/shares/:id', (req) => {
    const who = team(req);
    if (who.kind !== 'browser')
      throw new CloudError(403, 'Browser member required');
    reports.revoke(param(req, 'id'), who.name);
    return { revoked: true };
  });
  app.post('/api/share/exchange', (req, reply) => {
    if (req.headers.origin !== publicUrl.origin)
      throw new CloudError(403, 'Invalid request origin');
    const { token } = z
        .object({ token: z.string().min(16).max(200) })
        .strict()
        .parse(req.body),
      session = reports.exchange(token);
    reply.header(
      'Set-Cookie',
      `cloud_share=${session.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor((session.expiresAt - store.now()) / 1000)}${publicUrl.protocol === 'https:' ? '; Secure' : ''}`,
    );
    return { url: `/shared/reports/${session.bundleId}` };
  });
  const webRoot =
    options.webRoot ?? fileURLToPath(new URL('./web', import.meta.url));
  app.get('/*', (req, reply) => {
    if (req.url.startsWith('/api/'))
      throw new CloudError(404, 'API route not found');
    const path = req.url.split('?')[0];
    const asset = /^\/assets\/[a-zA-Z0-9_.-]+\.(js|css)$/.test(path);
    const file = asset ? join(webRoot, path) : join(webRoot, 'index.html');
    if (!existsSync(file))
      throw new CloudError(503, 'Web UI has not been built');
    reply.type(
      asset
        ? path.endsWith('.js')
          ? 'application/javascript'
          : 'text/css'
        : 'text/html',
    );
    return readFileSync(file);
  });
  const maintenance = setInterval(() => {
    try {
      store.expireLeases();
      reports.reconcile();
      reports.sweep();
    } catch {
      /* health/operations endpoints retain state for diagnosis */
    }
  }, 10000);
  maintenance.unref();
  app.addHook('onClose', async () => clearInterval(maintenance));
  return app;
}
