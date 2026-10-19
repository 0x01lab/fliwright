import { artifactReferences } from '@fliwright/cli/run';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  rmSync,
  existsSync,
  lstatSync,
  statfsSync,
  openSync,
  fsyncSync,
  closeSync,
} from 'node:fs';
import { dirname, extname, join, posix } from 'node:path';
import { runManifestSchema, type RunManifest } from '@fliwright/core';
import { CloudStore, digest, identifier } from './CloudStore.js';
import {
  CloudError,
  publicationSchema,
  type LeaseKey,
  type PublicationInput,
} from './contracts.js';

type Row = Record<string, unknown>;
type JsonObject = Record<string, any>;
export interface ReportPublication {
  id: string;
  attemptId: string;
  requestId: string;
  workerId: string;
  generation: number;
  state: string;
  createdAt: number;
  expiresAt: number;
  input: PublicationInput;
  tokenHash: string;
}
export interface ReportView {
  id: string;
  requestId: string;
  manifest: RunManifest;
  report: unknown;
  tests: Array<{
    testId: string;
    attemptId: string;
    result: JsonObject;
    timeline: JsonObject;
    trace: unknown;
    issues: string[];
  }>;
  issues: string[];
  files: string[];
  expiresAt: number;
}
const extensions = new Set([
  '.json',
  '.jsonl',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.txt',
  '.log',
  '.ts',
  '.dart',
]);
const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const equalHash = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export function safeArtifactPath(path: string) {
  if (
    path.includes('\\') ||
    path.includes(':') ||
    /[\x00-\x1f]/.test(path) ||
    path.startsWith('/') ||
    path.split('/').some((p) => !p || p === '.' || p === '..') ||
    !extensions.has(extname(path).toLowerCase()) ||
    path === 'cloud-publication.json'
  )
    throw new CloudError(400, 'Unsafe artifact path');
  return path;
}
function durableWrite(path: string, body: Buffer | string) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.tmp-${identifier()}`;
  writeFileSync(temp, body, { mode: 0o600 });
  const fd = openSync(temp, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temp, path);
  syncDirectory(dirname(path));
}
function syncDirectory(path: string) {
  const fd = openSync(path, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
function record(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}
function sanitizedTimeline(timeline: JsonObject): JsonObject {
  return {
    version: timeline.version,
    status: timeline.status,
    startedAt: timeline.startedAt,
    endedAt: timeline.endedAt,
    nodes: Array.isArray(timeline.nodes)
      ? timeline.nodes.map((v: unknown) => {
          const n = record(v);
          return {
            id: n.id,
            parentId: n.parentId,
            kind: n.kind,
            title: n.title,
            status: n.status,
            route: n.route,
            startedAt: n.startedAt,
            endedAt: n.endedAt,
            error: n.error
              ? { code: record(n.error).code, message: record(n.error).message }
              : undefined,
            artifacts: Array.isArray(n.artifacts)
              ? n.artifacts
                  .filter(
                    (a: unknown) =>
                      typeof record(a).path === 'string' &&
                      imageExtensions.has(
                        extname(record(a).path).toLowerCase(),
                      ),
                  )
                  .map((a: unknown) => ({
                    path: record(a).path,
                    kind: record(a).kind,
                  }))
              : [],
          };
        })
      : [],
  };
}

/** Immutable report storage. Only complete directories are made browsable. */
export class ReportStore {
  private readonly secret: string;
  readonly retentionMs: number;
  constructor(
    readonly store: CloudStore,
    readonly root: string,
    private readonly options: {
      publicationSecret?: string;
      retentionDays?: number;
      minFreeBytes?: number;
      maxBundleBytes?: number;
      maxStorageBytes?: number;
    } = {},
  ) {
    this.secret = options.publicationSecret ?? randomBytes(32).toString('hex');
    this.retentionMs = (options.retentionDays ?? 30) * 86400000;
    for (const dir of ['bundles', 'staging'])
      mkdirSync(join(root, dir), { recursive: true, mode: 0o700 });
  }
  private token(id: string) {
    return createHmac('sha256', this.secret)
      .update(`publication:${id}`)
      .digest('base64url');
  }
  publication(id: string): ReportPublication {
    const row = this.store.db
      .prepare('SELECT * FROM publications WHERE id=?')
      .get(id) as Row | undefined;
    if (!row) throw new CloudError(404, 'Report publication not found');
    return {
      ...JSON.parse(String(row.data)),
      state: String(row.state),
      expiresAt: Number(row.expires_at),
    };
  }
  list(requestId: string) {
    return (
      this.store.db
        .prepare(
          'SELECT id FROM publications WHERE request_id=? ORDER BY created_at',
        )
        .all(requestId) as Row[]
    ).map((r) => {
      const p = this.publication(String(r.id));
      return {
        id: p.id,
        attemptId: p.attemptId,
        state: p.state,
        expiresAt: p.expiresAt,
        runId: p.input.runId,
      };
    });
  }
  create(key: LeaseKey, value: PublicationInput) {
    const input = publicationSchema.parse(value);
    let total = 0;
    const paths = new Set<string>();
    for (const file of input.files) {
      safeArtifactPath(file.path);
      if (paths.has(file.path))
        throw new CloudError(400, 'Duplicate artifact path');
      paths.add(file.path);
      total += file.size;
    }
    if (
      !paths.has('run.json') ||
      total > (this.options.maxBundleBytes ?? 128 * 1024 * 1024)
    )
      throw new CloudError(413, 'Missing manifest or bundle too large');
    const p = this.store.transaction(() => {
      const a = this.store.owned(key);
      const existing = this.store.db
        .prepare('SELECT id FROM publications WHERE attempt_id=?')
        .get(key.attemptId) as Row | undefined;
      if (existing) {
        const p = this.publication(String(existing.id));
        if (JSON.stringify(p.input) !== JSON.stringify(input))
          throw new CloudError(409, 'Publication conflict');
        return p;
      }
      this.checkCapacity(total);
      const id = identifier();
      const p: ReportPublication = {
        id,
        attemptId: a.attemptId,
        requestId: a.requestId,
        workerId: key.workerId,
        generation: key.generation,
        state: 'staging',
        createdAt: this.store.now(),
        expiresAt: this.store.now() + this.retentionMs,
        input,
        tokenHash: digest(this.token(id)),
      };
      this.store.db
        .prepare('INSERT INTO publications VALUES(?,?,?,?,?,?,?)')
        .run(
          id,
          a.attemptId,
          a.requestId,
          p.state,
          p.createdAt,
          p.expiresAt,
          JSON.stringify(p),
        );
      return p;
    });
    const dir = join(this.root, 'staging', p.id);
    if (
      p.state === 'staging' &&
      !existsSync(join(this.root, 'bundles', p.id))
    ) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      durableWrite(join(dir, 'cloud-publication.json'), JSON.stringify(p));
    }
    return { id: p.id, token: this.token(p.id), state: p.state };
  }
  private authorizeUpload(id: string, token: string) {
    const p = this.publication(id);
    if (!equalHash(digest(token), p.tokenHash))
      throw new CloudError(403, 'Invalid publication credential');
    const attempt = this.store.attempt(p.attemptId);
    if (
      attempt.stage === 'lost' ||
      attempt.generation !== p.generation ||
      p.expiresAt <= this.store.now() ||
      p.state === 'expired'
    )
      throw new CloudError(409, 'Publication lease expired or fenced');
    // A retained publication capability may repair uploads after a clean finish.
    if (attempt.finishedAt === undefined) this.store.owned(attempt);
    return p;
  }
  put(id: string, token: string, path: string, body: Buffer) {
    const p = this.authorizeUpload(id, token);
    safeArtifactPath(path);
    const file = p.input.files.find((f) => f.path === path);
    if (!file || file.size !== body.length || file.sha256 !== digest(body))
      throw new CloudError(400, 'Artifact size or digest mismatch');
    if (p.state === 'published') return;
    // The manifest reserved these bytes when the publication was created.
    this.checkCapacity(body.length, false);
    const dir = join(this.root, 'staging', id);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.assertNoSymlink(dir, path, false);
    durableWrite(join(dir, path), body);
  }
  commit(id: string, token: string) {
    const p = this.authorizeUpload(id, token);
    if (p.state === 'published') return { id };
    const final = join(this.root, 'bundles', id),
      staging = join(this.root, 'staging', id);
    if (!existsSync(final)) {
      this.validate(p, staging);
      durableWrite(
        join(staging, 'cloud-publication.json'),
        JSON.stringify({ ...p, state: 'published' }),
      );
      renameSync(staging, final);
      syncDirectory(join(this.root, 'bundles'));
      syncDirectory(join(this.root, 'staging'));
    } else this.validate(p, final);
    this.index(p);
    return { id };
  }
  private index(p: ReportPublication) {
    this.store.transaction(() => {
      const a = this.store.attempt(p.attemptId);
      if (a.stage === 'lost' || a.generation !== p.generation)
        throw new CloudError(409, 'Publication fenced');
      if (a.finishedAt === undefined) this.store.owned(a);
      this.store.db
        .prepare(
          "UPDATE publications SET state='published' WHERE id=? AND state!='expired'",
        )
        .run(p.id);
      a.bundleId = p.id;
      if (a.outcome?.publication === 'publish_failed')
        a.outcome.publication = 'published';
      this.store.saveAttempt(a);
      this.store.event(p.requestId, 'report-published', {
        id: p.id,
        attemptId: p.attemptId,
      });
    });
  }
  private assertNoSymlink(root: string, path: string, required = true) {
    if (lstatSync(root).isSymbolicLink())
      throw new CloudError(400, 'Symlink artifact boundary');
    let next = root;
    for (const piece of path.split('/')) {
      next = join(next, piece);
      if (!existsSync(next)) {
        if (required) throw new CloudError(404, 'Missing artifact');
        continue;
      }
      if (lstatSync(next).isSymbolicLink())
        throw new CloudError(400, 'Symlink artifact');
    }
    if (required && !lstatSync(next).isFile())
      throw new CloudError(400, 'Artifact is not a file');
  }
  private read(p: ReportPublication, root: string, path: string) {
    safeArtifactPath(path);
    const file = p.input.files.find((f) => f.path === path);
    if (!file) throw new CloudError(404, 'Artifact not in manifest');
    this.assertNoSymlink(root, path);
    const bytes = readFileSync(join(root, path));
    if (bytes.length !== file.size || digest(bytes) !== file.sha256)
      throw new CloudError(409, 'Artifact integrity error');
    return bytes;
  }
  private json(p: ReportPublication, root: string, path: string): unknown {
    const bytes = this.read(p, root, path);
    if (bytes.length > 8 * 1024 * 1024)
      throw new CloudError(413, 'JSON document too large');
    return JSON.parse(bytes.toString('utf8'));
  }
  private validate(p: ReportPublication, root: string) {
    for (const file of p.input.files) this.read(p, root, file.path);
    const manifest = runManifestSchema.parse(this.json(p, root, 'run.json'));
    if (manifest.runId !== p.input.runId)
      throw new CloudError(400, 'Run identity mismatch');
    const dirs = new Set<string>();
    for (const test of manifest.tests)
      for (const attempt of test.attempts) {
        safeArtifactPath(attempt.resultPath);
        const dir = posix.dirname(attempt.resultPath);
        if (
          !dir.startsWith('tests/') ||
          dir.split('/').length < 3 ||
          [...dirs].some(
            (d) =>
              dir === d || dir.startsWith(`${d}/`) || d.startsWith(`${dir}/`),
          )
        )
          throw new CloudError(400, 'Overlapping attempt boundary');
        dirs.add(dir);
        if (!p.input.files.some((f) => f.path === attempt.resultPath)) {
          if (manifest.evidenceStatus === 'complete')
            throw new CloudError(400, 'Missing attempt result');
          continue;
        }
        const result = record(this.json(p, root, attempt.resultPath));
        if (
          result.runId !== manifest.runId ||
          result.testId !== test.testId ||
          result.attemptId !== attempt.attemptId
        )
          throw new CloudError(400, 'Attempt identity mismatch');
        for (const file of p.input.files.filter(
          (f) => f.path.startsWith(`${dir}/`) && f.path.endsWith('.json'),
        )) {
          let data: unknown;
          try {
            data = this.json(p, root, file.path);
          } catch {
            continue;
          }
          const obj = record(data);
          if (obj.runId !== undefined && obj.runId !== manifest.runId)
            throw new CloudError(400, 'Evidence identity mismatch');
          const local = posix.relative(dir, file.path);
          const kind =
            local === 'result.json'
              ? 'result'
              : local === 'timeline.json'
                ? 'timeline'
                : local === 'trace/trace.json'
                  ? 'trace'
                  : local === 'failures.json'
                    ? 'failures'
                    : undefined;
          if (kind)
            this.validateReferences(data, posix.dirname(file.path), dir, kind);
        }
      }
    if (p.input.files.some((f) => f.path === 'report.json'))
      this.validateReferences(
        this.json(p, root, 'report.json'),
        '.',
        '.',
        'report',
      );
  }
  private validateReferences(
    data: unknown,
    base: string,
    boundary: string,
    kind: Parameters<typeof artifactReferences>[1],
  ) {
    for (const ref of artifactReferences(data, kind)) {
      const value = ref.path;
      if (value.includes('\\') || value.includes(':') || value.startsWith('/'))
        throw new CloudError(400, 'Artifact reference escapes boundary');
      const path = posix.normalize(posix.join(base, value));
      if (
        path === '..' ||
        path.startsWith('../') ||
        (boundary !== '.' &&
          path !== boundary &&
          !path.startsWith(`${boundary}/`))
      )
        throw new CloudError(
          400,
          'Artifact reference escapes attempt boundary',
        );
    }
  }
  private published(id: string) {
    const p = this.publication(id);
    if (p.state === 'expired' || p.expiresAt <= this.store.now())
      throw new CloudError(410, 'Report expired');
    if (p.state !== 'published')
      throw new CloudError(409, 'Report not published');
    return p;
  }
  file(id: string, path: string, sensitive: boolean) {
    const p = this.published(id);
    if (!sensitive && !imageExtensions.has(extname(path).toLowerCase()))
      throw new CloudError(403, 'Artifact outside share scope');
    return this.read(p, join(this.root, 'bundles', id), path);
  }
  view(id: string, sensitive: boolean): ReportView {
    const p = this.published(id),
      root = join(this.root, 'bundles', id);
    const manifest = runManifestSchema.parse(this.json(p, root, 'run.json'));
    const issues: string[] = [];
    const read = (path: string): unknown => {
      try {
        return this.json(p, root, path);
      } catch {
        issues.push(`Missing or unreadable: ${path}`);
        return {};
      }
    };
    const tests = manifest.tests.flatMap((test) =>
      test.attempts.map((attempt) => {
        const dir = posix.dirname(attempt.resultPath),
          result = record(read(attempt.resultPath)),
          timeline = record(read(`${dir}/timeline.json`));
        return {
          testId: test.testId,
          attemptId: attempt.attemptId,
          result: sensitive
            ? result
            : {
                testName: result.testName,
                status: result.status,
                attemptOutcome: result.attemptOutcome,
                testOutcome: result.testOutcome,
                expectedFailure: result.expectedFailure,
                flaky: result.flaky,
              },
          timeline: sensitive ? timeline : sanitizedTimeline(timeline),
          trace: sensitive ? read(`${dir}/trace/trace.json`) : null,
          issues: [],
        };
      }),
    );
    return {
      id,
      requestId: p.requestId,
      manifest: sensitive
        ? manifest
        : {
            ...manifest,
            runnerErrors: manifest.runnerErrors?.map((e) => ({
              phase: e.phase,
              message: e.message,
            })),
          },
      report: sensitive ? read('report.json') : null,
      tests,
      issues,
      files: p.input.files
        .map((f) => f.path)
        .filter(
          (path) =>
            sensitive || imageExtensions.has(extname(path).toLowerCase()),
        ),
      expiresAt: p.expiresAt,
    };
  }
  share(id: string, actor: string, ttlMs: number, sensitive: boolean) {
    const p = this.published(id);
    if (!Number.isFinite(ttlMs) || ttlMs < 60000 || ttlMs > 7 * 86400000)
      throw new CloudError(
        400,
        'Share expiry must be between one minute and seven days',
      );
    const token = randomBytes(32).toString('base64url'),
      shareId = identifier(),
      expiresAt = Math.min(p.expiresAt, this.store.now() + ttlMs);
    this.store.transaction(() => {
      this.store.db
        .prepare('INSERT INTO shares VALUES(?,?,?,?,0,?)')
        .run(shareId, id, digest(token), expiresAt, sensitive ? 1 : 0);
      this.store.event(p.requestId, 'share-created', {
        actor,
        id: shareId,
        expiresAt,
        sensitive,
      });
    });
    return { id: shareId, token, expiresAt };
  }
  shares(id: string) {
    return this.store.db
      .prepare(
        'SELECT id,bundle_id AS bundleId,expires_at AS expiresAt,revoked,sensitive FROM shares WHERE bundle_id=?',
      )
      .all(id);
  }
  exchange(token: string) {
    const share = this.store.db
      .prepare('SELECT * FROM shares WHERE token_hash=?')
      .get(digest(token)) as Row | undefined;
    if (!share || share.revoked || Number(share.expires_at) <= this.store.now())
      throw new CloudError(410, 'Share expired or revoked');
    this.published(String(share.bundle_id));
    const session = randomBytes(32).toString('base64url'),
      expiresAt = Math.min(
        Number(share.expires_at),
        this.store.now() + 3600000,
      );
    this.store.db
      .prepare('INSERT INTO share_sessions VALUES(?,?,?)')
      .run(digest(session), String(share.id), expiresAt);
    return { token: session, bundleId: String(share.bundle_id), expiresAt };
  }
  authorizeShare(token: string, bundleId: string) {
    const row = this.store.db
      .prepare(
        'SELECT s.* FROM share_sessions t JOIN shares s ON s.id=t.share_id WHERE t.token_hash=? AND t.expires_at>?',
      )
      .get(digest(token), this.store.now()) as Row | undefined;
    if (
      !row ||
      row.revoked ||
      Number(row.expires_at) <= this.store.now() ||
      row.bundle_id !== bundleId
    )
      throw new CloudError(410, 'Share expired or revoked');
    this.published(bundleId);
    return { sensitive: !!row.sensitive };
  }
  revoke(id: string, actor: string) {
    this.store.transaction(() => {
      const row = this.store.db
        .prepare('SELECT bundle_id FROM shares WHERE id=?')
        .get(id) as Row | undefined;
      if (!row) throw new CloudError(404, 'Share not found');
      this.store.db.prepare('UPDATE shares SET revoked=1 WHERE id=?').run(id);
      this.store.event(
        this.publication(String(row.bundle_id)).requestId,
        'share-revoked',
        { actor, id },
      );
    });
  }
  reconcile() {
    for (const dir of readdirSync(join(this.root, 'bundles'), {
      withFileTypes: true,
    }))
      if (dir.isDirectory() && /^[a-f0-9-]{36}$/.test(dir.name)) {
        try {
          const p = this.publication(dir.name);
          if (p.state === 'staging') {
            this.validate(p, join(this.root, 'bundles', dir.name));
            this.index(p);
          }
        } catch {
          /* Remains inaccessible for operator inspection; never infer success. */
        }
      }
  }
  sweep() {
    const now = this.store.now();
    const rows = this.store.db
      .prepare(
        "SELECT id FROM publications WHERE state!='expired' AND (expires_at<=? OR (state='staging' AND created_at<?))",
      )
      .all(now, now - 86400000) as Row[];
    for (const row of rows) {
      const id = String(row.id),
        p = this.publication(id),
        a = this.store.attempt(p.attemptId);
      if (a.finishedAt === undefined) continue;
      this.store.transaction(() => {
        this.store.db
          .prepare("UPDATE publications SET state='expired' WHERE id=?")
          .run(id);
        this.store.event(p.requestId, 'report-expired', { id });
      });
      rmSync(join(this.root, 'bundles', id), { recursive: true, force: true });
      rmSync(join(this.root, 'staging', id), { recursive: true, force: true });
    }
    // Retry physical deletion after a crash between the tombstone and unlink.
    for (const row of this.store.db
      .prepare("SELECT id FROM publications WHERE state='expired'")
      .all() as Row[])
      for (const dir of ['bundles', 'staging'])
        rmSync(join(this.root, dir, String(row.id)), {
          recursive: true,
          force: true,
        });
    this.store.db
      .prepare('DELETE FROM share_sessions WHERE expires_at<=?')
      .run(now);
  }
  capacity() {
    const fs = statfsSync(this.root);
    const reserved = Number(
      (
        this.store.db
          .prepare(
            "SELECT COALESCE(SUM(json_extract(f.value,'$.size')),0) AS n FROM publications p,json_each(p.data,'$.input.files') f WHERE p.state!='expired'",
          )
          .get() as Row
      ).n,
    );
    return { freeBytes: fs.bavail * fs.bsize, reservedBytes: reserved };
  }
  private checkCapacity(bytes: number, reserve = true) {
    const free = this.capacity().freeBytes;
    const used = Number(
      (
        this.store.db
          .prepare(
            "SELECT COALESCE(SUM(json_extract(f.value,'$.size')),0) AS n FROM publications p,json_each(p.data,'$.input.files') f WHERE p.state!='expired'",
          )
          .get() as Row
      ).n,
    );
    if (
      free - bytes < (this.options.minFreeBytes ?? 1024 * 1024 * 1024) ||
      used + (reserve ? bytes : 0) >
        (this.options.maxStorageBytes ?? 100 * 1024 ** 3)
    )
      throw new CloudError(507, 'Insufficient report storage capacity');
  }
}
