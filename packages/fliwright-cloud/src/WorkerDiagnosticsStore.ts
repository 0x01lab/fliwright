import { CloudError, redactDiagnostic, workerServiceReportSchema, type WorkerDiagnosticsView } from '@fliwright/cloud-protocol';
import type { CloudStore } from './CloudStore.js';

/** Service sessions and bounded diagnostic logs survive failures before a test has started. */
export class WorkerDiagnosticsStore {
  constructor(private readonly store: CloudStore) {
    store.db.exec(`
      CREATE TABLE IF NOT EXISTS worker_service_sessions(worker_id TEXT NOT NULL REFERENCES workers(id), session_id TEXT NOT NULL, received_at INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(worker_id,session_id));
      CREATE TABLE IF NOT EXISTS worker_service_logs(id INTEGER PRIMARY KEY AUTOINCREMENT, worker_id TEXT NOT NULL REFERENCES workers(id), session_id TEXT NOT NULL, seq INTEGER NOT NULL, received_at INTEGER NOT NULL, data TEXT NOT NULL, UNIQUE(worker_id,session_id,seq));
      CREATE INDEX IF NOT EXISTS worker_service_log_lookup ON worker_service_logs(worker_id,id);
    `);
  }
  summary(workerId: string) {
    const rows = this.store.db.prepare('SELECT received_at,data FROM worker_service_sessions WHERE worker_id=? ORDER BY received_at DESC LIMIT 50').all(workerId);
    if (!rows.length) return undefined;
    const sessions = rows.map(row => ({ ...JSON.parse(String(row.data)), receivedAt: Number(row.received_at) }));
    const active = sessions.filter(session => ['healthy', 'degraded'].includes(session.state) && this.store.now() - session.receivedAt <= 35000);
    const selected = active.find(session => session.state === 'degraded') ?? active[0] ?? sessions[0];
    const status = active.length > 1 ? 'degraded' : ['failed', 'stopped'].includes(selected.state) ? selected.state : this.store.now() - selected.receivedAt > 35000 ? 'unreachable' : selected.state;
    return { status, receivedAt: selected.receivedAt, sessionId: selected.sessionId, activeSessions: active.length } as NonNullable<import('@fliwright/cloud-protocol').ExecutionWorker['service']>;
  }
  sweep() {
    this.store.db.prepare('DELETE FROM worker_service_logs WHERE received_at<?').run(this.store.now() - 7 * 86400000);
  }
  record(workerId: string, input: unknown, secrets: string[] = []) {
    const report = workerServiceReportSchema.parse(input), now = this.store.now();
    const { logs, ...session } = report;
    this.store.transaction(() => {
      if (!this.store.db.prepare('SELECT id FROM workers WHERE id=?').get(workerId)) throw new CloudError(404, 'Worker not found');
      this.store.db.prepare(`INSERT INTO worker_service_sessions VALUES(?,?,?,?) ON CONFLICT(worker_id,session_id) DO UPDATE SET received_at=excluded.received_at,data=excluded.data
        WHERE json_extract(excluded.data,'$.uptimeMs')>=json_extract(worker_service_sessions.data,'$.uptimeMs')`)
        .run(workerId, report.sessionId, now, JSON.stringify(session));
      const insert = this.store.db.prepare('INSERT OR IGNORE INTO worker_service_logs(worker_id,session_id,seq,received_at,data) VALUES(?,?,?,?,?)');
      for (const log of logs) {
        insert.run(workerId, log.sessionId, log.seq, now, JSON.stringify({ ...log,
          message: redactDiagnostic(log.message, secrets), ...(log.stack ? { stack: redactDiagnostic(log.stack, secrets) } : {}) }));
        // Fatal exits cannot wait for an upload; a later process replays their retained logs.
        if (log.level === 'fatal') this.store.db.prepare("UPDATE worker_service_sessions SET data=json_set(data,'$.state','failed') WHERE worker_id=? AND session_id=?").run(workerId, log.sessionId);
      }
      this.store.db.prepare('DELETE FROM worker_service_logs WHERE worker_id=? AND (received_at<? OR id NOT IN (SELECT id FROM worker_service_logs WHERE worker_id=? ORDER BY id DESC LIMIT 2000))')
        .run(workerId, now - 7 * 86400000, workerId);
      this.store.db.prepare('DELETE FROM worker_service_sessions WHERE worker_id=? AND session_id NOT IN (SELECT session_id FROM worker_service_sessions WHERE worker_id=? ORDER BY received_at DESC LIMIT 50)').run(workerId, workerId);
    });
    return { accepted: true };
  }
  view(workerId: string, query: { before?: number; level?: string; sessionId?: string; search?: string } = {}): WorkerDiagnosticsView {
    if (!this.store.db.prepare('SELECT id FROM workers WHERE id=?').get(workerId)) throw new CloudError(404, 'Worker not found');
    const sessions = this.store.db.prepare('SELECT received_at,data FROM worker_service_sessions WHERE worker_id=? ORDER BY received_at DESC LIMIT 10').all(workerId).map(row => {
      const session = JSON.parse(String(row.data)) as WorkerDiagnosticsView['sessions'][number];
      const receivedAt = Number(row.received_at);
      return { ...session, receivedAt, status: (['failed', 'stopped'].includes(session.state) ? session.state : this.store.now() - receivedAt > 35000 ? 'unreachable' : session.state) as WorkerDiagnosticsView['sessions'][number]['status'] };
    });
    const rows = this.store.db.prepare(`SELECT id,received_at,data FROM worker_service_logs WHERE worker_id=? AND id<?
      AND (? IS NULL OR json_extract(data,'$.level')=?) AND (? IS NULL OR session_id=?)
      AND (? IS NULL OR instr(lower(data),lower(?))>0) ORDER BY id DESC LIMIT 100`)
      .all(workerId, query.before ?? Number.MAX_SAFE_INTEGER, query.level ?? null, query.level ?? null, query.sessionId ?? null, query.sessionId ?? null, query.search ?? null, query.search ?? null);
    const logs = rows.map(row => ({ ...JSON.parse(String(row.data)), id: Number(row.id), receivedAt: Number(row.received_at) })) as WorkerDiagnosticsView['logs'];
    return { sessions, logs, nextCursor: logs.at(-1)?.id ?? 0 };
  }
}
