import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import { execFile } from 'node:child_process';
import { lstat, open, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { NativeError } from '@fliwright/core';

export interface NativeToolOwnershipScope { path: string; operationToken: string; assertOwned(): Promise<void>; }
const ownership = new AsyncLocalStorage<NativeToolOwnershipScope>();

/** Internal operation scope, inherited by awaited platform work, never by project configuration. */
export function withNativeToolOwnership<T>(scope: NativeToolOwnershipScope, action: () => Promise<T>): Promise<T> {
  return ownership.run(scope, action);
}

export interface NativeToolRecord {
  schemaVersion: 1;
  resourceId: string;
  operationToken: string;
  ownerPid: number;
  createdAt: string;
  phase: 'reserved' | 'gated' | 'running' | 'settled';
  wrapperPid?: number;
  group?: number;
}

/** Strict local evidence decoder; a recorded PID never authorizes signalling a new process. */
export function isNativeToolRecord(value: Record<string, unknown>): value is NativeToolRecord & Record<string, unknown> {
  return value.schemaVersion === 1 && typeof value.resourceId === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value.resourceId)
    && typeof value.operationToken === 'string' && value.operationToken.length > 0 && value.operationToken.length <= 128
    && Number.isSafeInteger(value.ownerPid) && (value.ownerPid as number) > 0
    && typeof value.createdAt === 'string' && Number.isFinite(Date.parse(value.createdAt))
    && ['reserved', 'gated', 'running', 'settled'].includes(value.phase as string)
    && (value.phase === 'reserved' ? value.wrapperPid === undefined && value.group === undefined
      : Number.isSafeInteger(value.wrapperPid) && (value.wrapperPid as number) > 0 && value.group === value.wrapperPid)
    && Object.keys(value).every(key => ['schemaVersion', 'resourceId', 'operationToken', 'ownerPid', 'createdAt', 'phase', 'wrapperPid', 'group'].includes(key));
}

/** Use host process inventory because kill(pid, 0) treats reaped zombies as live. */
export async function inspectNativeToolProcess(record: NativeToolRecord): Promise<'live' | 'exited' | 'invalid'> {
  if (process.platform === 'win32') return 'invalid';
  try {
    const output = await new Promise<string>((resolve, reject) => {
      execFile('/bin/ps', ['-axo', 'pid=,pgid=,stat=,command='], { encoding: 'utf8', timeout: 1000, maxBuffer: 4 * 1024 * 1024 },
        (error, stdout) => error ? reject(error) : resolve(stdout));
    });
    // Linux kernel threads can belong to process group zero.
    const lines = output.trim().split('\n').map(line => /^\s*([1-9]\d*)\s+(0|[1-9]\d*)\s+(\S+)\s+(.*)$/.exec(line));
    if (lines.some(line => !line)) return 'invalid';
    const members = lines.filter(line => Number(line![2]) === record.group && !line![3].includes('Z'));
    if (!members.length) return 'exited';
    const wrapper = members.find(line => Number(line![1]) === record.wrapperPid);
    if (wrapper && !wrapper[4].includes(`fliwright-tool:${record.resourceId}`)) return 'invalid';
    // Descendants can outlive a killed wrapper; retain exclusion for the entire recorded group.
    return 'live';
  } catch { return 'invalid'; }
}

/** Write-ahead host process identity. Existing or replaced evidence is never adopted. */
export class NativeToolJournal {
  readonly resourceId = randomUUID();
  private record: NativeToolRecord;
  private previous?: { bytes: string; identity: string };
  private directoryIdentity?: string;
  private constructor(private readonly scope: NativeToolOwnershipScope) {
    this.record = { schemaVersion: 1, resourceId: this.resourceId, operationToken: scope.operationToken,
      ownerPid: process.pid, createdAt: new Date().toISOString(), phase: 'reserved' };
  }
  static async reserve(): Promise<NativeToolJournal | undefined> {
    const scope = ownership.getStore();
    if (!scope) return undefined;
    const journal = new NativeToolJournal(scope);
    await journal.write();
    return journal;
  }
  async checkpoint(phase: 'gated' | 'running' | 'settled', pid: number): Promise<void> {
    this.record = { ...this.record, phase, wrapperPid: pid, group: pid };
    await this.write();
  }
  async complete(): Promise<void> {
    if (this.record.phase !== 'settled') throw failure();
    await this.guard(); await this.assertCurrent(); await this.guard();
    await rm(this.scope.path);
    await this.syncDirectory();
  }
  /** Only valid while no wrapper has been spawned; not a recovery/adoption path. */
  async cancelBeforeSpawn(): Promise<void> {
    if (this.record.phase !== 'reserved') throw failure();
    await this.guard(); await this.assertCurrent();
    await rm(this.scope.path); await this.syncDirectory();
  }
  private async write(): Promise<void> {
    await this.guard();
    const bytes = JSON.stringify(this.record);
    if (!this.previous) {
      const file = await open(this.scope.path, 'wx', 0o600);
      try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
    } else {
      const path = `${this.scope.path}.${randomUUID()}`;
      try {
        const file = await open(path, 'wx', 0o600);
        try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
        await this.guard(); await this.assertCurrent();
        await rename(path, this.scope.path);
      } finally { await rm(path, { force: true }); }
    }
    await this.syncDirectory();
    const current = await this.read();
    if (current.bytes !== bytes) throw failure();
    this.previous = current;
    await this.guard();
  }
  private async assertCurrent(): Promise<void> {
    const current = await this.read();
    if (current.bytes !== this.previous?.bytes || current.identity !== this.previous?.identity) throw failure();
  }
  private async read(): Promise<{ bytes: string; identity: string }> {
    const file = await open(this.scope.path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const before = await file.stat();
      if (!before.isFile() || before.nlink !== 1 || before.size > 2048) throw failure();
      const buffer = Buffer.alloc(2049), { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      const after = await file.stat();
      if (bytesRead > 2048 || identity(before) !== identity(after) || identity(after) !== identity(await lstat(this.scope.path))) throw failure();
      return { bytes: buffer.subarray(0, bytesRead).toString('utf8'), identity: identity(after) };
    } finally { await file.close(); }
  }
  private async guard(): Promise<void> {
    await this.scope.assertOwned();
    const file = await open(dirname(this.scope.path), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY);
    try {
      const info = await file.stat(), current = JSON.stringify([info.dev, info.ino, info.mode]);
      this.directoryIdentity ??= current;
      if (this.directoryIdentity !== current) throw failure();
    } finally { await file.close(); }
  }
  private async syncDirectory(): Promise<void> {
    const file = await open(dirname(this.scope.path), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY);
    try { await file.sync(); } finally { await file.close(); }
  }
}
function identity(info: Stats): string { return JSON.stringify([info.dev, info.ino, info.mode, info.nlink, info.size, info.mtimeMs, info.ctimeMs]); }
function failure(): NativeError { return new NativeError('cleanup_failed', 'Native tool recovery evidence changed or could not be confirmed; retain the operation lock.'); }
