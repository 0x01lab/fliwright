import { createHash, randomUUID } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import { link, lstat, open, rename, rm } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';
import { NativeError, type AndroidPermissionObservation, type NativeOperationContext } from '@fliwright/core';
import type { NativePermissionRequest } from './AndroidPermissionPreparation.js';
import { inspectAndroidPermissionJournal } from './AndroidRecoveryRecords.js';

export interface AndroidPermissionCheckpoint {
  uid: number;
  baseline: AndroidPermissionObservation[];
  declaration: NativePermissionRequest[];
  desired: AndroidPermissionObservation[];
  observed?: AndroidPermissionObservation[];
  status: 'pending' | 'verified';
  step: 'baseline' | 'grant' | 'revoke' | 'clear-flags' | 'set-flags' | 'readback' | 'stop' | 'stopped';
  permission?: 'camera' | 'microphone';
  restored: boolean;
}

/** Parent-owned recovery evidence. Existing records are never adopted or replayed. */
export class AndroidPermissionJournal {
  private readonly id = randomUUID();
  private readonly deviceKey: string;
  private previous?: { bytes: string; identity: string };
  private directoryIdentity?: string;
  private readonly recoveryBinding: { leaseKey: string; ownerGeneration: string };
  private installedApp?: { sha256: string; uid: number; installedBySession: boolean };
  private uid?: number;
  private baseline: AndroidPermissionObservation[] = [];
  private restored = false;
  constructor(private readonly options: { path: string; deviceId: string; appId: string;
    recoveryBinding?: { leaseKey: string; ownerGeneration: string };
    appIdentity?: () => { sha256: string; uid: number; installedBySession: boolean } | undefined;
    assertOwned(): Promise<void> }) {
    if (!isAbsolute(options.path) || options.path.includes('\0')) throw new NativeError('precondition_failed', 'Permission recovery requires a private absolute owner path.');
    this.deviceKey = createHash('sha256').update(`android\0${options.deviceId}`).digest('hex');
    this.recoveryBinding = { ...(options.recoveryBinding ?? { leaseKey: this.deviceKey, ownerGeneration: '0'.repeat(64) }) };
  }

  async checkpoint(input: AndroidPermissionCheckpoint, context: NativeOperationContext): Promise<void> {
    // Snapshot before awaiting owner validation; callers cannot alter an in-flight intent.
    const snapshot = structuredClone(input);
    const allowed = ['uid', 'baseline', 'declaration', 'desired', 'observed', 'status', 'step', 'permission', 'restored'];
    if (!snapshot || typeof snapshot !== 'object' || Object.keys(snapshot).some(key => !allowed.includes(key))) throw failure();
    await this.assertOwned(context);
    const currentApp = this.options.appIdentity?.(), app = currentApp ? { ...currentApp } : undefined;
    if (app && app.uid !== snapshot.uid || this.installedApp && (!app || app.sha256 !== this.installedApp.sha256
      || app.uid !== this.installedApp.uid || app.installedBySession !== this.installedApp.installedBySession)) throw failure();
    if (this.uid !== undefined && snapshot.uid !== this.uid) throw failure();
    const value = JSON.stringify({ version: 2, journalId: this.id, deviceKey: this.deviceKey,
      ...this.recoveryBinding,
      appSha256: app?.sha256 ?? null, appInstalledBySession: app?.installedBySession ?? null,
      appId: this.options.appId, user: 0, appOpPolicy: 'default-package', ...snapshot });
    if (Buffer.byteLength(value) > 32768 || inspectAndroidPermissionJournal(JSON.parse(value)) !== 'bound') throw failure();
    if (this.baseline.some(original => !snapshot.baseline.some(state => state.permission === original.permission
      && state.granted === original.granted && state.userSet === original.userSet && state.userFixed === original.userFixed
      && state.flags.length === original.flags.length && state.flags.every(flag => original.flags.includes(flag))))) throw failure();
    const temporary = `${this.options.path}.${randomUUID()}`;
    try {
      const file = await open(temporary, 'wx', 0o600);
      try { await file.writeFile(value); await file.sync(); } finally { await file.close(); }
      await this.guard(context);
      if (this.previous === undefined) {
        // An exclusive link publishes the first complete snapshot without replacing prior evidence.
        await link(temporary, this.options.path);
        await rm(temporary);
      } else {
        await this.assertCurrent(context);
        await rename(temporary, this.options.path);
      }
      await this.syncDirectory();
      const current = await this.read();
      if (current.bytes !== value) throw failure();
      this.previous = current;
      if (app) this.installedApp = { ...app };
      this.uid = snapshot.uid;
      this.baseline = snapshot.baseline;
      this.restored = snapshot.status === 'verified' && snapshot.restored;
      await this.guard(context);
    } finally { await rm(temporary, { force: true }); }
  }

  /** Fence preparation before platform work if evidence no longer belongs to this owner. */
  async assertOwned(context: NativeOperationContext): Promise<void> {
    if (this.previous) await this.assertCurrent(context);
    else await this.guard(context);
  }

  /** Remove only this journal, after verified restoration and all owned app cleanup. */
  async complete(context: NativeOperationContext): Promise<void> {
    await this.guard(context);
    if (this.previous === undefined) return;
    if (!this.restored) throw new NativeError('cleanup_failed', 'Android permission restoration has not been verified.');
    await this.assertCurrent(context);
    await this.guard(context);
    await rm(this.options.path);
    await this.syncDirectory();
    check(context);
    this.previous = undefined;
  }

  private async assertCurrent(context: NativeOperationContext): Promise<void> {
    await this.guard(context);
    const current = await this.read();
    if (current.bytes !== this.previous?.bytes || current.identity !== this.previous.identity) throw failure();
    await this.guard(context);
  }
  private async read(): Promise<{ bytes: string; identity: string }> {
    try {
      const file = await open(this.options.path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const before = await file.stat();
        if (!before.isFile() || before.nlink !== 1 || before.size > 32768) throw failure();
        const buffer = Buffer.alloc(32769);
        const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
        const after = await file.stat();
        if (bytesRead > 32768 || identity(before) !== identity(after) || identity(after) !== identity(await lstat(this.options.path))) throw failure();
        return { bytes: buffer.subarray(0, bytesRead).toString('utf8'), identity: identity(after) };
      } finally { await file.close(); }
    } catch (cause) { throw failure(cause); }
  }
  private async guard(context: NativeOperationContext): Promise<void> {
    check(context);
    await this.options.assertOwned();
    try {
      const directory = await open(dirname(this.options.path), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY);
      try {
        const info = await directory.stat(), current = JSON.stringify([info.dev, info.ino, info.mode]);
        this.directoryIdentity ??= current;
        if (current !== this.directoryIdentity) throw failure();
      } finally { await directory.close(); }
    } catch (cause) { throw failure(cause); }
    check(context);
  }
  private async syncDirectory(): Promise<void> {
    const directory = await open(dirname(this.options.path), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY);
    try { await directory.sync(); } finally { await directory.close(); }
  }
}

function identity(info: Stats): string {
  return JSON.stringify([info.dev, info.ino, info.mode, info.nlink, info.size, info.mtimeMs, info.ctimeMs]);
}
function failure(cause?: unknown): NativeError {
  return new NativeError('cleanup_failed', 'Android permission recovery evidence changed or could not be confirmed; preserve the original records.',
    cause === undefined ? undefined : { cause });
}
function check(context: NativeOperationContext): void {
  context.signal.throwIfAborted();
  if (Date.now() >= context.deadline) throw new NativeError('timeout', 'Android permission recovery deadline exceeded.');
}
