import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  CloudError,
  submissionSchema,
  targetSchema,
  workerSchema,
  outcomeSchema,
  resultSchema,
  deviceInventorySchema,
  deviceSettingsSchema,
  type ManagedDevice,
  type DeviceSettings,
  type ApplicationTarget,
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
} from '@fliwright/cloud-protocol';

type Row = Record<string, unknown>;
export const digest = (value: string | Buffer) =>
  createHash('sha256').update(value).digest('hex');
export const identifier = () => randomUUID();
export const terminalStates = [
  'completed',
  'cancelled',
  'infrastructure_failed',
];
export class CloudStore {
  readonly db: DatabaseSync;
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
      if (version > 3) throw new Error('Unsupported cloud database version');
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS targets(id TEXT PRIMARY KEY, data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS workers(id TEXT PRIMARY KEY, paused INTEGER NOT NULL DEFAULT 0, seen_at INTEGER NOT NULL DEFAULT 0);
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
        PRAGMA user_version=3;
      `);
    });
  }
  close() {
    this.db.close();
  }
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  configure(targets: unknown[], workers: unknown[]) {
    this.transaction(() => {
      const parsed = targets.map((t) => targetSchema.parse(t));
      for (const target of parsed)
        this.db
          .prepare('INSERT OR IGNORE INTO targets VALUES(?,?)')
          .run(target.id, JSON.stringify(target));
      const registered = workers.map((w) => workerSchema.parse(w));
      for (const worker of registered) {
        const inserted = this.db
          .prepare('INSERT OR IGNORE INTO workers(id) VALUES(?)')
          .run(worker.id);
        if (!inserted.changes) continue;
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
        }
      }
    });
  }

  targets(): ApplicationTarget[] {
    return (
      this.db.prepare('SELECT data FROM targets ORDER BY id').all() as Row[]
    ).map((r) => JSON.parse(String(r.data)));
  }
  submit(value: Submission, actor: string, key: string): TestRequest {
    const input = submissionSchema.parse(value);
    if (!key || key.length > 200)
      throw new CloudError(
        400,
        'Idempotency-Key required (max 200 characters)',
      );
    const fingerprint = digest(JSON.stringify(input));
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
        !Object.hasOwn(target.suites, input.suite) ||
        !target.scenarios.includes(input.scenario)
      )
        throw new CloudError(
          400,
          'Unknown registered target, suite or scenario',
        );
      const req: TestRequest = {
        id: identifier(),
        input,
        target,
        actor,
        createdAt: this.now(),
        queuedAt: this.now(),
        state: 'queued',
        verdict: 'unknown',
        attempts: 0,
      };
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
  listRequests(
    options: {
      state?: string;
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
    });
  }
  listDevices(): ManagedDevice[] {
    const workers = this.listWorkers();
    return (
      this.db
        .prepare('SELECT * FROM managed_devices ORDER BY worker_id,id')
        .all() as Row[]
    ).map((row) => {
      const settings = deviceSettingsSchema.parse(
        JSON.parse(String(row.settings)),
      );
      const worker = workers.find((w) => w.id === row.worker_id)!;
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
        slot,
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
      if (
        !settings.targets.some((id) => this.targets().some((t) => t.id === id))
      )
        reasons.push('no-targets');
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
  listWorkers(): ExecutionWorker[] {
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
      const req = this.queue().find(
        (r) =>
          device.settings.targets.includes(r.input.targetId) &&
          this.targets().some((t) => t.id === r.input.targetId),
      );
      if (!req) return null;
      req.state = 'assigned';
      req.attempts++;
      this.saveRequest(req);
      const attempt: ExecutionAttempt = {
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
  heartbeat(key: LeaseKey, stage: string, log?: string) {
    return this.transaction(() => {
      const a = this.owned(key);
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
  finish(key: LeaseKey, value: Outcome) {
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
          'UPDATE slots SET state=?,attempt_id=NULL WHERE worker_id=? AND id=?',
        )
        .run(
          outcome.cleanup === 'clean' ? 'idle' : 'quarantined',
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
