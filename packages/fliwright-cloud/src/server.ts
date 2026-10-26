import Fastify, { type FastifyRequest } from 'fastify';
import { timingSafeEqual, randomBytes } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isIP } from 'node:net';
import { z, ZodError } from 'zod';
import { projectRepositoryDetails, projectSetupDefaults } from './project-setup.js';
import { CloudStore, digest } from './CloudStore.js';
import { ReportStore } from './ReportStore.js';
import { attachWorkerControl } from './worker-control.js';
import { registerDeviceEvents } from './device-events.js';
import {
  CloudError,
  workerPairingRequestSchema,
  idSchema,
  leaseKeySchema,
  outcomeSchema,
  resultSchema,
  publicationSchema,
  submissionSchema,
  targetSchema,
  projectSchema,
  projectSubmissionSchema,
  webhookPushSchema,
  scanLeaseKeySchema,
  catalogSchema,
  workerTimelineClockSchema,
  workerTimelineFinishSchema,
} from '@fliwright/cloud-protocol';

export type Role = 'member' | 'operator' | 'admin';
export interface CloudServerOptions {
  store: CloudStore;
  dataRoot: string;
  publicUrl: string;
  /** Explicit local development identity; accepted only from loopback and the configured origin. */
  localUser?: string;
  proxySecret: string;
  publicationSecret: string;
  users: Record<string, Role>;
  ciTokens: Array<{ name: string; hash: string }>;
  workerTokens: Array<{ workerId: string; hash: string }>;
  webRoot?: string;
  minFreeBytes?: number;
  maxStorageBytes?: number;
  retentionDays?: number;
  repositoryHosts?: string[];
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
  if (options.localUser && (!['127.0.0.1', '[::1]', 'localhost'].includes(publicUrl.hostname) ||
      !Object.hasOwn(options.users, options.localUser)))
    throw new Error('Local browser access requires a loopback publicUrl and registered user');
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
      const pairedWorker = store.workerForCredential(hash);
      if (pairedWorker) return { kind: 'worker', name: pairedWorker, role: 'member' };
      const ci = options.ciTokens.find((t) => equals(t.hash, hash));
      if (ci) return { kind: 'ci', name: `ci:${ci.name}`, role: 'member' };
      throw new CloudError(401, 'Invalid service credential');
    }
    if (options.localUser) {
      if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.ip) || req.headers.host !== publicUrl.host)
        throw new CloudError(401, 'Local access requires a loopback connection and configured Host');
      if ((req.headers.origin && req.headers.origin !== publicUrl.origin) ||
          (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin !== publicUrl.origin))
        throw new CloudError(403, 'Invalid request origin');
      return { kind: 'browser', name: options.localUser, role: options.users[options.localUser] };
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
  function validateRepository(repository: string) {
    let url: URL;
    try { url = new URL(repository); } catch { throw new CloudError(400, 'Repository must be an absolute HTTPS or SSH URL'); }
    if (!['https:', 'ssh:'].includes(url.protocol) || url.username && url.protocol === 'https:' || url.password)
      throw new CloudError(400, 'Repository URL protocol or credentials are not allowed');
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (!options.repositoryHosts?.some((allowed) => allowed.toLowerCase() === host))
      throw new CloudError(400, 'Repository host is not in the deployment allowlist');
    const privateV4 = /^10\.|^127\.|^169\.254\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\.|^0\./.test(host);
    const privateV6 = host === '::1' || host === '::' || /^f[cd][0-9a-f]{2}:/i.test(host) || /^fe[89ab][0-9a-f]:/i.test(host);
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || privateV4 || privateV6 || (isIP(host) && (host === '255.255.255.255' || host === '224.0.0.1')))
      throw new CloudError(400, 'Local and private repository hosts are not allowed');
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
  app.get('/api/projects', (req) => {
    team(req);
    return store.projects().map(({ webhookSecretDigest: _secret, ...project }) => project);
  });
  app.post('/api/projects', (req, reply) => {
    const who = team(req, 'admin');
    const input = targetSchema.omit({ id: true, name: true }).extend({
      name: z.string().trim().min(1).max(100).optional(),
      defaultBranch: z.string().trim().min(1).max(200).default('main'),
      repositoryCredentialRef: z.string().trim().min(1).max(200).nullable().default(null),
      suites: targetSchema.shape.suites.default(projectSetupDefaults.suites),
      scenarios: targetSchema.shape.scenarios.default(projectSetupDefaults.scenarios),
    }).strict().parse(req.body);
    const details = projectRepositoryDetails(input.repository);
    if (!details) throw new CloudError(400, 'Enter a GitLab project URL or HTTPS/SSH clone address');
    validateRepository(details.repository);
    const project = projectSchema.parse({
      ...input, id: `project-${randomBytes(12).toString('hex')}`, repository: details.repository,
      name: input.name ?? details.name,
      autoRun: { enabled: false, branch: input.defaultBranch, selections: [], revision: 1 },
    });
    const created = store.createProject(project);
    store.event(null, 'project-created', { projectId: created.id, actor: who.name });
    reply.status(201);
    const { webhookSecretDigest: _secret, ...safe } = created;
    return safe;
  });
  app.get('/api/projects/:id', (req) => {
    team(req);
    const { webhookSecretDigest: _secret, ...project } = store.project(param(req, 'id'));
    return project;
  });
  app.put('/api/projects/:id', (req) => {
    const who = team(req, 'admin'), id = param(req, 'id'), input = projectSchema.parse(req.body);
    validateRepository(input.repository);
    const current = store.project(id);
    const credentialRef = Object.hasOwn(req.body as object, 'repositoryCredentialRef') ? input.repositoryCredentialRef : current.repositoryCredentialRef;
    const updated = store.updateProject(id, { ...input, repositoryCredentialRef: credentialRef, autoRun: current.autoRun, webhookSecretDigest: current.webhookSecretDigest, webhookStatus: current.webhookStatus });
    store.event(null, 'project-updated', { projectId: id, revision: updated.configRevision, actor: who.name });
    const { webhookSecretDigest: _secret, ...safe } = updated;
    return safe;
  });
  app.delete('/api/projects/:id', (req) => {
    const who = team(req, 'admin'), id = param(req, 'id');
    store.deleteProject(id);
    store.event(null, 'project-removed', { projectId: id, actor: who.name });
    return { id };
  });
  app.post('/api/projects/:id/scans', (req) => {
    const who = team(req, 'operator'), id = param(req, 'id');
    const { commit } = z.object({ commit: z.string().regex(/^[0-9a-f]{40}$/).optional() }).strict().parse(req.body ?? {});
    const scan = store.createCatalogScan(id, commit);
    store.event(null, 'catalog-scan-requested', { projectId: id, scanId: scan.scanId, actor: who.name });
    return scan;
  });
  app.get('/api/projects/:id/scans', (req) => { team(req); return store.listCatalogScans(param(req, 'id')); });
  app.get('/api/projects/:id/scans/:scanId', (req) => { team(req); return store.catalogScan(param(req, 'id'), idSchema.parse((req.params as Record<string, string>).scanId)); });
  app.get('/api/projects/:id/catalogs', (req) => { team(req); return store.catalogs(param(req, 'id')); });
  app.get('/api/projects/:id/catalogs/:catalogId', (req) => { team(req); return store.catalog(param(req, 'id'), idSchema.parse((req.params as Record<string, string>).catalogId)); });
  app.post('/api/projects/:id/requests', (req, reply) => {
    const who = team(req), id = param(req, 'id'), body = req.body as Record<string, unknown>;
    if (!body || body.projectId !== id) throw new CloudError(400, 'Project identity mismatch');
    const input = projectSubmissionSchema.parse(body);
    if (!input.catalogId) throw new CloudError(409, 'Scan the selected commit before submitting');
    if (input.source.kind !== 'manual' || input.autoPolicyRevision) throw new CloudError(400, 'Push metadata is server owned');
    const request = store.submitProject(input, who.name, String(req.headers['idempotency-key'] ?? ''));
    reply.status(201);
    return { id: request.id, state: request.state, url: new URL(`/requests/${request.id}`, publicUrl).href };
  });
  app.post('/api/projects/:id/webhook-secret', (req) => {
    const who = team(req, 'admin'), id = param(req, 'id'), token = randomBytes(32).toString('hex');
    const project = store.setWebhookSecret(id, digest(token), 'active');
    store.event(null, 'project-webhook-configured', { projectId: id, actor: who.name });
    const { webhookSecretDigest: _secret, ...safe } = project;
    return { token, project: safe };
  });
  app.delete('/api/projects/:id/webhook-secret', (req) => {
    const who = team(req, 'admin'), id = param(req, 'id');
    const project = store.setWebhookSecret(id, null, 'disabled');
    store.event(null, 'project-webhook-disabled', { projectId: id, actor: who.name });
    return { webhookStatus: project.webhookStatus };
  });
  app.put('/api/projects/:id/auto-run', (req) => {
    const who = team(req, 'admin'), id = param(req, 'id'), current = store.project(id);
    const autoRun = z.object({ enabled: z.boolean(), branch: z.string().trim().min(1).max(200), selections: z.array(z.object({ suite: z.string().min(1).max(100), scenario: z.string().min(1).max(100) }).strict()).max(100) }).strict().parse(req.body);
    const updated = store.updateProject(id, { ...current, autoRun: { ...autoRun, revision: current.autoRun.revision } });
    store.event(null, 'project-auto-run-updated', { projectId: id, revision: updated.autoRun.revision, actor: who.name });
    return { enabled: updated.autoRun.enabled, branch: updated.autoRun.branch, selections: updated.autoRun.selections, revision: updated.autoRun.revision };
  });
  const webhookRates = new Map<string, { start: number; count: number }>();
  app.post('/api/webhooks/gitlab/:projectId', { bodyLimit: 256 * 1024 }, (req, reply) => {
    const id = param(req, 'projectId'), project = store.project(id);
    const now = Date.now(), rate = webhookRates.get(id);
    if (rate && now - rate.start < 60000) {
      if (++rate.count > 60) throw new CloudError(429, 'Webhook rate limit exceeded');
    } else webhookRates.set(id, { start: now, count: 1 });
    const token = String(req.headers['x-gitlab-token'] ?? '');
    if (!project.webhookSecretDigest || project.webhookStatus !== 'active' || !equals(digest(token), project.webhookSecretDigest))
      throw new CloudError(401, 'Invalid webhook credential');
    if (req.headers['x-gitlab-event'] !== 'Push Hook') throw new CloudError(400, 'Unsupported GitLab event');
    const deliveryId = z.string().min(1).max(300).parse(req.headers['x-gitlab-event-uuid']);
    const payload = webhookPushSchema.parse(req.body);
    const branch = payload.ref.slice('refs/heads/'.length);
    const repository = new URL(project.repository), hookRepository = payload.project.web_url ? new URL(payload.project.web_url) : undefined;
    if (!hookRepository || repository.host.toLowerCase() !== hookRepository.host.toLowerCase() || repository.pathname.replace(/\.git$/, '').replace(/\/$/, '') !== hookRepository.pathname.replace(/\.git$/, '').replace(/\/$/, '')) throw new CloudError(400, 'Webhook repository identity mismatch');
    const accepted = store.recordWebhook(id, deliveryId, { branch, commit: payload.after, policyRevision: project.autoRun.revision });
    if (!accepted) { reply.status(202); return { accepted: true, duplicate: true }; }
    if (payload.after === '0'.repeat(40) || payload.before === payload.after || payload.checkout_sha !== payload.after || !project.autoRun.enabled || project.autoRun.branch !== branch) {
      store.event(null, 'gitlab-push-ignored', { projectId: id, deliveryId, branch });
      reply.status(202);
      return { accepted: true, ignored: true };
    }
    const scan = store.createCatalogScan(id, payload.after, { branch, deliveryId, policyRevision: project.autoRun.revision });
    store.event(null, 'gitlab-push-accepted', { projectId: id, deliveryId, branch, commit: payload.after, scanId: scan.scanId });
    reply.status(202);
    return { accepted: true, scanId: scan.scanId };
  });
  app.get('/api/admin/targets', (req) => {
    team(req, 'admin');
    return store.targets();
  });
  app.get('/api/requests', (req) => {
    const who = team(req),
      q = query(req);
    if (who.kind === 'ci')
      throw new CloudError(403, 'Use the submitted request URL');
    const parsed = z
      .object({
        state: z.string().optional(),
        projectId: idSchema.optional(),
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
    const who = team(req);
    const { projectId, ...input } = submissionSchema.extend({ projectId: idSchema.optional() }).parse(req.body);
    const r = store.submit(input, who.name, String(req.headers['idempotency-key'] ?? ''), projectId);
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
  app.get('/api/requests/:id/attempts/:attemptId/worker-timeline', (req) => {
    const id = param(req, 'id');
    ownRequest(req, id);
    return store.workerTimelines.view(id, param(req, 'attemptId'));
  });
  app.get('/api/requests/:id/attempts/:attemptId/worker-timeline/events', (req) => {
    const id = param(req, 'id');
    ownRequest(req, id);
    const after = z.coerce.number().int().nonnegative().safe().parse(query(req).after ?? 0);
    const limit = z.coerce.number().int().min(1).max(500).parse(query(req).limit ?? 200);
    return store.workerTimelines.events(id, param(req, 'attemptId'), after, limit);
  });
  app.get('/api/requests/:id/attempts/:attemptId/worker-timeline/logs', (req) => {
    const id = param(req, 'id');
    ownRequest(req, id);
    const spanId = z.string().max(100).optional().parse(query(req).spanId);
    return store.workerTimelines.logs(id, param(req, 'attemptId'), spanId);
  });
  app.post('/api/requests/:id/rerun', (req, reply) => {
    const who = team(req, 'operator'),
      original = store.getRequest(param(req, 'id')),
      r = store.rerun(
        original.id,
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
  registerDeviceEvents(app, store, (req) => {
    if (team(req).kind !== 'browser') throw new CloudError(403, 'Browser member required');
  });
  app.get('/api/devices', (req) => {
    const who = team(req);
    if (who.kind !== 'browser')
      throw new CloudError(403, 'Browser member required');
    return store.listDevices();
  });
  app.get('/api/devices/:id', (req) => {
    const who = team(req);
    if (who.kind !== 'browser')
      throw new CloudError(403, 'Browser member required');
    return store.getDevice(param(req, 'id'));
  });
  app.put('/api/devices/:id', (req) => {
    const who = team(req, 'operator');
    return store.updateDevice(param(req, 'id'), req.body, who.name);
  });
  function pairingAdmin(req: FastifyRequest) {
    const who = team(req, 'admin');
    if (who.kind !== 'browser') throw new CloudError(403, 'Browser administrator required');
    return who;
  }
  app.get('/api/worker-pairings', (req) => {
    pairingAdmin(req);
    return store.listWorkerPairings();
  });
  app.post('/api/worker-pairings', (req) => {
    const who = pairingAdmin(req);
    return store.createWorkerPairing(workerPairingRequestSchema.parse(req.body), who.name);
  });
  app.get('/api/worker-pairings/:id', (req) => {
    pairingAdmin(req);
    return store.workerPairing(param(req, 'id'));
  });
  app.delete('/api/worker-pairings/:id', (req) => {
    const who = pairingAdmin(req);
    return store.revokeWorkerPairing(param(req, 'id'), who.name);
  });
  // Bound unauthenticated attempts by source address and globally (no forwarded-IP trust).
  const pairingAttempts = new Map<string, { at: number; count: number }>();
  app.post('/api/worker/pair', { bodyLimit: 1024 }, (req) => {
    const now = store.now();
    for (const [key, entry] of pairingAttempts) if (now - entry.at >= 60000) pairingAttempts.delete(key);
    for (const [key, limit] of [['*', 300], [req.ip, 30]] as const) {
      const entry = pairingAttempts.get(key) ?? { at: now, count: 0 };
      pairingAttempts.set(key, entry);
      if (++entry.count > limit) throw new CloudError(429, 'Too many pairing attempts');
    }
    const input = z.object({ code: z.string().max(64) }).strict().safeParse(req.body);
    if (!input.success) throw new CloudError(400, 'Pairing code unavailable');
    return store.redeemWorkerPairing(input.data.code);
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
  app.post('/api/projects/:id/scans/:scanId/cancel', (req) => {
    team(req, 'operator');
    return store.cancelCatalogScan(param(req, 'id'), param(req, 'scanId'));
  });
  app.get('/api/projects/:id/status', (req) => {
    team(req);
    const id = param(req, 'id'), project = store.project(id), catalogs = store.catalogs(id);
    const current = catalogs.find(catalog => catalog.configRevision === project.configRevision && catalog.status === 'ready');
    const blockers = [];
    if (!Object.keys(project.suites).length) blockers.push('尚未配置测试套件');
    if (!current) blockers.push('当前配置尚无成功扫描');
    else {
      if (!current.suites.some(suite => suite.cases.length)) blockers.push('未发现测试用例');
      if (!current.scenarios.length) blockers.push('仓库尚未声明运行场景，可浏览用例；运行前请在 fliwright.config.ts 中声明场景');
    }
    const approved = store.db.prepare('SELECT config_revision FROM project_approvals WHERE project_id=?').get(id);
    if (Number(approved?.config_revision) !== project.configRevision) blockers.push('等待管理员确认项目就绪');
    return { ready: blockers.length === 0, blockers, head: store.branchHead(id, project.autoRun.branch), latestScan: store.listCatalogScans(id)[0] ?? null };
  });
  app.post('/api/projects/:id/ready', (req) => {
    const who = team(req, 'admin'), id = param(req, 'id'), project = store.project(id);
    const catalog = store.catalogs(id).find(item => item.status === 'ready' && item.configRevision === project.configRevision);
    if (!catalog || !Object.keys(project.suites).length || !catalog.suites.some(suite => suite.cases.length) || !catalog.scenarios.length) throw new CloudError(409, 'A successful catalog with suites, scenarios and cases is required');
    store.db.prepare('INSERT INTO project_approvals VALUES(?,?) ON CONFLICT(project_id) DO UPDATE SET config_revision=excluded.config_revision').run(id, project.configRevision);
    store.event(null, 'project-ready', { projectId: id, revision: project.configRevision, actor: who.name });
    return { ready: true };
  });
  const controlHandlers = new Map<string, (request: FastifyRequest) => unknown>();
  const workerControl = (operation: string, handler: (request: FastifyRequest) => unknown) => {
    controlHandlers.set(operation, handler);
  };
  workerControl('/api/worker/assignments', (req) => store.workerAssignments(worker(req).name));
  workerControl('/api/worker/scans/claim', (req) => store.claimCatalogScan(worker(req).name));
  workerControl('/api/worker/scans/heartbeat', (req) => {
    const who = worker(req), key = scanLeaseKeySchema.parse(req.body);
    return store.heartbeatCatalogScan(who.name, key.scanId, key.token);
  });
  workerControl('/api/worker/scans/result', (req) => {
    const who = worker(req), input = scanLeaseKeySchema.extend({ catalog: catalogSchema, head: z.string().regex(/^[a-f0-9]{40}$/).optional() }).strict().parse(req.body);
    return store.finishCatalogScan(who.name, input.scanId, input.token, input.catalog, input.head);
  });
  workerControl('/api/worker/scans/failure', (req) => {
    const who = worker(req), input = scanLeaseKeySchema.extend({ error: z.string().max(4000) }).strict().parse(req.body);
    store.heartbeatCatalogScan(who.name, input.scanId, input.token);
    return store.updateCatalogScan(input.scanId, 'failed', input.error);
  });
  workerControl('/api/worker/claim', (req) => {
    const who = worker(req),
      { slotId, deviceId } = z
        .object({ slotId: idSchema, deviceId: z.string().min(1).max(300) })
        .strict()
        .parse(req.body);
    return store.claim(who.name, slotId, deviceId);
  });
  workerControl('/api/worker/devices', (req) => {
    const who = worker(req);
    store.recordDeviceInventory(who.name, req.body);
    return { accepted: true };
  });
  workerControl('/api/worker/heartbeat', (req) => {
    const key = lease(req),
      body = z
        .object({
          stage: z.string().min(1).max(100),
          log: z.string().max(4000).optional(),
          timelineClock: workerTimelineClockSchema.optional(),
        })
        .passthrough()
        .parse(req.body);
    return store.heartbeat(
      key,
      body.stage,
      body.log ? redact(body.log) : undefined,
      body.timelineClock,
    );
  });
  workerControl('/api/worker/timeline', (req) => {
    lease(req);
    return store.workerTimelines.append(req.body);
  });
  workerControl('/api/worker/result', (req) => {
    const key = lease(req),
      body = z.object({ result: resultSchema }).passthrough().parse(req.body);
    return store.recordResult(key, body.result);
  });
  workerControl('/api/worker/finish', (req) => {
    const key = lease(req),
      { outcome, timeline } = z
        .object({ outcome: outcomeSchema, timeline: workerTimelineFinishSchema.optional() })
        .passthrough()
        .parse(req.body);
    const r = store.finish(key, outcome, timeline);
    return { id: r.id, state: r.state };
  });
  workerControl('/api/worker/recover', (req) => {
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
      return reports.view(id, reportScope(req, id), prefix === '/api/reports');
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
  const closeControl = attachWorkerControl(app.server, {
    store,
    authenticate: request => worker({ headers: request.headers } as FastifyRequest).name,
    handle: (request, operation, body) => {
      const handler = controlHandlers.get(operation);
      if (!handler) throw new CloudError(404, 'Unknown worker control operation');
      return handler({ headers: request.headers, body } as FastifyRequest);
    },
  });
  // Terminate upgraded sockets before Fastify waits for the HTTP server to close.
  app.addHook('preClose', async () => closeControl());
  const maintenance = setInterval(() => {
    try {
      store.expireLeases();
      store.expireCatalogScans();
      reports.reconcile();
      reports.sweep();
      store.workerTimelines.sweep();
    } catch {
      /* health/operations endpoints retain state for diagnosis */
    }
  }, 10000);
  maintenance.unref();
  app.addHook('onClose', async () => clearInterval(maintenance));
  return app;
}
