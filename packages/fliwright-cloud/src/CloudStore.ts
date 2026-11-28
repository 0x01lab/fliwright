import { DatabaseSync } from 'node:sqlite';
import { displayRepositoryPath } from './project-setup.js';
import { boardColumns, type BoardDepth, type BoardSnapshot, type TestColumn } from './request-board.js';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { WorkerTimelineStore } from './WorkerTimelineStore.js';
import { WorkerDiagnosticsStore } from './WorkerDiagnosticsStore.js';
import type { CatalogScanQueueReason, CatalogScanRecord, ProjectWorkerBinding, WorkerStatus } from './catalog-scan-status.js';
import {
  CloudError,
  workerPairingRequestSchema,
  workerPairCodeSchema,
  type WorkerPairingStatus,
  submissionSchema,
  targetSchema,
  projectSchema,
  catalogSchema,
  catalogScanSchema,
  catalogCommitSchema,
  unresolvedCatalogCommit,
  flutterFileArguments,
  type SecureFileReference,
  workerSchema,
  outcomeSchema,
  resultSchema,
  deviceInventorySchema,
  deviceSettingsSchema,
  type ManagedDevice,
  type DeviceSettings,
  type ApplicationTarget,
  type Project,
  type TestCatalog,
  type CatalogScan,
  type CatalogScanLease,
  type ProjectSubmission,
  projectSubmissionSchema,
  type WorkerConfig,
  type Submission,
  type TestRequest,
  type ExecutionAttempt,
  type ExecutionLease,
  type ExecutionSlot,
  type ExecutionWorker,
  type LeaseKey,
  type Outcome,
  type RequestState,
  type WorkerTimelineClock,
  type WorkerTimelineFinish,
} from '@fliwright/cloud-protocol';

type Row = Record<string, unknown>;
const catalogLeaseMs = 30_000;
/** Directory-derived suites carry a single safe segment and a relative test glob. */
const derivedCatalogSuite = (suite: { id: string; pattern: string }) =>
  suite.id.length <= 100 && suite.id !== '.' && suite.id !== '..' && !suite.id.includes('/') && !suite.id.includes('\\') &&
  !suite.pattern.startsWith('/') && !suite.pattern.includes('\\') && !suite.pattern.split('/').includes('..') &&
  /\.test\.(?:[a-z]+|\{[a-z,]+\})$/.test(suite.pattern);
const requestLane = `CASE WHEN state='queued' THEN 'pending'
  WHEN state IN ('assigned','preparing','running','finalizing','cancel_requested') THEN 'running'
  WHEN state='infrastructure_failed' OR (state='completed' AND json_extract(data,'$.verdict')='failed') THEN 'failed'
  WHEN state='completed' AND json_extract(data,'$.verdict')='passed' THEN 'passed'
  ELSE 'other' END`;
export const digest = (value: string | Buffer) =>
  createHash('sha256').update(value).digest('hex');
export const identifier = () => randomUUID();
export const terminalStates = [
  'completed',
  'cancelled',
  'superseded',
  'infrastructure_failed',
];
const targetFromProject = (project: Project): ApplicationTarget => {
  const { defaultBranch: _defaultBranch, configRevision: _configRevision, repositoryCredentialRef: _repositoryCredentialRef, webhookSecretDigest: _webhookSecretDigest, webhookStatus: _webhookStatus, autoRun: _autoRun, ...target } = project;
  return targetSchema.parse(target);
};
export class CloudStore {
  readonly db: DatabaseSync;
  readonly workerTimelines: WorkerTimelineStore;
  readonly workerDiagnostics: WorkerDiagnosticsStore;
  private readonly controlListeners = new Set<(requestId: string | null, kind: string) => void>();
  private controlChanges: Array<[string | null, string]> = [];
  onControlChange(listener: (requestId: string | null, kind: string) => void): () => void {
    this.controlListeners.add(listener);
    return () => { this.controlListeners.delete(listener); };
  }
  private controlChanged(requestId: string | null, kind: string) {
    if (this.transactionDepth) this.controlChanges.push([requestId, kind]);
    else for (const listener of this.controlListeners) listener(requestId, kind);
  }
  constructor(
    path: string,
    readonly now: () => number = Date.now,
  ) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec(
      'PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;',
    );
    this.transaction(() => {
      const version = Number(
        (this.db.prepare('PRAGMA user_version').get() as Row).user_version,
      );
      if (version > 9) throw new Error('Unsupported cloud database version');
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS targets(id TEXT PRIMARY KEY, data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS workers(id TEXT PRIMARY KEY, paused INTEGER NOT NULL DEFAULT 0, seen_at INTEGER NOT NULL DEFAULT 0, catalog_projects TEXT NOT NULL DEFAULT '[]');
        CREATE TABLE IF NOT EXISTS device_inventories(worker_id TEXT PRIMARY KEY REFERENCES workers(id) ON DELETE CASCADE, received_at INTEGER NOT NULL, data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS slots(worker_id TEXT NOT NULL, id TEXT NOT NULL, device_id TEXT NOT NULL UNIQUE, targets TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'idle', generation INTEGER NOT NULL DEFAULT 0, attempt_id TEXT, PRIMARY KEY(worker_id,id));
        CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY, actor TEXT NOT NULL, idem TEXT NOT NULL, fingerprint TEXT NOT NULL, created_at INTEGER NOT NULL, queued_at INTEGER NOT NULL, state TEXT NOT NULL, data TEXT NOT NULL, UNIQUE(actor,idem));
        CREATE INDEX IF NOT EXISTS request_queue ON requests(state,queued_at,created_at);
        CREATE TABLE IF NOT EXISTS attempts(id TEXT PRIMARY KEY, request_id TEXT NOT NULL, data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT, request_id TEXT, kind TEXT NOT NULL, at INTEGER NOT NULL, data TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS request_events ON events(request_id,seq);
        CREATE TABLE IF NOT EXISTS publications(id TEXT PRIMARY KEY, attempt_id TEXT NOT NULL UNIQUE, request_id TEXT NOT NULL, state TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS shares(id TEXT PRIMARY KEY, bundle_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, expires_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0, sensitive INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS share_sessions(token_hash TEXT PRIMARY KEY, share_id TEXT NOT NULL, expires_at INTEGER NOT NULL);
      `);
      if (version < 3)
        this.db.exec(`
        ALTER TABLE slots RENAME TO slots_old;
        CREATE TABLE slots(worker_id TEXT NOT NULL, id TEXT NOT NULL, device_id TEXT NOT NULL, targets TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'idle', generation INTEGER NOT NULL DEFAULT 0, attempt_id TEXT, registry_id TEXT UNIQUE, runtime_device_id TEXT, runtime_seen_at INTEGER, PRIMARY KEY(worker_id,id));
        INSERT INTO slots(worker_id,id,device_id,targets,state,generation,attempt_id) SELECT worker_id,id,device_id,targets,state,generation,attempt_id FROM slots_old;
        DROP TABLE slots_old;
      `);
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS managed_devices(id TEXT PRIMARY KEY, worker_id TEXT NOT NULL REFERENCES workers(id), identity TEXT NOT NULL, native_id TEXT NOT NULL, observation TEXT NOT NULL, last_seen_at INTEGER NOT NULL, present INTEGER NOT NULL, settings TEXT NOT NULL, UNIQUE(worker_id,identity));
        CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, config_revision INTEGER NOT NULL, data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS project_approvals(project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE, config_revision INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS catalog_scans(scan_id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, commit_sha TEXT NOT NULL, config_revision INTEGER NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, error_summary TEXT);
        CREATE INDEX IF NOT EXISTS catalog_scans_project ON catalog_scans(project_id,created_at DESC);
        CREATE TABLE IF NOT EXISTS catalogs(catalog_id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, commit_sha TEXT NOT NULL, config_revision INTEGER NOT NULL, created_at INTEGER NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS catalogs_project ON catalogs(project_id,created_at DESC);
        CREATE TABLE IF NOT EXISTS webhook_deliveries(project_id TEXT NOT NULL, delivery_id TEXT NOT NULL, received_at INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(project_id,delivery_id));
        CREATE TABLE IF NOT EXISTS branch_heads(project_id TEXT NOT NULL, branch TEXT NOT NULL, commit_sha TEXT NOT NULL, event_at INTEGER NOT NULL, delivery_id TEXT NOT NULL, PRIMARY KEY(project_id,branch));
      `);
      if (version < 4) {
        const targets = this.db.prepare('SELECT id,data FROM targets ORDER BY id').all() as Row[];
        for (const row of targets) {
          const target = targetSchema.parse(JSON.parse(String(row.data)));
          const project = projectSchema.parse({
            ...target,
            defaultBranch: 'main',
            configRevision: 1,
            repositoryCredentialRef: null,
            webhookSecretDigest: null,
            webhookStatus: 'disabled',
            autoRun: { enabled: false, branch: 'main', selections: [], revision: 1 },
          });
          this.db.prepare('INSERT OR IGNORE INTO projects(id,config_revision,data) VALUES(?,?,?)')
            .run(project.id, project.configRevision, JSON.stringify(project));
        }
      }
      if (version < 5) this.db.exec('ALTER TABLE catalog_scans ADD COLUMN data TEXT;');
      if (version < 6) {
        const columns = this.db.prepare('PRAGMA table_info(workers)').all() as Row[];
        if (!columns.some(column => column.name === 'catalog_projects')) this.db.exec("ALTER TABLE workers ADD COLUMN catalog_projects TEXT NOT NULL DEFAULT '[]'");
      }
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS worker_pairings(id TEXT PRIMARY KEY, worker_id TEXT NOT NULL, code_hash TEXT NOT NULL UNIQUE, expires_at INTEGER NOT NULL, consumed_at INTEGER, revoked INTEGER NOT NULL DEFAULT 0, token_hash TEXT UNIQUE);
        CREATE TABLE IF NOT EXISTS worker_timeline_events(attempt_id TEXT NOT NULL REFERENCES attempts(id), seq INTEGER NOT NULL, received_at INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(attempt_id,seq));
        CREATE TABLE IF NOT EXISTS project_workers(project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, worker_id TEXT NOT NULL REFERENCES workers(id) ON DELETE CASCADE, PRIMARY KEY(project_id,worker_id));
        CREATE INDEX IF NOT EXISTS project_workers_worker ON project_workers(worker_id);
        CREATE TABLE IF NOT EXISTS project_secure_files(
          id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          path TEXT NOT NULL, size INTEGER NOT NULL, created_at INTEGER NOT NULL,
          iv BLOB NOT NULL, tag BLOB NOT NULL, ciphertext BLOB NOT NULL, UNIQUE(project_id,path));
      `);
      if (version < 9) this.db.exec(`
        INSERT INTO project_workers(project_id,worker_id)
        SELECT p.id, grants.worker_id FROM projects p JOIN (
          SELECT workers.id AS worker_id, target.value AS project_id FROM workers, json_each(catalog_projects) AS target
          UNION
          SELECT worker_id, target.value FROM slots, json_each(targets) AS target WHERE registry_id IS NULL
          UNION
          SELECT worker_id, target.value FROM managed_devices, json_each(settings,'$.targets') AS target
            WHERE json_extract(settings,'$.managed')=1 AND json_extract(settings,'$.enabled')=1
        ) AS grants ON grants.project_id=p.id JOIN workers w ON w.id=grants.worker_id;
        ALTER TABLE workers DROP COLUMN catalog_projects;
        PRAGMA user_version=9;
      `);
    });
    this.workerTimelines = new WorkerTimelineStore(this);
    this.workerDiagnostics = new WorkerDiagnosticsStore(this);
  }
  close() {
    this.db.close();
  }
  private transactionDepth = 0;
  transaction<T>(fn: () => T): T {
    if (this.transactionDepth) return fn();
    this.transactionDepth++;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (e) {
      this.db.exec('ROLLBACK');
      this.controlChanges = [];
      throw e;
    } finally {
      this.transactionDepth--;
      const changes = this.controlChanges.splice(0);
      // Deliver only committed state, outside SQLite transactions.
      for (const [id, kind] of changes) this.controlChanged(id, kind);
    }
  }
  /** Generate a one-time host enrollment code. Only digests are durable. */
  createWorkerPairing(input: unknown, actor: string) {
    const { workerId } = workerPairingRequestSchema.parse(input);
    return this.transaction(() => {
      const registered = this.db.prepare('SELECT id FROM workers WHERE id=?').get(workerId);
      const previouslyPaired = this.db.prepare('SELECT id FROM worker_pairings WHERE worker_id=?').get(workerId);
      if ((registered && !previouslyPaired) ||
          this.db.prepare('SELECT id FROM worker_pairings WHERE worker_id=? AND revoked=0 AND consumed_at IS NULL AND expires_at>?').get(workerId, this.now()))
        throw new CloudError(409, 'Worker ID already registered or awaiting pairing');
      const id = identifier(), raw = randomBytes(10).toString('hex').toUpperCase();
      const expiresAt = this.now() + 10 * 60 * 1000;
      this.db.prepare('INSERT INTO worker_pairings(id,worker_id,code_hash,expires_at) VALUES(?,?,?,?)').run(id, workerId, digest(raw), expiresAt);
      this.event(null, 'worker-pairing-created', { actor, pairingId: id, workerId });
      return { ...this.workerPairing(id), code: raw.match(/.{4}/g)!.join('-') };
    });
  }
  listWorkerPairings(): WorkerPairingStatus[] {
    return (this.db.prepare('SELECT id FROM worker_pairings ORDER BY expires_at DESC').all() as Row[]).map(row => this.workerPairing(String(row.id)));
  }
  workerPairing(id: string): WorkerPairingStatus {
    const row = this.db.prepare('SELECT * FROM worker_pairings WHERE id=?').get(id) as Row | undefined;
    if (!row) throw new CloudError(404, 'Pairing not found');
    return { id, workerId: String(row.worker_id), expiresAt: Number(row.expires_at),
      state: row.revoked ? 'revoked' : row.consumed_at !== null ? 'paired' : Number(row.expires_at) <= this.now() ? 'expired' : 'pending' };
  }
  redeemWorkerPairing(code: unknown) {
    const parsed = workerPairCodeSchema.safeParse(code);
    if (!parsed.success) throw new CloudError(400, 'Pairing code unavailable');
    return this.transaction(() => {
      const row = this.db.prepare('SELECT * FROM worker_pairings WHERE code_hash=? AND revoked=0 AND consumed_at IS NULL AND expires_at>?').get(digest(parsed.data), this.now()) as Row | undefined;
      if (!row || (this.db.prepare('SELECT id FROM workers WHERE id=?').get(String(row.worker_id)) &&
          !this.db.prepare('SELECT id FROM worker_pairings WHERE worker_id=?').get(String(row.worker_id))))
        throw new CloudError(400, 'Pairing code unavailable');
      const token = randomBytes(32).toString('base64url'), workerId = String(row.worker_id);
      const revoked = this.db.prepare('UPDATE worker_pairings SET revoked=1,token_hash=NULL WHERE worker_id=? AND revoked=0 AND consumed_at IS NOT NULL').run(workerId);
      if (revoked.changes) this.controlChanged(workerId, 'worker-credential-revoked');
      this.db.prepare('INSERT OR IGNORE INTO workers(id) VALUES(?)').run(workerId);
      this.db.prepare('UPDATE worker_pairings SET consumed_at=?,token_hash=? WHERE id=?').run(this.now(), digest(token), String(row.id));
      this.event(null, 'worker-paired', { workerId, pairingId: row.id });
      return { workerId, token };
    });
  }
  workerForCredential(hash: string): string | undefined {
    const row = this.db.prepare('SELECT worker_id FROM worker_pairings WHERE token_hash=? AND revoked=0 AND consumed_at IS NOT NULL').get(hash);
    return row ? String(row.worker_id) : undefined;
  }
  revokeWorkerPairing(id: string, actor: string) {
    return this.transaction(() => {
      const pairing = this.workerPairing(id);
      this.db.prepare('UPDATE worker_pairings SET revoked=1,token_hash=NULL WHERE id=?').run(id);
      this.event(null, 'worker-pairing-revoked', { actor, workerId: pairing.workerId, pairingId: id });
      this.controlChanged(pairing.workerId, 'worker-credential-revoked');
      return this.workerPairing(id);
    });
  }
  configure(targets: unknown[], workers: unknown[]) {
    this.transaction(() => {
      const parsed = targets.map((t) => targetSchema.parse(t));
      for (const target of parsed) {
        const project = projectSchema.parse({
          ...target,
          defaultBranch: 'main',
          configRevision: 1,
          repositoryCredentialRef: null,
          webhookSecretDigest: null,
          webhookStatus: 'disabled',
          autoRun: { enabled: false, branch: 'main', selections: [], revision: 1 },
        });
        this.db.prepare('INSERT OR IGNORE INTO projects(id,config_revision,data) VALUES(?,?,?)')
          .run(project.id, project.configRevision, JSON.stringify(project));
      }
      const registered = workers.map((w) => workerSchema.parse(w));
      for (const worker of registered) {
        const inserted = this.db.prepare('INSERT OR IGNORE INTO workers(id) VALUES(?)').run(worker.id);
        if (!inserted.changes) continue;
        const bind = this.db.prepare('INSERT OR IGNORE INTO project_workers(project_id,worker_id) SELECT id,? FROM projects WHERE id=?');
        for (const projectId of worker.catalogProjects) bind.run(worker.id, projectId);
        for (const slot of worker.slots) {
          if (slot.targets.some((t) => !this.targets().some((p) => p.id === t)))
            throw new CloudError(400, 'Unknown slot target');
          // Configuration is a bootstrap seed. Database-owned settings survive restart.
          this.db
            .prepare(
              'INSERT OR IGNORE INTO slots(worker_id,id,device_id,targets) VALUES(?,?,?,?)',
            )
            .run(
              worker.id,
              slot.id,
              slot.deviceId,
              JSON.stringify(slot.targets),
            );
          for (const projectId of slot.targets) bind.run(worker.id, projectId);
        }
      }
    });
  }

  targets(): ApplicationTarget[] {
    return this.projects().map(targetFromProject);
  }
  projects(): Project[] {
    return (this.db.prepare('SELECT data FROM projects ORDER BY id').all() as Row[])
      .map((row) => projectSchema.parse(JSON.parse(String(row.data))));
  }
  project(id: string): Project {
    const row = this.db.prepare('SELECT data FROM projects WHERE id=?').get(id) as Row | undefined;
    if (!row) throw new CloudError(404, 'Project not found');
    return projectSchema.parse(JSON.parse(String(row.data)));
  }
  createProject(value: unknown): Project {
    const project = projectSchema.parse(value);
    if (project.configRevision !== 1) throw new CloudError(400, 'New project revision must be 1');
    try {
      this.transaction(() => {
        this.db.prepare('INSERT INTO projects(id,config_revision,data) VALUES(?,?,?)')
          .run(project.id, project.configRevision, JSON.stringify(project));

      });
    } catch (error) {
      if (String(error).includes('UNIQUE')) throw new CloudError(409, 'Project ID already exists');
      throw error;
    }
    return project;
  }
  updateProject(id: string, value: unknown): Project {
    const input = projectSchema.parse(value);
    if (input.id !== id) throw new CloudError(400, 'Project identity mismatch');
    return this.transaction(() => {
      const current = this.project(id);
      const next = projectSchema.parse({
        ...input,
        configRevision: current.configRevision + 1,
        autoRun: {
          ...input.autoRun,
          revision: JSON.stringify(input.autoRun) === JSON.stringify(current.autoRun)
            ? current.autoRun.revision
            : current.autoRun.revision + 1,
        },
      });
      this.db.prepare('UPDATE projects SET config_revision=?,data=? WHERE id=?')
        .run(next.configRevision, JSON.stringify(next), id);

      return next;
    });
  }
  deleteProject(id: string): void {
    this.transaction(() => {
      const activeScan = this.db.prepare("SELECT 1 FROM catalog_scans WHERE project_id=? AND status IN ('queued','running')").get(id);
      if (activeScan) throw new CloudError(409, 'Project has active scans');
      const active = this.db.prepare("SELECT 1 FROM requests WHERE json_extract(data,'$.input.targetId')=? AND state NOT IN ('completed','cancelled','superseded','infrastructure_failed') LIMIT 1").get(id);
      if (active) throw new CloudError(409, 'Project has active requests');
      if (!this.db.prepare('DELETE FROM projects WHERE id=?').run(id).changes)
        throw new CloudError(404, 'Project not found');

    });
  }
  createCatalogScan(projectId: string, commit = unresolvedCatalogCommit, push?: CatalogScanLease['push'], branchName?: string): CatalogScan {
    const project = this.project(projectId);
    if (!/^[0-9a-f]{40}$/.test(commit)) throw new CloudError(400, 'Commit must be a 40 character SHA');
    const branch = push?.branch ?? (commit === unresolvedCatalogCommit ? branchName ?? project.defaultBranch : undefined);
    return this.transaction(() => {
      const pending = this.db.prepare("SELECT * FROM catalog_scans WHERE project_id=? AND status IN ('queued','running') ORDER BY created_at DESC, rowid DESC").all(projectId);
      const duplicate = pending.find(row => {
        if (row.commit_sha !== commit || row.config_revision !== project.configRevision) return false;
        const job = JSON.parse(String(row.data));
        return job?.branch === branch && JSON.stringify(job?.push) === JSON.stringify(push);
      });
      if (duplicate) return this.catalogScanFromRow(duplicate);
      if (pending.length >= 100) throw new CloudError(429, 'Project scan queue is full');
      const now = this.now();
      const scan = catalogScanSchema.parse({ scanId: identifier(), projectId, commit, branch, configRevision: project.configRevision, status: 'queued', createdAt: now, updatedAt: now });
      const data = JSON.stringify({ project: { ...project, webhookSecretDigest: null }, push, branch });
      this.db.prepare('INSERT INTO catalog_scans(scan_id,project_id,commit_sha,config_revision,status,created_at,updated_at,error_summary,data) VALUES(?,?,?,?,?,?,?,NULL,?)')
        .run(scan.scanId, projectId, commit, scan.configRevision, scan.status, now, now, data);
      this.event(null, 'catalog-scan-queued', { projectId, scanId: scan.scanId, commit, branch, configRevision: scan.configRevision });
      return scan;
    });
  }
  catalogScan(projectId: string, scanId: string): CatalogScan {
    const row = this.db.prepare('SELECT * FROM catalog_scans WHERE project_id=? AND scan_id=?').get(projectId, scanId) as Row | undefined;
    if (!row) throw new CloudError(404, 'Catalog scan not found');
    return this.catalogScanFromRow(row);
  }
  listCatalogScans(projectId: string): CatalogScan[] {
    return this.catalogScanRows(projectId).map(row => this.catalogScanFromRow(row));
  }
  private catalogScanRows(projectId: string): Row[] {
    this.project(projectId);
    return this.db.prepare('SELECT * FROM catalog_scans WHERE project_id=? ORDER BY created_at DESC, rowid DESC LIMIT 50').all(projectId);
  }
  private catalogScanFromRow(row: Row): CatalogScan {
    const branch = row.data ? JSON.parse(String(row.data)).branch : undefined;
    return catalogScanSchema.parse({ scanId: String(row.scan_id), projectId: String(row.project_id), commit: String(row.commit_sha), configRevision: Number(row.config_revision), status: String(row.status), ...(branch ? { branch } : {}), createdAt: Number(row.created_at), updatedAt: Number(row.updated_at), ...(row.error_summary ? { errorSummary: String(row.error_summary) } : {}) });
  }
  catalogScanRecords(projectId: string, connectedScanners: ReadonlySet<string>): CatalogScanRecord[] {
    const rows = this.catalogScanRows(projectId);
    const queue = rows.some(row => row.status === 'queued') ? this.catalogScanQueue(projectId, connectedScanners) : undefined;
    return rows.map(row => {
      const scan = this.catalogScanFromRow(row);
      if (scan.status === 'queued') return { ...scan, queue };
      const workerId = row.data ? JSON.parse(String(row.data)).workerId : undefined;
      return typeof workerId === 'string' ? { ...scan, workerId } : scan;
    });
  }
  private catalogScanQueue(projectId: string, connectedScanners: ReadonlySet<string>): NonNullable<CatalogScanRecord['queue']> {
    const workerIds = this.projectWorkerIds(projectId);
    const connected = workerIds.filter(id => connectedScanners.has(id));
    const running = this.db.prepare("SELECT project_id,json_extract(data,'$.workerId') AS worker_id FROM catalog_scans WHERE status='running' AND updated_at>=?")
      .all(this.now() - catalogLeaseMs);
    const busy = new Set(running.map(row => row.worker_id));
    let reason: CatalogScanQueueReason = 'waiting';
    if (!this.db.prepare('SELECT 1 FROM workers LIMIT 1').get()) reason = 'no_worker';
    else if (!workerIds.length) reason = 'project_not_assigned';
    else if (!connected.length) reason = 'scanner_disconnected';
    else if (running.some(row => row.project_id === projectId)) reason = 'project_busy';
    else if (connected.every(id => busy.has(id))) reason = 'workers_busy';
    return { reason, workerIds };
  }
  private workerProjectIds(workerId: string): string[] {
    return this.db.prepare('SELECT project_id FROM project_workers WHERE worker_id=? ORDER BY project_id').all(workerId).map(row => String(row.project_id));
  }
  private projectWorkerIds(projectId: string): string[] {
    return this.db.prepare('SELECT worker_id FROM project_workers WHERE project_id=? ORDER BY worker_id').all(projectId).map(row => String(row.worker_id));
  }
  projectWorkers(projectId: string): ProjectWorkerBinding[] {
    this.project(projectId);
    const bound = new Set(this.projectWorkerIds(projectId));
    return this.listWorkers().map(({ id, health, paused }) => ({ id, health, paused, bound: bound.has(id) }));
  }
  setProjectWorkers(projectId: string, workerIds: string[], expectedWorkerIds: string[], actor: string): ProjectWorkerBinding[] {
    return this.transaction(() => {
      this.project(projectId);
      const current = JSON.stringify(this.projectWorkerIds(projectId));
      const next = [...new Set(workerIds)].sort();
      if (JSON.stringify(next) === current) return this.projectWorkers(projectId);
      if (JSON.stringify([...new Set(expectedWorkerIds)].sort()) !== current)
        throw new CloudError(409, 'Worker bindings changed. Reload the project settings and try again.');
      const exists = this.db.prepare('SELECT 1 FROM workers WHERE id=?');
      if (next.some(id => !exists.get(id))) throw new CloudError(400, 'Unknown Worker');
      this.db.prepare('DELETE FROM project_workers WHERE project_id=?').run(projectId);
      const insert = this.db.prepare('INSERT INTO project_workers(project_id,worker_id) VALUES(?,?)');
      for (const id of next) insert.run(projectId, id);
      this.event(null, 'project-workers-updated', { projectId, workerIds: next, actor });
      return this.projectWorkers(projectId);
    });
  }
  workerStatuses(connectedScanners: ReadonlySet<string>): WorkerStatus[] {
    const activeScans = this.db.prepare("SELECT *,json_extract(data,'$.workerId') AS worker_id FROM catalog_scans WHERE status='running' AND updated_at>=?")
      .all(this.now() - catalogLeaseMs);
    const scansByWorker = new Map(activeScans.map(row => [row.worker_id, this.catalogScanFromRow(row)]));
    return this.listWorkers().map(worker => ({
      ...worker,
      catalogScannerConnected: connectedScanners.has(worker.id),
      projectIds: this.workerProjectIds(worker.id),
      activeCatalogScan: scansByWorker.get(worker.id),
    }));
  }
  updateCatalogScan(scanId: string, status: CatalogScan['status'], errorSummary?: string): CatalogScan {
    const row = this.db.prepare('SELECT project_id FROM catalog_scans WHERE scan_id=?').get(scanId) as Row | undefined;
    if (!row) throw new CloudError(404, 'Catalog scan not found');
    this.db.prepare('UPDATE catalog_scans SET status=?,updated_at=?,error_summary=? WHERE scan_id=?')
      .run(status, this.now(), errorSummary?.slice(0, 4000) ?? null, scanId);
    this.controlChanged(scanId, 'catalog-scan-updated');
    return this.catalogScan(String(row.project_id), scanId);
  }
  claimCatalogScan(workerId: string): CatalogScanLease | null {
    return this.transaction(() => {
      this.expireCatalogScans();
      if (this.db.prepare("SELECT 1 FROM catalog_scans WHERE status='running' AND json_extract(data,'$.workerId')=?").get(workerId)) return null;
      if (!this.db.prepare('SELECT 1 FROM workers WHERE id=?').get(workerId)) throw new CloudError(403, 'Unknown scanning worker');
      const allowed = new Set(this.workerProjectIds(workerId));
      const row = (this.db.prepare("SELECT * FROM catalog_scans WHERE status='queued' ORDER BY created_at, rowid").all() as Row[]).find(row => allowed.has(String(row.project_id)) && !this.db.prepare("SELECT 1 FROM catalog_scans WHERE project_id=? AND status='running'").get(String(row.project_id)));
      if (!row) return null;
      const job = row.data ? JSON.parse(String(row.data)) : { project: this.project(String(row.project_id)) };
      const token = identifier();
      this.db.prepare("UPDATE catalog_scans SET status='running',updated_at=?,data=? WHERE scan_id=?").run(this.now(), JSON.stringify({ ...job, workerId, tokenHash: digest(token) }), String(row.scan_id));
      return { scan: this.catalogScan(String(row.project_id), String(row.scan_id)), project: job.project, token, expiresAt: this.now() + catalogLeaseMs, ...(job.push ? { push: job.push } : {}) };
    });
  }
  expireCatalogScans(): void {
    const expired = this.db.prepare("UPDATE catalog_scans SET status='failed',error_summary='Scan lease expired',updated_at=? WHERE status='running' AND updated_at<?").run(this.now(), this.now() - catalogLeaseMs);
    if (expired.changes) this.controlChanged(null, 'catalog-scan-updated');
  }
  heartbeatCatalogScan(workerId: string, scanId: string, token: string) {
    const row = this.db.prepare('SELECT * FROM catalog_scans WHERE scan_id=?').get(scanId) as Row | undefined;
    if (!row) throw new CloudError(404, 'Scan not found');
    const job = JSON.parse(String(row.data));
    if (row.status !== 'running' || job.workerId !== workerId || job.tokenHash !== digest(token) || Number(row.updated_at) < this.now() - catalogLeaseMs) throw new CloudError(409, 'Scan lease lost');
    this.db.prepare('UPDATE catalog_scans SET updated_at=? WHERE scan_id=?').run(this.now(), scanId);
    return { expiresAt: this.now() + catalogLeaseMs };
  }
  pinCatalogScanCommit(workerId: string, scanId: string, token: string, value: string) {
    const commit = catalogCommitSchema.parse(value);
    return this.transaction(() => {
      this.heartbeatCatalogScan(workerId, scanId, token);
      const row = this.db.prepare('SELECT project_id,commit_sha FROM catalog_scans WHERE scan_id=?').get(scanId)!;
      const scan = this.catalogScan(String(row.project_id), scanId);
      if (!scan.branch || (scan.commit !== unresolvedCatalogCommit && scan.commit !== commit))
        throw new CloudError(409, 'Scan commit is already fixed');
      if (scan.commit === commit) return scan;
      this.db.prepare('UPDATE catalog_scans SET commit_sha=? WHERE scan_id=?').run(commit, scanId);
      this.updateBranchHead(scan.projectId, scan.branch, commit, this.now(), scanId);
      this.controlChanged(scanId, 'catalog-scan-updated');
      return this.catalogScan(scan.projectId, scanId);
    });
  }
  finishCatalogScan(workerId: string, scanId: string, token: string, value: unknown, head?: string) {
    return this.transaction(() => {
      this.heartbeatCatalogScan(workerId, scanId, token);
      const row = this.db.prepare('SELECT * FROM catalog_scans WHERE scan_id=?').get(scanId) as Row;
      const job = JSON.parse(String(row.data));
      const catalog = catalogSchema.parse(value);
      if (catalog.catalogId !== scanId || catalog.projectId !== row.project_id) throw new CloudError(400, 'Scan identity mismatch');
      if (job.push && head) {
        if (!/^[0-9a-f]{40}$/.test(head)) throw new CloudError(400, 'Invalid branch head');
        // Worker verifies current remote HEAD; delayed events cannot overwrite it with their old SHA.
        this.updateBranchHead(String(row.project_id), job.branch, head, this.now(), job.push?.deliveryId ?? scanId);
      }
      return this.saveCatalog(catalog);
    });
  }
  cancelCatalogScan(projectId: string, scanId: string) {
    const scan = this.catalogScan(projectId, scanId);
    if (['queued', 'running'].includes(scan.status)) this.updateCatalogScan(scanId, 'cancelled');
    return this.catalogScan(projectId, scanId);
  }
  pruneCatalogs(projectId: string) {
    this.db.prepare("DELETE FROM catalogs WHERE project_id=? AND catalog_id NOT IN (SELECT catalog_id FROM catalogs WHERE project_id=? ORDER BY created_at DESC LIMIT 20) AND catalog_id NOT IN (SELECT json_extract(data,'$.catalogId') FROM requests WHERE json_extract(data,'$.catalogId') IS NOT NULL)").run(projectId, projectId);
  }
  saveCatalog(value: unknown): TestCatalog {
    const result = catalogSchema.parse(value);
    const scan = this.catalogScan(result.projectId, result.catalogId);
    if (scan.commit !== result.commit || scan.configRevision !== result.configRevision) throw new CloudError(409, 'Catalog does not match scan');
    const catalog = catalogSchema.parse({ ...result, branch: scan.branch });
    const row = this.db.prepare('SELECT data FROM catalog_scans WHERE scan_id=?').get(scan.scanId) as Row;
    const job = JSON.parse(String(row.data));
    const project = projectSchema.parse(job.project);
    if (Buffer.byteLength(JSON.stringify(catalog)) > 4 * 1024 * 1024 || catalog.suites.reduce((n, suite) => n + suite.cases.length, 0) > 10000) throw new CloudError(400, 'Catalog size limit exceeded');
    const suiteIds = new Set<string>();
    for (const suite of catalog.suites) {
      const configuredPattern = Object.hasOwn(project.suites, suite.id) ? project.suites[suite.id] : undefined;
      const derived = configuredPattern === undefined && project.suiteMode === 'directories' && derivedCatalogSuite(suite);
      if (suiteIds.has(suite.id) || (!derived && configuredPattern !== suite.pattern)) throw new CloudError(400, 'Invalid catalog suite');
      suiteIds.add(suite.id);
      const ids = new Set<string>();
      for (const item of suite.cases) {
        if (ids.has(item.caseId) || !suite.files.includes(item.file) || digest(JSON.stringify([item.file, item.titlePath, item.duplicateIndex])) !== item.caseId) throw new CloudError(400, 'Invalid catalog case');
        ids.add(item.caseId);
      }
    }
    this.transaction(() => {
      const existing = this.db.prepare('SELECT data FROM catalogs WHERE catalog_id=?').get(catalog.catalogId) as Row | undefined;
      if (existing) {
        if (String(existing.data) !== JSON.stringify(catalog)) throw new CloudError(409, 'Catalog is immutable');
        return;
      }
      this.db.prepare('INSERT INTO catalogs(catalog_id,project_id,commit_sha,config_revision,created_at,status,data) VALUES(?,?,?,?,?,?,?)')
        .run(catalog.catalogId, catalog.projectId, catalog.commit, catalog.configRevision, catalog.createdAt, catalog.status, JSON.stringify(catalog));
      this.db.prepare('UPDATE catalog_scans SET status=?,commit_sha=?,updated_at=?,error_summary=NULL WHERE scan_id=?').run(catalog.status, catalog.commit, this.now(), catalog.catalogId);
      const current = this.project(project.id);
      if (job.push && catalog.status === 'ready' && current.autoRun.enabled && current.autoRun.revision === job.push.policyRevision && current.configRevision === project.configRevision && catalog.commit === this.branchHead(project.id, job.push.branch)?.commit) {
        for (const selection of project.autoRun.selections) {
          // Discovery remains valid when a repository removes an automatic-run selection.
          if ((selection.scenario && !catalog.scenarios.some(scenario => scenario.name === selection.scenario)) || !catalog.suites.some(suite => suite.id === selection.suite && suite.cases.length)) continue;
          const autoKey = `auto:${digest(JSON.stringify([project.id, job.push.branch, catalog.commit, job.push.policyRevision, selection]))}`;
          if (this.db.prepare('SELECT 1 FROM requests WHERE actor=? AND idem=?').get(`webhook:${project.id}`, autoKey)) continue;
          const request = this.submitProject({ projectId: project.id, catalogId: catalog.catalogId, commit: catalog.commit, mode: 'suite', ...selection, source: { kind: 'push', branch: job.push.branch, deliveryId: job.push.deliveryId }, autoPolicyRevision: job.push.policyRevision }, `webhook:${project.id}`, autoKey);
          this.supersedeQueued(project.id, job.push.branch, job.push.policyRevision, selection.suite, selection.scenario, request.id);
        }
      }
      this.pruneCatalogs(project.id);
      this.controlChanged(null, 'catalog-scan-updated');
    });
    return catalog;
  }
  catalogs(projectId: string): TestCatalog[] {
    this.project(projectId);
    return (this.db.prepare('SELECT data FROM catalogs WHERE project_id=? ORDER BY created_at DESC LIMIT 50').all(projectId) as Row[])
      .map((row) => catalogSchema.parse(JSON.parse(String(row.data))));
  }
  catalog(projectId: string, catalogId: string): TestCatalog {
    const row = this.db.prepare('SELECT data FROM catalogs WHERE project_id=? AND catalog_id=?').get(projectId, catalogId) as Row | undefined;
    if (!row) throw new CloudError(404, 'Catalog not found');
    return catalogSchema.parse(JSON.parse(String(row.data)));
  }
  private readyCatalogId(projectId: string, commit: string, configRevision: number): string | undefined {
    const row = this.db.prepare(`
      SELECT catalogs.catalog_id FROM catalogs JOIN catalog_scans ON catalog_scans.scan_id=catalogs.catalog_id
      WHERE catalogs.project_id=? AND catalogs.commit_sha=? AND catalogs.config_revision=? AND catalogs.status='ready'
        AND json_extract(catalog_scans.data,'$.workerId') IS NOT NULL
      ORDER BY catalogs.created_at DESC, catalogs.rowid DESC LIMIT 1
    `).get(projectId, commit, configRevision);
    return row && String(row.catalog_id);
  }
  submitProject(value: unknown, actor: string, key: string): TestRequest {
    const input = projectSubmissionSchema.parse(value);
    if (!key || key.length > 200) throw new CloudError(400, 'Idempotency-Key required (max 200 characters)');
    const fingerprint = digest(JSON.stringify(input));
    const old = this.db.prepare('SELECT fingerprint,data FROM requests WHERE actor=? AND idem=?').get(actor, key) as Row | undefined;
    if (old) {
      if (old.fingerprint !== fingerprint) throw new CloudError(409, 'Idempotency conflict');
      return JSON.parse(String(old.data));
    }
    const project = this.project(input.projectId);
    const catalogId = input.catalogId ?? this.readyCatalogId(project.id, input.commit, project.configRevision);
    const directoryMode = project.suiteMode === 'directories';
    if (!directoryMode && (!Object.hasOwn(project.suites, input.suite) || (!input.catalogId && input.scenario && !project.scenarios.includes(input.scenario)))) throw new CloudError(400, 'Unknown project suite or scenario');
    let selectedSuite: TestCatalog['suites'][number] | undefined;
    let selectedCase: TestCatalog['suites'][number]['cases'][number] | undefined;
    if (input.mode === 'case' || input.catalogId || directoryMode) {
      if (!input.catalogId && input.mode === 'case') throw new CloudError(400, 'Case selection requires catalogId');
      if (!catalogId) throw new CloudError(409, 'A ready catalog is required for directory suites');
      const catalog = this.catalog(input.projectId, catalogId);
      if (catalog.commit !== input.commit || catalog.configRevision !== project.configRevision || catalog.status !== 'ready') throw new CloudError(409, 'Catalog does not match project commit or revision');
      selectedSuite = catalog.suites.find((candidate) => candidate.id === input.suite);
      if (!selectedSuite || (input.scenario && !catalog.scenarios.some(scenario => scenario.name === input.scenario))) throw new CloudError(400, 'Unknown catalog suite or scenario');
      selectedCase = input.mode === 'case' ? selectedSuite?.cases.find((candidate) => candidate.caseId === input.caseId) : undefined;
      if (input.mode === 'case' && !selectedCase) throw new CloudError(400, 'Unknown catalog case');
    }
    const branch = catalogId ? this.catalogScan(project.id, catalogId).branch : input.source.branch;
    const source = { ...input.source, branch };
    const snapshot: Submission = { targetId: project.id, commit: input.commit, suite: input.suite, ...(input.scenario ? { scenario: input.scenario } : {}), source };
    return this.transaction(() => {
      const old = this.db.prepare('SELECT fingerprint,data FROM requests WHERE actor=? AND idem=?').get(actor, key) as Row | undefined;
      if (old) {
        if (old.fingerprint !== fingerprint) throw new CloudError(409, 'Idempotency conflict');
        return JSON.parse(String(old.data));
      }
      const req: TestRequest = { id: identifier(), input: snapshot, target: targetFromProject(project), actor, createdAt: this.now(), queuedAt: this.now(), state: 'queued', verdict: 'unknown', attempts: 0, projectId: project.id, configRevision: project.configRevision, ...(catalogId ? { catalogId } : {}), selection: { mode: input.mode, suite: input.suite, ...(input.mode === 'suite' && selectedSuite ? { pattern: selectedSuite.pattern } : {}), ...(input.scenario ? { scenario: input.scenario } : {}), ...(selectedCase ? { caseId: selectedCase.caseId, file: selectedCase.file, titlePath: selectedCase.titlePath, duplicateIndex: selectedCase.duplicateIndex } : {}) }, source, ...(input.autoPolicyRevision ? { autoPolicyRevision: input.autoPolicyRevision } : {}) };
      this.attachSecureFiles(req);
      this.db.prepare('INSERT INTO requests VALUES(?,?,?,?,?,?,?,?)').run(req.id, actor, key, fingerprint, req.createdAt, req.queuedAt, req.state, JSON.stringify(req));
      this.event(req.id, 'submitted', { actor, projectId: project.id, source: input.source.kind, selection: req.selection });
      return req;
    });
  }
  recordWebhook(projectId: string, deliveryId: string, payload: unknown): boolean {
    this.project(projectId);
    if (!deliveryId || deliveryId.length > 300) throw new CloudError(400, 'Webhook delivery ID required');
    try {
      this.db.prepare('INSERT INTO webhook_deliveries(project_id,delivery_id,received_at,data) VALUES(?,?,?,?)')
        .run(projectId, deliveryId, this.now(), JSON.stringify(payload));
      return true;
    } catch (error) {
      if (String(error).includes('UNIQUE')) return false;
      throw error;
    }
  }
  branchHead(projectId: string, branch: string): { commit: string; eventAt: number; deliveryId: string } | undefined {
    const row = this.db.prepare('SELECT commit_sha,event_at,delivery_id FROM branch_heads WHERE project_id=? AND branch=?').get(projectId, branch) as Row | undefined;
    return row ? { commit: String(row.commit_sha), eventAt: Number(row.event_at), deliveryId: String(row.delivery_id) } : undefined;
  }
  updateBranchHead(projectId: string, branch: string, commit: string, eventAt: number, deliveryId: string): boolean {
    const current = this.branchHead(projectId, branch);
    if (current && current.eventAt > eventAt) return false;
    this.db.prepare('INSERT INTO branch_heads(project_id,branch,commit_sha,event_at,delivery_id) VALUES(?,?,?,?,?) ON CONFLICT(project_id,branch) DO UPDATE SET commit_sha=excluded.commit_sha,event_at=excluded.event_at,delivery_id=excluded.delivery_id')
      .run(projectId, branch, commit, eventAt, deliveryId);
    return true;
  }
  setWebhookSecret(projectId: string, secretDigest: string | null, status: Project['webhookStatus']): Project {
    return this.transaction(() => {
      const project = this.project(projectId);
      const next = projectSchema.parse({ ...project, webhookSecretDigest: secretDigest, webhookStatus: status });
      this.db.prepare('UPDATE projects SET data=? WHERE id=?').run(JSON.stringify(next), projectId);
      return next;
    });
  }
  supersedeQueued(projectId: string, branch: string, policyRevision: number, suite: string, scenario: string | undefined, replacementId: string): string[] {
    const replaced: string[] = [];
    this.transaction(() => {
      const rows = this.db.prepare("SELECT data FROM requests WHERE state='queued'").all() as Row[];
      for (const row of rows) {
        const request = JSON.parse(String(row.data)) as TestRequest;
        if (request.id === replacementId || request.projectId !== projectId || request.source?.kind !== 'push' || request.source.branch !== branch || request.autoPolicyRevision !== policyRevision || request.selection?.mode !== 'suite' || request.selection.suite !== suite || request.selection.scenario !== scenario) continue;
        request.supersededBy = replacementId;
        request.state = 'superseded';
        this.saveRequest(request);
        this.event(request.id, 'superseded', { replacementId });
        replaced.push(request.id);
      }
    });
    return replaced;
  }
  rerun(originalId: string, actor: string, key: string): TestRequest {
    if (!key || key.length > 200) throw new CloudError(400, 'Idempotency-Key required');
    return this.transaction(() => {
      const fingerprint = digest(JSON.stringify({ rerun: originalId }));
      const old = this.db.prepare('SELECT fingerprint,data FROM requests WHERE actor=? AND idem=?').get(actor, key) as Row | undefined;
      if (old) {
        if (old.fingerprint !== fingerprint) throw new CloudError(409, 'Idempotency conflict');
        return JSON.parse(String(old.data));
      }
      const original = this.getRequest(originalId);
      const available = this.db.prepare('SELECT 1 FROM project_secure_files WHERE id=? AND project_id=?');
      if (original.secureFiles?.some(file => !available.get(file.id, original.input.targetId)))
        throw new CloudError(409, 'A secure file from the original request was removed. Submit a new test request.');
      const { supersededBy: _superseded, autoPolicyRevision: _policy, ...snapshot } = original;
      const request: TestRequest = {
        ...snapshot,
        id: identifier(),
        actor,
        createdAt: this.now(),
        queuedAt: this.now(),
        state: 'queued',
        verdict: 'unknown',
        attempts: 0,
        selection: original.selection ?? { mode: 'suite', suite: original.input.suite, scenario: original.input.scenario },
        source: { kind: 'manual', ...(original.input.source?.branch ? { branch: original.input.source.branch } : {}) },
      };
      this.db.prepare('INSERT INTO requests VALUES(?,?,?,?,?,?,?,?)').run(request.id, actor, key, fingerprint, request.createdAt, request.queuedAt, request.state, JSON.stringify(request));
      this.event(request.id, 'manual-rerun', { original: originalId, actor });
      return request;
    });
  }
  submit(value: Submission, actor: string, key: string, projectId?: string): TestRequest {
    const input = submissionSchema.parse(value);
    if (!key || key.length > 200)
      throw new CloudError(
        400,
        'Idempotency-Key required (max 200 characters)',
      );
    const fingerprint = digest(projectId ? JSON.stringify({ input, projectId }) : JSON.stringify(input));
    return this.transaction(() => {
      const old = this.db
        .prepare(
          'SELECT fingerprint,data FROM requests WHERE actor=? AND idem=?',
        )
        .get(actor, key) as Row | undefined;
      if (old) {
        if (old.fingerprint !== fingerprint)
          throw new CloudError(409, 'Idempotency conflict');
        return JSON.parse(String(old.data));
      }
      const target = this.targets().find((t) => t.id === input.targetId);
      if (
        !target ||
        (input.scenario && !target.scenarios.includes(input.scenario))
      )
        throw new CloudError(
          400,
          'Unknown registered target, suite or scenario',
        );
      const revision = this.project(input.targetId).configRevision;
      const projectRevision = projectId ? this.project(projectId).configRevision : undefined;
      const catalogId = this.readyCatalogId(input.targetId, input.commit, revision);
      let pattern: string | undefined;
      if (target.suiteMode === 'directories') {
        if (!catalogId) throw new CloudError(409, 'A ready catalog is required for directory suites');
        pattern = this.catalog(target.id, catalogId).suites.find((suite) => suite.id === input.suite)?.pattern;
        if (!pattern) throw new CloudError(400, 'Unknown registered target, suite or scenario');
      } else if (!Object.hasOwn(target.suites, input.suite)) {
        throw new CloudError(400, 'Unknown registered target, suite or scenario');
      }
      const req: TestRequest = {
        id: identifier(),
        input,
        target,
        ...(projectId ? { projectId } : {}),
        actor,
        createdAt: this.now(),
        queuedAt: this.now(),
        state: 'queued',
        verdict: 'unknown',
        attempts: 0,
        selection: { mode: 'suite', suite: input.suite, ...(pattern ? { pattern } : {}), scenario: input.scenario },
        source: { kind: 'manual' },
        ...(catalogId ? { catalogId, configRevision: revision } : projectRevision ? { configRevision: projectRevision } : {}),
      };
      this.attachSecureFiles(req);
      this.db
        .prepare('INSERT INTO requests VALUES(?,?,?,?,?,?,?,?)')
        .run(
          req.id,
          actor,
          key,
          fingerprint,
          req.createdAt,
          req.queuedAt,
          req.state,
          JSON.stringify(req),
        );
      this.event(req.id, 'submitted', { actor });
      return req;
    });
  }
  getRequest(id: string): TestRequest {
    const row = this.db
      .prepare('SELECT data FROM requests WHERE id=?')
      .get(id) as Row | undefined;
    if (!row) throw new CloudError(404, 'Test request not found');
    return JSON.parse(String(row.data));
  }
  private attachSecureFiles(request: TestRequest): void {
    const find = this.db.prepare('SELECT id,path FROM project_secure_files WHERE project_id=? AND path=?');
    const files = new Map<string, SecureFileReference>();
    for (const { path } of flutterFileArguments(request.target.flutterArgs)) {
      const row = find.get(request.input.targetId, path.replace(/^\.\//, ''));
      if (row) files.set(String(row.id), { id: String(row.id), path: String(row.path) });
    }
    if (files.size) request.secureFiles = [...files.values()];
  }
  listRequests(
    options: {
      state?: string;
      projectId?: string;
      targetId?: string;
      search?: string;
      offset?: number;
      limit?: number;
    } = {},
  ) {
    const clauses: string[] = [];
    const args: Array<string | number> = [];
    if (options.state) {
      clauses.push('state=?');
      args.push(options.state);
    }
    if (options.projectId) {
      clauses.push("json_extract(data,'$.projectId')=?");
      args.push(options.projectId);
    }
    if (options.targetId) {
      clauses.push("json_extract(data,'$.input.targetId')=?");
      args.push(options.targetId);
    }
    if (options.search) {
      clauses.push('data LIKE ?');
      args.push(`%${options.search.slice(0, 200)}%`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const total = Number(
      (
        this.db
          .prepare(`SELECT COUNT(*) AS n FROM requests ${where}`)
          .get(...args) as Row
      ).n,
    );
    const rows = this.db
      .prepare(
        `SELECT data FROM requests ${where} ORDER BY created_at DESC,rowid DESC LIMIT ? OFFSET ?`,
      )
      .all(
        ...args,
        Math.max(1, Math.min(options.limit ?? 50, 100)),
        Math.max(0, options.offset ?? 0),
      ) as Row[];
    return {
      items: rows.map((r) => JSON.parse(String(r.data)) as TestRequest),
      total,
    };
  }
  latestCaseRuns(projectId: string, catalogId: string) {
    const rows = this.db.prepare(`
      WITH ranked AS (
        SELECT id, state, json_extract(data,'$.verdict') AS verdict,
          json_extract(data,'$.selection.suite') AS suite, json_extract(data,'$.selection.caseId') AS caseId,
          row_number() OVER (PARTITION BY json_extract(data,'$.selection.suite'),json_extract(data,'$.selection.caseId')
            ORDER BY created_at DESC,rowid DESC) AS position
        FROM requests WHERE json_extract(data,'$.projectId')=? AND json_extract(data,'$.catalogId')=?
          AND json_extract(data,'$.selection.mode')='case'
      ) SELECT id,state,verdict,suite,caseId FROM ranked WHERE position=1`).all(projectId, catalogId);
    return {
      catalogId,
      items: rows.map(row => ({ id: String(row.id), suite: String(row.suite), caseId: String(row.caseId),
        status: String(row.state === 'completed' ? row.verdict : row.state) })),
    };
  }
  requestBoard(depth: BoardDepth, search: string, targetId: string): BoardSnapshot {
    // Rank before limiting. Queue ranks are global even when a filter hides earlier requests.
    const rows = this.db.prepare(`
      WITH filters(target_id, term) AS (VALUES (?, lower(?))), classified AS (
        SELECT rowid AS rid, id, state, created_at, queued_at,
          CASE WHEN state='queued' THEN 'pending'
            WHEN state IN ('assigned','preparing','running','finalizing','cancel_requested') THEN 'running'
            WHEN state='infrastructure_failed' OR (state='completed' AND json_extract(data,'$.verdict')='failed') THEN 'failed'
            WHEN state='completed' AND json_extract(data,'$.verdict')='passed' THEN 'passed'
            ELSE 'other' END AS lane,
          json_extract(data,'$.input.targetId') AS target,
          json_extract(data,'$.input.suite') AS suite,
          json_extract(data,'$.selection.titlePath') AS title_path,
          json_extract(data,'$.input.commit') AS sha,
          coalesce(json_extract(data,'$.input.source.branch'),json_extract(data,'$.source.branch'),'') AS branch
        FROM requests
      ), ranked AS (
        SELECT rid,lane,count(*) OVER (PARTITION BY lane) AS total,
          row_number() OVER (PARTITION BY lane ORDER BY
            CASE WHEN lane='pending' THEN queued_at END,
            CASE WHEN lane='pending' THEN created_at END,
            CASE WHEN lane='pending' THEN rid END, created_at DESC,rid DESC) AS pos
        FROM classified, filters WHERE (target_id='' OR target=target_id) AND
          (term='' OR instr(lower(id),term) OR instr(lower(sha),term) OR instr(lower(branch),term)
           OR instr(lower(suite),term) OR instr(lower((SELECT group_concat(value,' › ') FROM json_each(title_path))),term))
      ) SELECT lane,total,r.data FROM ranked JOIN requests r ON r.rowid=ranked.rid
        WHERE pos <= CASE lane ${boardColumns.map(id => `WHEN '${id}' THEN ?`).join(' ')} END ORDER BY lane,pos
    `).all(targetId, search, ...boardColumns.map(id => depth[id]));
    const totals: BoardDepth = { pending: 0, running: 0, passed: 0, failed: 0, other: 0 };
    const items = rows.map(row => {
      totals[row.lane as TestColumn] = Number(row.total);
      const { target, ...request } = JSON.parse(String(row.data)) as TestRequest;
      return { ...request, repository: displayRepositoryPath(target.repository), projectName: target.name };
    });
    const queue = this.db.prepare("SELECT id FROM requests WHERE state='queued' ORDER BY queued_at,created_at,rowid").all().map(row => String(row.id));
    return { items, totals, queue };
  }
  queue(): TestRequest[] {
    return (
      this.db
        .prepare(
          "SELECT data FROM requests WHERE state='queued' ORDER BY queued_at,created_at,rowid",
        )
        .all() as Row[]
    ).map((r) => JSON.parse(String(r.data)));
  }
  private saveRequest(req: TestRequest) {
    this.db
      .prepare('UPDATE requests SET state=?,queued_at=?,data=? WHERE id=?')
      .run(req.state, req.queuedAt, JSON.stringify(req), req.id);
  }
  attempts(requestId: string): ExecutionAttempt[] {
    return (
      this.db
        .prepare('SELECT data FROM attempts WHERE request_id=? ORDER BY rowid')
        .all(requestId) as Row[]
    ).map((r) => JSON.parse(String(r.data)));
  }
  attempt(id: string): ExecutionAttempt {
    const row = this.db
      .prepare('SELECT data FROM attempts WHERE id=?')
      .get(id) as Row | undefined;
    if (!row) throw new CloudError(404, 'Execution attempt not found');
    return JSON.parse(String(row.data));
  }
  saveAttempt(attempt: ExecutionAttempt) {
    this.db
      .prepare(
        'INSERT INTO attempts VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',
      )
      .run(attempt.attemptId, attempt.requestId, JSON.stringify(attempt));
  }
  slot(
    workerId: string,
    id: string,
    required = true,
  ): ExecutionSlot | undefined {
    const r = this.db
      .prepare('SELECT * FROM slots WHERE worker_id=? AND id=?')
      .get(workerId, id) as Row | undefined;
    if (!r) {
      if (required) throw new CloudError(404, 'Execution slot not found');
      return;
    }
    return {
      workerId,
      id,
      deviceId: String(r.device_id),
      targets: JSON.parse(String(r.targets)),
      state: r.state as ExecutionSlot['state'],
      generation: Number(r.generation),
      attemptId: r.attempt_id as string | null,
    };
  }
  recordDeviceInventory(workerId: string, input: unknown): void {
    const inventory = deviceInventorySchema.parse(input);
    if (!this.db.prepare('SELECT id FROM workers WHERE id=?').get(workerId))
      throw new CloudError(404, 'Worker not registered');
    this.transaction(() => {
      const previous = this.db.prepare('SELECT data,received_at FROM device_inventories WHERE worker_id=?').get(workerId) as Row | undefined;
      const changed = !previous || this.now() - Number(previous.received_at) > 90000 ||
        JSON.stringify(JSON.parse(String(previous.data)).devices) !== JSON.stringify(inventory.devices);
      this.db
        .prepare(
          'INSERT INTO device_inventories VALUES(?,?,?) ON CONFLICT(worker_id) DO UPDATE SET received_at=excluded.received_at,data=excluded.data',
        )
        .run(workerId, this.now(), JSON.stringify(inventory));
      this.db
        .prepare('UPDATE managed_devices SET present=0 WHERE worker_id=?')
        .run(workerId);
      for (const observation of inventory.devices) {
        // AVD names survive the avd:name -> emulator-port transition.
        const identity = JSON.stringify([
          observation.platform,
          observation.kind,
          observation.platform === 'android' &&
          observation.kind === 'simulator' &&
          observation.avdName
            ? `avd:${observation.avdName}`
            : observation.id,
        ]);
        const id = digest(JSON.stringify([workerId, identity]));
        const existing = this.db
          .prepare('SELECT id FROM managed_devices WHERE id=?')
          .get(id);
        const seed = !existing
          ? (this.db
              .prepare(
                'SELECT * FROM slots WHERE worker_id=? AND device_id=? AND registry_id IS NULL',
              )
              .get(workerId, observation.id) as Row | undefined)
          : undefined;
        const settings: DeviceSettings = {
          alias: '',
          tags: [],
          managed: !!seed,
          enabled: !!seed,
          targets: seed ? JSON.parse(String(seed.targets)) : [],
          slotId: seed ? String(seed.id) : null,
        };
        this.db
          .prepare(
            'INSERT INTO managed_devices VALUES(?,?,?,?,?,?,1,?) ON CONFLICT(id) DO UPDATE SET native_id=excluded.native_id,observation=excluded.observation,last_seen_at=excluded.last_seen_at,present=1',
          )
          .run(
            id,
            workerId,
            identity,
            observation.id,
            JSON.stringify(observation),
            this.now(),
            JSON.stringify(settings),
          );
        if (seed)
          this.db
            .prepare(
              'UPDATE slots SET registry_id=? WHERE worker_id=? AND id=?',
            )
            .run(id, workerId, String(seed.id));
      }
      if (changed) this.controlChanged(workerId, 'device-inventory');
    });
  }
  listDevices(): ManagedDevice[] {
    const workers = this.listWorkers();
    const projectIds = new Map(workers.map(worker => [worker.id, this.workerProjectIds(worker.id)]));
    return (
      this.db
        .prepare('SELECT * FROM managed_devices ORDER BY worker_id,id')
        .all() as Row[]
    ).map((row) => {
      const settings = deviceSettingsSchema.parse(
        JSON.parse(String(row.settings)),
      );
      const worker = workers.find((w) => w.id === row.worker_id)!;
      const targets = (projectIds.get(worker.id) ?? []).filter(id => !settings.targets.length || settings.targets.includes(id));
      const slot = settings.slotId
        ? worker.slots.find((s) => s.id === settings.slotId)
        : undefined;
      const runtime = slot
        ? (this.db
            .prepare(
              'SELECT runtime_device_id,runtime_seen_at FROM slots WHERE worker_id=? AND id=? AND registry_id=?',
            )
            .get(worker.id, slot.id, String(row.id)) as Row | undefined)
        : undefined;
      const device: ManagedDevice = {
        id: String(row.id),
        workerId: worker.id,
        nativeId: String(row.native_id),
        observation: JSON.parse(String(row.observation)),
        lastSeenAt: Number(row.last_seen_at),
        present: !!row.present,
        stale:
          !worker.inventory ||
          worker.inventory.stale ||
          this.now() - Number(row.last_seen_at) >= 90000,
        settings,
        slot: slot && { ...slot, targets },
        runtimeSeenAt:
          runtime?.runtime_seen_at == null
            ? undefined
            : Number(runtime.runtime_seen_at),
        blockers: [],
        ready: false,
      };
      const reasons = device.blockers;
      if (!settings.managed) reasons.push('unmanaged');
      if (!settings.enabled) reasons.push('disabled');
      if (!device.present) reasons.push('missing');
      if (device.stale) reasons.push('stale');
      if (device.observation.state !== 'online') reasons.push('not-online');
      if (worker.paused) reasons.push('worker-paused');
      if (!slot) reasons.push('no-slot');
      if (!targets.length) reasons.push('no-targets');
      if (slot) {
        if (slot.state !== 'idle') reasons.push(slot.state);
        if (
          device.runtimeSeenAt === undefined ||
          this.now() - device.runtimeSeenAt >= 30000
        )
          reasons.push('runtime-missing');
        else if (runtime?.runtime_device_id !== device.nativeId)
          reasons.push('runtime-mismatch');
      }
      device.ready = reasons.length === 0;
      return device;
    });
  }
  getDevice(id: string): ManagedDevice {
    const device = this.listDevices().find((d) => d.id === id);
    if (!device) throw new CloudError(404, 'Device not found');
    return device;
  }
  updateDevice(id: string, input: unknown, actor: string): ManagedDevice {
    const settings = deviceSettingsSchema.parse(input);
    return this.transaction(() => {
      const device = this.getDevice(id);
      if (settings.managed && !settings.slotId)
        settings.slotId = device.settings.slotId ?? `device-${device.id}`;
      if (
        settings.targets.some((id) => !this.targets().some((t) => t.id === id))
      )
        throw new CloudError(400, 'Unknown device target');
      if (!settings.managed && settings.slotId)
        throw new CloudError(400, 'Unmanaged device cannot have a slot');
      const old = device.slot;
      const bindingChanged =
        device.settings.slotId !== settings.slotId ||
        device.settings.managed !== settings.managed ||
        JSON.stringify(device.settings.targets) !==
          JSON.stringify(settings.targets);
      if (old && old.state !== 'idle' && bindingChanged)
        throw new CloudError(
          409,
          'Cannot reconfigure an occupied or quarantined slot',
        );
      if (settings.slotId) {
        const occupied = this.db
          .prepare(
            'SELECT registry_id,state FROM slots WHERE worker_id=? AND id=?',
          )
          .get(device.workerId, settings.slotId) as Row | undefined;
        if (occupied && settings.slotId !== old?.id) {
          if (occupied.state !== 'idle')
            throw new CloudError(
              409,
              'Cannot reconfigure an occupied or quarantined slot',
            );
          if (occupied.registry_id)
            throw new CloudError(
              409,
              'Slot already configured; choose a different slot ID',
            );
        }
      }
      if (old && old.id !== settings.slotId)
        this.db
          .prepare('DELETE FROM slots WHERE worker_id=? AND id=?')
          .run(device.workerId, old.id);
      if (settings.slotId)
        this.db
          .prepare(
            "INSERT INTO slots(worker_id,id,device_id,targets,registry_id) VALUES(?,?,?,?,?) ON CONFLICT(worker_id,id) DO UPDATE SET targets=excluded.targets,registry_id=excluded.registry_id,device_id=CASE WHEN slots.state='idle' THEN excluded.device_id ELSE slots.device_id END",
          )
          .run(
            device.workerId,
            settings.slotId,
            device.nativeId,
            JSON.stringify(settings.targets),
            id,
          );
      this.db
        .prepare('UPDATE managed_devices SET settings=? WHERE id=?')
        .run(JSON.stringify(settings), id);
      this.event(null, 'device-updated', { actor, deviceId: id, settings });
      return this.getDevice(id);
    });
  }
  /** Host supervisors receive only their own explicitly managed device assignments. */
  workerAssignments(workerId: string) {
    const worker = this.listWorkers().find(item => item.id === workerId);
    if (!worker) throw new CloudError(403, 'Unknown worker');
    for (const device of this.listDevices().filter(item => item.workerId === workerId && item.settings.managed && !item.settings.slotId))
      this.updateDevice(device.id, device.settings, `worker:${workerId}`);
    return {
      workerId,
      devices: this.listDevices().filter(device => device.workerId === workerId &&
        device.settings.managed && device.settings.enabled && device.slot &&
        (device.slot.targets.length > 0 || device.slot.state === 'busy') &&
        device.present && !device.stale && device.slot.state !== 'quarantined'),
    };
  }
  listWorkers(): Array<Omit<WorkerStatus, 'catalogScannerConnected' | 'projectIds' | 'activeCatalogScan'>> {
    return (
      this.db.prepare('SELECT * FROM workers ORDER BY id').all() as Row[]
    ).map((r) => {
      const slots = (
        this.db
          .prepare('SELECT id FROM slots WHERE worker_id=? ORDER BY id')
          .all(String(r.id)) as Row[]
      ).map((s) => this.slot(String(r.id), String(s.id))!);
      const seenAt = Number(r.seen_at);
      const health: ExecutionWorker['health'] = slots.some(
        (s) => s.state === 'quarantined',
      )
        ? 'quarantined'
        : seenAt === 0
          ? 'unseen'
          : this.now() - seenAt >= 30000
            ? 'offline'
            : 'healthy';
      const snapshot = this.db
        .prepare(
          'SELECT received_at,data FROM device_inventories WHERE worker_id=?',
        )
        .get(String(r.id)) as Row | undefined;
      const inventory = snapshot
        ? {
            ...deviceInventorySchema.parse(JSON.parse(String(snapshot.data))),
            receivedAt: Number(snapshot.received_at),
            stale: this.now() - Number(snapshot.received_at) >= 90000,
          }
        : undefined;
      return {
        id: String(r.id),
        paused: !!r.paused,
        seenAt,
        health,
        slots,
        inventory,
        service: this.workerDiagnostics.summary(String(r.id)),
      };
    });
  }
  pauseWorker(workerId: string, paused: boolean, actor: string) {
    this.transaction(() => {
      if (!this.listWorkers().some((w) => w.id === workerId))
        throw new CloudError(404, 'Worker not found');
      this.db
        .prepare('UPDATE workers SET paused=? WHERE id=?')
        .run(paused ? 1 : 0, workerId);
      this.event(null, 'worker-paused', { workerId, paused, actor });
    });
  }
  claim(
    workerId: string,
    slotId: string,
    runtimeDeviceId: string,
    supportsSecureFiles = false,
  ): ExecutionLease | null {
    return this.transaction(() => {
      this.expireInside();
      const slot = this.slot(workerId, slotId)!;
      this.db
        .prepare('UPDATE workers SET seen_at=? WHERE id=?')
        .run(this.now(), workerId);
      this.db
        .prepare(
          'UPDATE slots SET runtime_device_id=?,runtime_seen_at=? WHERE worker_id=? AND id=?',
        )
        .run(runtimeDeviceId, this.now(), workerId, slotId);
      const device = this.listDevices().find(
        (d) => d.workerId === workerId && d.settings.slotId === slotId,
      );
      if (!device?.ready || runtimeDeviceId !== device.nativeId) return null;
      this.db
        .prepare('UPDATE slots SET device_id=? WHERE worker_id=? AND id=?')
        .run(runtimeDeviceId, workerId, slotId);
      const occupiedCatalogs = new Set(this.db.prepare(`
        SELECT json_extract(requests.data,'$.catalogId') AS id
        FROM slots JOIN attempts ON attempts.id=slots.attempt_id JOIN requests ON requests.id=attempts.request_id
        WHERE slots.worker_id=? AND slots.state IN ('busy','quarantined')
      `).all(workerId).map(row => row.id));
      const scanOwner = this.db.prepare("SELECT json_extract(data,'$.workerId') AS worker_id FROM catalog_scans WHERE scan_id=? AND status='ready'");
      const req = this.queue().find(r => {
        if (!device.slot?.targets.includes(r.input.targetId) || (!supportsSecureFiles && r.secureFiles?.length)) return false;
        return !r.catalogId || (!occupiedCatalogs.has(r.catalogId) && scanOwner.get(r.catalogId)?.worker_id === workerId);
      });
      if (!req) return null;
      req.state = 'assigned';
      req.attempts++;
      this.saveRequest(req);
      const attempt: ExecutionAttempt = {
        assignedAt: this.now(),
        deviceId: runtimeDeviceId,
        workerId,
        slotId,
        attemptId: identifier(),
        generation: slot.generation + 1,
        requestId: req.id,
        number: req.attempts,
        stage: 'assigned',
        expiresAt: this.now() + 30000,
      };
      this.saveAttempt(attempt);
      this.db
        .prepare(
          "UPDATE slots SET state='busy',generation=?,attempt_id=? WHERE worker_id=? AND id=?",
        )
        .run(attempt.generation, attempt.attemptId, workerId, slotId);
      this.event(req.id, 'assigned', {
        attemptId: attempt.attemptId,
        workerId,
        slotId,
        generation: attempt.generation,
      });
      return { ...attempt, request: req, deviceId: runtimeDeviceId };
    });
  }
  owned(key: LeaseKey): ExecutionAttempt {
    const slot = this.slot(key.workerId, key.slotId)!;
    const a = this.attempt(key.attemptId);
    if (
      slot.state !== 'busy' ||
      slot.attemptId !== key.attemptId ||
      slot.generation !== key.generation ||
      a.workerId !== key.workerId ||
      a.slotId !== key.slotId ||
      a.generation !== key.generation ||
      a.expiresAt <= this.now() ||
      a.finishedAt !== undefined
    )
      throw new CloudError(409, 'Execution lease no longer owned');
    return a;
  }
  heartbeat(key: LeaseKey, stage: string, log?: string, timelineClock?: WorkerTimelineClock) {
    return this.transaction(() => {
      const a = this.owned(key);
      this.workerTimelines.clock(a, timelineClock);
      a.expiresAt = this.now() + 30000;
      const req = this.getRequest(a.requestId);
      const next: RequestState =
        stage === 'assigned'
          ? 'assigned'
          : stage === 'running'
            ? 'running'
            : stage === 'finalizing'
              ? 'finalizing'
              : 'preparing';
      if (req.state !== 'cancel_requested') {
        req.state = next;
        this.saveRequest(req);
      }
      if (stage !== a.stage)
        this.event(req.id, 'stage', { attemptId: a.attemptId, stage });
      if (log)
        this.event(req.id, 'log', {
          attemptId: a.attemptId,
          text: log.slice(0, 4000),
          ...(timelineClock ? { offsetMs: timelineClock.offsetMs } : {}),
        });
      a.stage = stage;
      this.saveAttempt(a);
      this.db
        .prepare('UPDATE workers SET seen_at=? WHERE id=?')
        .run(this.now(), key.workerId);
      this.db
        .prepare(
          'UPDATE slots SET runtime_seen_at=? WHERE worker_id=? AND id=?',
        )
        .run(this.now(), key.workerId, key.slotId);
      return {
        cancelRequested: req.state === 'cancel_requested',
        expiresAt: a.expiresAt,
      };
    });
  }
  cancel(requestId: string, actor: string) {
    return this.transaction(() => {
      const req = this.getRequest(requestId);
      if (terminalStates.includes(req.state)) return req;
      req.state = req.state === 'queued' ? 'cancelled' : 'cancel_requested';
      this.saveRequest(req);
      this.event(req.id, 'cancelled-requested', { actor, state: req.state });
      return req;
    });
  }
  recordResult(key: LeaseKey, value: unknown) {
    const result = resultSchema.parse(value);
    return this.transaction(() => {
      const attempt = this.owned(key),
        request = this.getRequest(attempt.requestId);
      if (
        attempt.result &&
        JSON.stringify(attempt.result) !== JSON.stringify(result)
      )
        throw new CloudError(409, 'Test result conflict');
      attempt.result = result;
      this.saveAttempt(attempt);
      request.verdict = result.verdict;
      this.saveRequest(request);
      this.event(request.id, 'test-result', {
        attemptId: attempt.attemptId,
        ...result,
      });
      return { recorded: true };
    });
  }
  finish(key: LeaseKey, value: Outcome, timeline?: WorkerTimelineFinish) {
    const outcome = outcomeSchema.parse(value);
    return this.transaction(() => {
      const previous = this.attempt(key.attemptId);
      if (
        previous.finishedAt !== undefined &&
        previous.workerId === key.workerId &&
        previous.slotId === key.slotId &&
        previous.generation === key.generation
      ) {
        if (JSON.stringify(previous.outcome) !== JSON.stringify(outcome))
          throw new CloudError(409, 'Completion conflict');
        return this.getRequest(previous.requestId);
      }
      const a = this.owned(key);
      const req = this.getRequest(a.requestId);
      if (outcome.publication === 'published' && !a.bundleId)
        throw new CloudError(409, 'No committed report');
      a.outcome = outcome;
      a.finishedAt = this.now();
      a.stage = 'finished';
      this.workerTimelines.finalize(a, timeline);
      this.saveAttempt(a);
      req.verdict = outcome.verdict;
      req.state =
        req.state === 'cancel_requested'
          ? 'cancelled'
          : outcome.infrastructure
            ? 'infrastructure_failed'
            : 'completed';
      if (
        req.state === 'infrastructure_failed' &&
        outcome.infrastructure === 'transient' &&
        outcome.cleanup === 'clean' &&
        req.attempts < 2
      ) {
        req.state = 'queued';
        req.queuedAt = this.now();
      }
      this.saveRequest(req);
      this.db
        .prepare(
          'UPDATE slots SET state=?,attempt_id=? WHERE worker_id=? AND id=?',
        )
        .run(
          outcome.cleanup === 'clean' ? 'idle' : 'quarantined',
          outcome.cleanup === 'failed' && req.catalogId ? a.attemptId : null,
          key.workerId,
          key.slotId,
        );
      this.event(req.id, 'finished', {
        attemptId: a.attemptId,
        state: req.state,
        ...outcome,
      });
      return req;
    });
  }
  expireLeases() {
    this.transaction(() => this.expireInside());
  }
  private expireInside() {
    for (const worker of this.listWorkers())
      for (const slot of worker.slots)
        if (slot.state === 'busy' && slot.attemptId) {
          const a = this.attempt(slot.attemptId);
          if (a.expiresAt > this.now()) continue;
          a.finishedAt = this.now();
          a.stage = 'lost';
          this.workerTimelines.finalize(a, undefined, true);
          a.outcome = {
            verdict: this.getRequest(a.requestId).verdict,
            cleanup: 'failed',
            publication: a.bundleId ? 'published' : 'unavailable',
            infrastructure: 'permanent',
            error: 'Worker lease expired; device requires verified recovery',
          };
          this.saveAttempt(a);
          const req = this.getRequest(a.requestId);
          req.state = 'infrastructure_failed';
          this.saveRequest(req);
          this.db
            .prepare(
              "UPDATE slots SET state='quarantined',generation=generation+1 WHERE worker_id=? AND id=?",
            )
            .run(worker.id, slot.id);
          this.event(req.id, 'lease-lost', { attemptId: a.attemptId });
        }
  }
  recoverSlot(workerId: string, slotId: string, evidence: string) {
    this.transaction(() => {
      const slot = this.slot(workerId, slotId)!;
      if (slot.state === 'busy')
        throw new CloudError(409, 'Active execution cannot be recovered');
      if (!evidence.trim())
        throw new CloudError(400, 'Recovery evidence required');
      this.db
        .prepare(
          "UPDATE slots SET state='idle',generation=generation+1,attempt_id=NULL WHERE worker_id=? AND id=?",
        )
        .run(workerId, slotId);
      this.event(null, 'slot-recovered', {
        workerId,
        slotId,
        evidence: evidence.slice(0, 1000),
      });
    });
  }
  event(requestId: string | null, kind: string, data: unknown) {
    this.db
      .prepare('INSERT INTO events(request_id,kind,at,data) VALUES(?,?,?,?)')
      .run(requestId, kind, this.now(), JSON.stringify(data));
    if (['submitted', 'manual-rerun', 'finished', 'cancelled-requested', 'catalog-scan-queued', 'device-updated', 'worker-paused', 'slot-recovered', 'project-workers-updated'].includes(kind))
      this.controlChanged(requestId, kind);
  }
  events(requestId: string | null, after: number, limit = 200) {
    return (
      this.db
        .prepare(
          `SELECT * FROM events WHERE ${requestId === null ? 'request_id IS NULL' : 'request_id=?'} AND seq>? ORDER BY seq LIMIT ?`,
        )
        .all(...(requestId === null ? [] : [requestId]), after, limit) as Row[]
    ).map((r) => ({
      seq: Number(r.seq),
      at: Number(r.at),
      kind: String(r.kind),
      data: JSON.parse(String(r.data)),
    }));
  }
}
