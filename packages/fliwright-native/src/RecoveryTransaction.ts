import { createHash, randomUUID } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import { lstat, mkdir, open, readdir, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { NativeError } from '@fliwright/core';
import { inspectNativeToolProcess, isNativeToolRecord } from './NativeToolOwnership.js';

interface Owner { token: string; pid: number; createdAt: string; }
export interface RecoveryTransactionBinding { deviceKey: string; fingerprint: string; originalDigest: string; }
type Phase = 'claimed' | 'restoring' | 'shutdown-pending' | 'readback-completed' | 'archiving' | 'archived' | 'retired';
export interface RecoveryAction {
  id: string;
  intent: string;
  state: 'pending' | 'verified';
  observation?: string;
}
interface Checkpoint extends RecoveryTransactionBinding {
  schemaVersion: 1;
  transactionId: string;
  sequence: number;
  previousDigest: string | null;
  owner: Owner;
  kind: 'claim' | 'checkpoint' | 'release';
  phase: Phase;
  shutdownPending: boolean;
  completionBoot: string | null;
  action?: RecoveryAction;
}
interface Log { records: Checkpoint[]; actionIds: Set<string>; actions: Map<string, RecoveryAction>; digest: string; identity: string; evidenceIdentity: string; owner?: Owner; toolState: 'absent' | 'live' | 'exited' | 'invalid'; }
type Boundary = (name: string) => Promise<void>;
export interface RecoveryTransactionInspection {
  valid: boolean;
  state: 'absent' | 'live' | 'exited' | 'invalid';
  identity: string;
  /** Internal only; the public lease inspection never exposes this credential. */
  owner?: Owner;
  checkpoint?: Readonly<Checkpoint>;
}

/** Recognize only this append-only transaction, not old generic reservations. */
export async function inspectRecoveryTransaction(path: string): Promise<RecoveryTransactionInspection> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const log = await readLog(path);
      const last = log.records.at(-1);
      return { valid: true, state: log.owner ? (last?.kind !== 'release' && alive(log.owner.pid)) || log.toolState === 'live' ? 'live'
        : log.toolState === 'invalid' ? 'invalid' : 'exited' : 'absent', identity: log.evidenceIdentity, owner: log.owner, checkpoint: last };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'device_busy' || attempt === 3) return { valid: false, state: 'invalid', identity: 'invalid' };
    }
  }
  return { valid: false, state: 'invalid', identity: 'invalid' };
}

/** Internal durable exclusion. Each published step is a nonempty immutable directory.
 * A new claimant appends an epoch; it never deletes a crashed claimant or replays a write.
 * Pending directories are inert: no platform command can run before publication and fsync.
 */
export class RecoveryTransaction {
  private constructor(readonly path: string, private record: Checkpoint, private logIdentity: string, private readonly boundary?: Boundary) {}
  get current(): Readonly<Checkpoint> { return structuredClone(this.record); }
  get toolPath(): string { return join(this.path, stepName(this.record.sequence), 'tool-recovery.json'); }
  get operationToken(): string { return this.record.owner.token; }
  async verifiedActions(): Promise<ReadonlySet<string>> {
    await this.assertOwned();
    const log = await readLog(this.path);
    return new Set([...log.actions].filter(([, action]) => action.state === 'verified').map(([id]) => id));
  }

  static async claim(path: string, binding: RecoveryTransactionBinding, boundary?: Boundary): Promise<RecoveryTransaction> {
    if (!Object.values(binding).every(hash)) throw failure();
    try { await mkdir(path, { mode: 0o700 }); await boundary?.('reservation-directory-created'); await syncDirectory(dirname(path)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw failure(); }
    await boundary?.('reservation-created');
    const log = await readLog(path);
    if (log.owner && ((log.records.at(-1)?.kind !== 'release' && alive(log.owner.pid)) || log.toolState === 'live')) throw busy();
    if (log.toolState === 'invalid') throw failure();
    const last = log.records.at(-1);
    if (last && Object.entries(binding).some(([key, value]) => last[key as keyof RecoveryTransactionBinding] !== value)) throw failure();
    const owner = { token: randomUUID(), pid: process.pid, createdAt: new Date().toISOString() };
    const record: Checkpoint = last ? { ...last, owner, sequence: last.sequence + 1, previousDigest: log.digest, kind: 'claim' }
      : { schemaVersion: 1, ...binding, transactionId: randomUUID(), sequence: 0, previousDigest: null, owner,
        kind: 'claim', phase: 'claimed', shutdownPending: false, completionBoot: null };
    await publish(path, record, log.identity, boundary);
    const current = await readLog(path);
    if (current.owner?.token !== owner.token) throw busy();
    return new RecoveryTransaction(path, record, current.identity, boundary);
  }

  async assertOwned(): Promise<void> {
    if (this.record.kind === 'release') throw failure();
    const log = await readLog(this.path);
    // The active owner's tool record may change while an owned tool runs; chain identity cannot.
    if (log.owner?.token !== this.record.owner.token || log.identity !== this.logIdentity || log.toolState === 'invalid') throw failure();
  }

  async checkpoint(phase: Exclude<Phase, 'claimed'>, completionBoot?: string): Promise<void> {
    await this.assertOwned();
    const record = { ...this.record, sequence: this.record.sequence + 1, kind: 'checkpoint' as const,
      previousDigest: digest(JSON.stringify(this.record)), phase,
      shutdownPending: this.record.shutdownPending || phase === 'shutdown-pending',
      completionBoot: completionBoot ?? this.record.completionBoot };
    if (!transition(this.record, record)) throw failure();
    await publish(this.path, record, this.logIdentity, this.boundary);
    const log = await readLog(this.path);
    this.record = record; this.logIdentity = log.identity;
    await this.assertOwned();
  }

  /** Persist an intent before dispatch; only independent observation can complete it. */
  async checkpointAction(action: RecoveryAction): Promise<void> {
    action = structuredClone(action);
    if (!validAction(action)) throw failure();
    await this.assertOwned();
    if (action.state === 'pending' && (await readLog(this.path)).actionIds.has(action.id)) throw failure();
    const record: Checkpoint = { ...this.record, sequence: this.record.sequence + 1, kind: 'checkpoint',
      previousDigest: digest(JSON.stringify(this.record)), phase: 'restoring', action };
    if (!transition(this.record, record)) throw failure();
    await publish(this.path, record, this.logIdentity, this.boundary);
    this.record = record; this.logIdentity = (await readLog(this.path)).identity;
    await this.assertOwned();
  }

  /** Finish this owner's epoch only after all actual work has settled. Original exclusion remains. */
  async suspend(): Promise<void> {
    await this.assertOwned();
    const log = await readLog(this.path);
    if (log.toolState === 'live' || log.toolState === 'invalid') throw failure();
    const record = { ...this.record, sequence: this.record.sequence + 1, kind: 'release' as const, previousDigest: log.digest };
    await publish(this.path, record, this.logIdentity, this.boundary);
    this.record = record; this.logIdentity = (await readLog(this.path)).identity;
  }

  /** Caller must have independently verified and archived every resource before this step. */
  async retire(): Promise<string> {
    if (this.record.phase !== 'archived' && this.record.phase !== 'retired') throw failure();
    if (this.record.phase !== 'retired') await this.checkpoint('retired');
    await this.assertOwned();
    const archive = `${this.path}.archive-${this.record.transactionId}`;
    // One atomic rename removes exclusion last and preserves the complete private history.
    // An existing nonempty archive is never overwritten.
    await rename(this.path, archive);
    await this.boundary?.('retirement-renamed');
    await syncDirectory(dirname(this.path));
    await this.boundary?.('retirement-synced');
    return archive;
  }
}

async function publish(path: string, record: Checkpoint, expected: string, boundary?: Boundary): Promise<void> {
  if ((await readLog(path)).identity !== expected) throw busy();
  const pending = join(path, `.pending-${randomUUID()}`);
  await mkdir(pending, { mode: 0o700 });
  await boundary?.('pending-created');
  const file = await open(join(pending, 'record.json'), 'wx', 0o600);
  try { await file.writeFile(JSON.stringify(record)); await boundary?.('record-written'); await file.sync(); await boundary?.('record-synced'); } finally { await file.close(); }
  await syncDirectory(pending);
  await boundary?.('pending-synced');
  // A crash before publication leaves an inert candidate, never an authoritative owner.
  if ((await readLog(path)).identity !== expected) throw busy();
  try { await rename(pending, join(path, stepName(record.sequence))); }
  catch (error) {
    if (['EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw busy();
    throw failure();
  }
  await boundary?.('step-renamed');
  await syncDirectory(path);
  await boundary?.('step-synced');
}

async function readLog(path: string): Promise<Log> {
  const directory = await directoryIdentity(path), names = (await readdir(path)).sort();
  if (names.length > 256 || names.some(name => !/^step-\d{6}$/.test(name) && !/^\.pending-[a-f0-9-]{36}$/.test(name)
    && !['original.lock', 'original.dirty'].includes(name))) throw failure();
  const steps = names.filter(name => name.startsWith('step-'));
  const records: Checkpoint[] = [], identities: string[] = [], toolIdentities: string[] = [];
  for (const name of names.filter(name => name.startsWith('.pending-'))) {
    try {
      const pending = join(path, name); await directoryIdentity(pending);
      if ((await readdir(pending)).some(entry => entry !== 'record.json')) throw failure();
      try {
        const info = await lstat(join(pending, 'record.json'));
        if (!info.isFile() || info.nlink !== 1 || info.size > 32768) throw failure();
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw busy();
      throw error;
    }
  }
  let previous: Checkpoint | undefined, previousDigest: string | null = null;
  const actionIds = new Set<string>();
  const actions = new Map<string, RecoveryAction>();
  let toolState: Log['toolState'] = 'absent';
  for (let index = 0; index < steps.length; index++) {
    if (steps[index] !== stepName(index)) throw failure();
    const step = join(path, steps[index]), identity = await directoryIdentity(step), entries = (await readdir(step)).sort();
    if (entries.some(name => !['record.json', 'tool-recovery.json'].includes(name) && !/^tool-recovery\.json\.[a-f0-9-]{36}$/.test(name))) throw failure();
    const saved = await readPrivateRecord(join(step, 'record.json')), record = decode(saved.value);
    if (record.sequence !== index || record.previousDigest !== previousDigest || !transition(previous, record)) throw failure();
    if (record.kind === 'checkpoint' && record.action?.state === 'pending' && record.phase === 'restoring') {
      if (actionIds.has(record.action.id)) throw failure();
      actionIds.add(record.action.id);
    }
    if (record.kind === 'checkpoint' && record.action && record.phase === 'restoring') {
      const previousAction = actions.get(record.action.id);
      if (record.action.state === 'verified' && (!previousAction || previousAction.state !== 'pending'
        || previousAction.intent !== record.action.intent)) throw failure();
      if (record.action.state === 'pending' && previousAction) throw failure();
      actions.set(record.action.id, record.action);
    }
    if (entries.includes('tool-recovery.json')) {
      const toolEvidence = await readPrivateRecord(join(step, 'tool-recovery.json')), tool = toolEvidence.value;
      toolIdentities.push(toolEvidence.identity);
      if (!isNativeToolRecord(tool) || tool.operationToken !== record.owner.token || tool.ownerPid !== record.owner.pid) throw failure();
      const state = tool.phase === 'reserved' ? alive(record.owner.pid) ? 'live' : 'invalid' : await inspectNativeToolProcess(tool);
      if (state === 'invalid') toolState = 'invalid';
      else if (state === 'live' && toolState !== 'invalid') toolState = 'live';
      else if (toolState === 'absent') toolState = 'exited';
      if (index < steps.length - 1 && state !== 'exited') throw failure();
    }
    if (await directoryIdentity(step) !== identity) throw failure();
    identities.push(identity, saved.identity); records.push(record); previous = record; previousDigest = digest(saved.bytes);
  }
  if (await directoryIdentity(path) !== directory || JSON.stringify((await readdir(path)).filter(name => name.startsWith('step-')).sort()) !== JSON.stringify(steps)) throw busy();
  if (names.some(name => name.startsWith('original.')) && !['archiving', 'archived', 'retired'].includes(previous?.phase ?? '')) throw failure();
  const identity = digest(JSON.stringify([directory, identities]));
  const archivedIdentities: string[] = [];
  const archiveIdentity = async (entry: string, depth = 0): Promise<void> => {
    if (depth > 4 || archivedIdentities.length > 64) throw failure();
    const info = await lstat(entry);
    if (info.isDirectory() && !info.isSymbolicLink()) {
      const entries = (await readdir(entry)).sort();
      archivedIdentities.push(await directoryIdentity(entry), JSON.stringify(entries));
      for (const child of entries) await archiveIdentity(join(entry, child), depth + 1);
    } else archivedIdentities.push((await readPrivateRecord(entry)).identity);
  };
  for (const name of names.filter(name => name.startsWith('original.'))) await archiveIdentity(join(path, name));
  return { records, actionIds, actions, digest: previousDigest ?? '', identity,
    evidenceIdentity: digest(JSON.stringify([identity, names, toolIdentities, toolState, archivedIdentities])), owner: previous?.owner, toolState };
}

function decode(value: Record<string, unknown>): Checkpoint {
  const keys = ['schemaVersion', 'deviceKey', 'fingerprint', 'originalDigest', 'transactionId', 'sequence', 'previousDigest', 'owner', 'kind', 'phase', 'shutdownPending', 'completionBoot', ...(Object.hasOwn(value, 'action') ? ['action'] : [])];
  const owner = value.owner as Owner | undefined;
  if (Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))
    || value.schemaVersion !== 1 || ![value.deviceKey, value.fingerprint, value.originalDigest].every(hash)
    || !uuid(value.transactionId) || !Number.isSafeInteger(value.sequence) || (value.sequence as number) < 0
    || value.previousDigest !== null && !hash(value.previousDigest)
    || !owner || Object.keys(owner).sort().join(',') !== 'createdAt,pid,token' || !uuid(owner.token)
    || !Number.isSafeInteger(owner.pid) || owner.pid < 1 || !timestamp(owner.createdAt)
    || !['claim', 'checkpoint', 'release'].includes(value.kind as string)
    || !['claimed', 'restoring', 'shutdown-pending', 'readback-completed', 'archiving', 'archived', 'retired'].includes(value.phase as string)
    || value.action !== undefined && !validAction(value.action)
    || value.phase === 'restoring' && value.action === undefined
    || typeof value.shutdownPending !== 'boolean' || value.completionBoot !== null && !completion(value)) throw failure();
  return value as unknown as Checkpoint;
}

function transition(previous: Checkpoint | undefined, next: Checkpoint): boolean {
  if (!previous) return next.kind === 'claim' && next.sequence === 0 && next.phase === 'claimed'
    && !next.shutdownPending && next.completionBoot === null && next.action === undefined;
  if (next.sequence !== previous.sequence + 1 || ['deviceKey', 'fingerprint', 'originalDigest', 'transactionId']
    .some(key => next[key as keyof Checkpoint] !== previous[key as keyof Checkpoint])) return false;
  if (next.kind === 'claim') return next.phase === previous.phase && next.shutdownPending === previous.shutdownPending
    && next.completionBoot === previous.completionBoot && JSON.stringify(next.action) === JSON.stringify(previous.action) && next.owner.token !== previous.owner.token
    && (previous.kind === 'release' || !alive(previous.owner.pid));
  if (JSON.stringify(next.owner) !== JSON.stringify(previous.owner)) return false;
  if (previous.kind === 'release') return false;
  if (next.kind === 'release') return next.phase === previous.phase && next.shutdownPending === previous.shutdownPending && next.completionBoot === previous.completionBoot
    && JSON.stringify(next.action) === JSON.stringify(previous.action);
  if (next.phase === 'restoring') {
    if (!['claimed', 'restoring'].includes(previous.phase) || !validAction(next.action) || next.shutdownPending
      || next.completionBoot !== null || previous.shutdownPending) return false;
    if (previous.action?.state === 'pending') return next.action.state === 'verified'
      && next.action.id === previous.action.id && next.action.intent === previous.action.intent;
    return next.action.state === 'pending' && next.action.id !== previous.action?.id;
  }
  if (previous.action?.state === 'pending' || JSON.stringify(next.action) !== JSON.stringify(previous.action)) return false;
  const allowed: Record<Phase, Phase[]> = { claimed: ['shutdown-pending', 'readback-completed'], restoring: ['readback-completed'],
    'shutdown-pending': ['readback-completed'], 'readback-completed': ['archiving'], archiving: ['archived'], archived: ['retired'], retired: [] };
  return allowed[previous.phase].includes(next.phase) && next.shutdownPending === (previous.shutdownPending || next.phase === 'shutdown-pending')
    && (next.phase === 'readback-completed' ? completion(next) : next.completionBoot === previous.completionBoot);
}

function validAction(value: unknown): value is RecoveryAction {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const action = value as RecoveryAction;
  return typeof action.id === 'string' && /^[a-z][a-z0-9.-]{0,127}$/.test(action.id) && hash(action.intent)
    && (action.state === 'pending' ? action.observation === undefined && Object.keys(action).sort().join(',') === 'id,intent,state'
      : action.state === 'verified' && hash(action.observation) && Object.keys(action).sort().join(',') === 'id,intent,observation,state');
}
function completion(value: { action?: unknown; completionBoot?: unknown }): boolean {
  return value.action === undefined ? timestamp(value.completionBoot) : hash(value.completionBoot);
}

/** Bounded descriptor/path/bytes identity; rejects concurrent replacement, links and partial reads. */
export async function readPrivateRecord(path: string): Promise<{ bytes: string; value: Record<string, unknown>; identity: string }> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await file.stat();
    if (!before.isFile() || before.nlink !== 1 || before.size > 32768) throw failure();
    const buffer = Buffer.alloc(32769), { bytesRead } = await file.read(buffer, 0, buffer.length, 0), after = await file.stat();
    if (bytesRead !== before.size || statIdentity(before) !== statIdentity(after) || statIdentity(after) !== statIdentity(await lstat(path))) throw failure();
    const bytes = buffer.subarray(0, bytesRead).toString('utf8'), value: unknown = JSON.parse(bytes);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw failure();
    return { bytes, value: value as Record<string, unknown>, identity: digest(statIdentity(after) + digest(bytes)) };
  } finally { await file.close(); }
}
async function directoryIdentity(path: string): Promise<string> {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw failure();
  return JSON.stringify([info.dev, info.ino, info.mode]);
}
export async function syncDirectory(path: string): Promise<void> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY);
  try { await file.sync(); } finally { await file.close(); }
}
function statIdentity(info: Stats): string { return JSON.stringify([info.dev, info.ino, info.mode, info.nlink, info.size, info.mtimeMs, info.ctimeMs]); }
function stepName(index: number): string { return `step-${String(index).padStart(6, '0')}`; }
function hash(value: unknown): value is string { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value); }
function uuid(value: unknown): value is string { return typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value); }
function timestamp(value: unknown): value is string { return typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value; }
function digest(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function alive(pid: number): boolean { try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH'; } }
function failure(): NativeError { return new NativeError('cleanup_failed', 'Recovery transaction or its immutable evidence could not be verified; exclusion was retained.'); }
function busy(): NativeError { return new NativeError('device_busy', 'Another recovery owner or host tool has exclusive ownership.'); }
