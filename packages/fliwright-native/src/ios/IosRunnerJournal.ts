import { createHash, randomUUID } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import { lstat, open, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { NativeError, type NativeOperationContext } from '@fliwright/core';

export interface RunnerRecord {
  schemaVersion: 2;
  journalId: string;
  leaseKey: string;
  ownerGeneration: string;
  deviceKey: string;
  generation: string;
  simulatorBootedAt: string;
  bundleId: string;
  phase: 'launching' | 'running';
  runnerPid: number | null;
  sessionId: string;
  recoveryKey: string;
  recoveryPort: number | null;
}

/** Durable Simulator Runner identity evidence, bound to one local device owner. */
export class IosRunnerJournal {
  private readonly deviceKey: string;
  private record?: RunnerRecord;
  private previous?: { bytes: string; identity: string };
  private directoryIdentity?: string;

  constructor(private readonly options: { path: string; deviceId: string; binding: { leaseKey: string; ownerGeneration: string };
    assertOwned(): Promise<void> }) {
    this.deviceKey = hash(`ios\0${options.deviceId.toLowerCase()}`);
  }

  async begin(generation: string, simulatorBootedAt: string, credentials: { sessionId: string; recoveryKey: string },
    context: NativeOperationContext): Promise<void> {
    if (this.record || !isUuid(generation) || !isTimestamp(simulatorBootedAt) || !isUuid(credentials.sessionId)
      || !isHash(credentials.recoveryKey)) throw invalid();
    this.record = { schemaVersion: 2, journalId: randomUUID(), ...this.options.binding, deviceKey: this.deviceKey,
      generation, simulatorBootedAt, sessionId: credentials.sessionId, recoveryKey: credentials.recoveryKey,
      bundleId: 'dev.fliwright.NativeRunner.xctrunner', phase: 'launching', runnerPid: null, recoveryPort: null };
    await this.publish(context);
  }

  async bind(runnerPid: number, recoveryPort: number, context: NativeOperationContext): Promise<void> {
    if (!this.record || this.record.phase !== 'launching' || !Number.isSafeInteger(runnerPid) || runnerPid <= 0
      || !isPort(recoveryPort)) throw invalid();
    this.record = { ...this.record, phase: 'running', runnerPid, recoveryPort };
    await this.publish(context);
  }

  async complete(context: NativeOperationContext): Promise<void> {
    if (!this.record || !this.previous) throw invalid();
    await this.guard(context);
    await this.assertCurrent();
    await this.guard(context);
    await rm(this.options.path);
    await this.syncDirectory();
    this.record = undefined;
    this.previous = undefined;
    check(context);
  }

  private async publish(context: NativeOperationContext): Promise<void> {
    await this.guard(context);
    const bytes = JSON.stringify(this.record);
    if (Buffer.byteLength(bytes) > 4096) throw invalid();
    if (!this.previous) {
      const file = await open(this.options.path, 'wx', 0o600);
      try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
    } else {
      await this.assertCurrent();
      const temporary = `${this.options.path}.${randomUUID()}`;
      try {
        const file = await open(temporary, 'wx', 0o600);
        try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
        await this.guard(context);
        await this.assertCurrent();
        await rename(temporary, this.options.path);
      } finally { await rm(temporary, { force: true }); }
    }
    await this.syncDirectory();
    const current = await this.read();
    if (current.bytes !== bytes) throw invalid();
    this.previous = current;
    await this.guard(context);
  }

  private async assertCurrent(): Promise<void> {
    const current = await this.read();
    if (current.bytes !== this.previous?.bytes || current.identity !== this.previous.identity) throw invalid();
  }

  private async read(): Promise<{ bytes: string; identity: string }> {
    const file = await open(this.options.path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const before = await file.stat();
      if (!before.isFile() || before.nlink !== 1 || before.size > 4096) throw invalid();
      const buffer = Buffer.alloc(4097), { bytesRead } = await file.read(buffer, 0, buffer.length, 0), after = await file.stat();
      if (bytesRead > 4096 || fileIdentity(before) !== fileIdentity(after)
        || fileIdentity(after) !== fileIdentity(await lstat(this.options.path))) throw invalid();
      return { bytes: buffer.subarray(0, bytesRead).toString('utf8'), identity: fileIdentity(after) };
    } finally { await file.close(); }
  }

  private async guard(context: NativeOperationContext): Promise<void> {
    check(context);
    await this.options.assertOwned();
    check(context);
    const file = await open(dirname(this.options.path), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY);
    try {
      const info = await file.stat(), identity = JSON.stringify([info.dev, info.ino, info.mode]);
      this.directoryIdentity ??= identity;
      if (identity !== this.directoryIdentity) throw invalid();
    } finally { await file.close(); }
    check(context);
  }

  private async syncDirectory(): Promise<void> {
    const file = await open(dirname(this.options.path), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY);
    try { await file.sync(); } finally { await file.close(); }
  }
}

export function isIosRunnerRecord(value: unknown): value is RunnerRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.schemaVersion === 2 && isUuid(record.journalId) && isHash(record.leaseKey) && isHash(record.ownerGeneration)
    && isHash(record.deviceKey) && isUuid(record.generation) && isTimestamp(record.simulatorBootedAt)
    && isUuid(record.sessionId) && isHash(record.recoveryKey)
    && record.bundleId === 'dev.fliwright.NativeRunner.xctrunner'
    && ['launching', 'running'].includes(String(record.phase))
    && (record.phase === 'launching' ? record.runnerPid === null && record.recoveryPort === null
      : Number.isSafeInteger(record.runnerPid) && (record.runnerPid as number) > 0 && isPort(record.recoveryPort))
    && Object.keys(record).length === 13;
}

function isPort(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= 65535; }
function isUuid(value: unknown): value is string { return typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value); }
function isHash(value: unknown): value is string { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value); }
function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value;
}
function hash(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function fileIdentity(info: Stats): string { return JSON.stringify([info.dev, info.ino, info.mode, info.nlink, info.size, info.mtimeMs, info.ctimeMs]); }
function check(context: NativeOperationContext): void {
  context.signal.throwIfAborted();
  if (Date.now() >= context.deadline) throw new NativeError('timeout', 'iOS Runner journal deadline exceeded.');
}
function invalid(): NativeError { return new NativeError('cleanup_failed', 'iOS Runner recovery evidence could not be confirmed; retain the device lease.'); }
