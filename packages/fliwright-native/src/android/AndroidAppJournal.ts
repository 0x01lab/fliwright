import { createHash, randomUUID } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import { link, lstat, open, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { NativeError, type NativeOperationContext } from '@fliwright/core';
import { checkAndroidAppDeadline } from './AndroidApk.js';

/** Private single-owner evidence. Equal bytes in a replacement file are not ownership. */
export class AndroidAppJournal {
  private readonly journalId = randomUUID();
  private readonly deviceKey: string;
  private previous?: { bytes: string; identity: string };
  private directoryIdentity?: string;
  constructor(private readonly options: { path: string; deviceId: string; recoveryBinding?: { leaseKey: string; ownerGeneration: string }; assertOwned?(): Promise<void> }) {
    this.deviceKey = createHash('sha256').update(`android\0${options.deviceId}`).digest('hex');
  }

  async assertOwned(context: NativeOperationContext): Promise<void> {
    if (this.previous) await this.assertCurrent(context);
    else await this.guard(context);
  }

  async checkpoint(value: object, context: NativeOperationContext): Promise<void> {
    await this.guard(context);
    const bytes = JSON.stringify({ version: 3, journalId: this.journalId, deviceKey: this.deviceKey,
      leaseKey: this.options.recoveryBinding?.leaseKey ?? this.deviceKey,
      ownerGeneration: this.options.recoveryBinding?.ownerGeneration ?? '0'.repeat(64), ...value });
    if (Buffer.byteLength(bytes) > 32768) throw failure();
    const temporary = `${this.options.path}.${randomUUID()}`;
    try {
      const file = await open(temporary, 'wx', 0o600);
      try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
      await this.guard(context);
      if (this.previous) {
        await this.assertCurrent(context);
        await rename(temporary, this.options.path);
      } else {
        // Publish without ever replacing pre-existing evidence, including symlinks.
        await link(temporary, this.options.path);
        await rm(temporary);
      }
      await this.syncDirectory();
      const current = await this.read();
      if (current.bytes !== bytes) throw failure();
      this.previous = current;
      await this.guard(context);
    } finally { await rm(temporary, { force: true }); }
  }

  async complete(context: NativeOperationContext): Promise<void> {
    await this.guard(context);
    if (!this.previous) return;
    await this.assertCurrent(context);
    await this.guard(context);
    await rm(this.options.path);
    await this.syncDirectory();
    this.previous = undefined;
    checkAndroidAppDeadline(context);
  }

  private async assertCurrent(context: NativeOperationContext): Promise<void> {
    await this.guard(context);
    const current = await this.read();
    if (current.bytes !== this.previous?.bytes || current.identity !== this.previous.identity) throw failure();
    await this.guard(context);
  }
  private async read(): Promise<{ bytes: string; identity: string }> {
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
  }
  private async guard(context: NativeOperationContext): Promise<void> {
    checkAndroidAppDeadline(context);
    await this.options.assertOwned?.();
    const file = await open(dirname(this.options.path), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY);
    try {
      const info = await file.stat(), current = JSON.stringify([info.dev, info.ino, info.mode]);
      this.directoryIdentity ??= current;
      if (this.directoryIdentity !== current) throw failure();
    } finally { await file.close(); }
    checkAndroidAppDeadline(context);
  }
  private async syncDirectory(): Promise<void> {
    const file = await open(dirname(this.options.path), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY);
    try { await file.sync(); } finally { await file.close(); }
  }
}

function identity(info: Stats): string {
  return JSON.stringify([info.dev, info.ino, info.mode, info.nlink, info.size, info.mtimeMs, info.ctimeMs]);
}
function failure(): NativeError {
  return new NativeError('cleanup_failed', 'Managed app recovery evidence changed or could not be confirmed; preserve the original records.');
}
