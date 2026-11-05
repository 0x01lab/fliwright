import { createHash, randomUUID } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import { lstat, open, rm } from 'node:fs/promises';
import { hostname } from 'node:os';
import { dirname } from 'node:path';
import { NativeError, type NativeOperationContext } from '@fliwright/core';
import { executeTool, type ToolExecutor } from '../ToolExecutor.js';
import { defaultAdbPath } from './AdbSession.js';

export interface AndroidDeviceRecord {
  version: 1; journalId: string; leaseKey: string; ownerGeneration: string;
  serialKey: string; avdKey: string; bootKey: string; osKey: string;
}

/** Parent-owned immutable device evidence, captured before managed platform mutations. */
export class AndroidDeviceBinding {
  private previous?: { value: AndroidDeviceRecord; bytes: string; identity: string };
  private directoryIdentity?: string;
  private failed = false;
  private readonly executor: ToolExecutor;
  constructor(private readonly options: { path: string; deviceId: string; avdName?: string; adbPath?: string;
    binding: { leaseKey: string; ownerGeneration: string }; executor?: ToolExecutor; readOnly?: boolean; assertOwned(): Promise<void> }) {
    this.executor = options.executor ?? executeTool;
  }
  get outcomeUnknown(): boolean { return this.failed; }
  get hasRecord(): boolean { return this.previous !== undefined; }

  async verify(context: NativeOperationContext): Promise<void> {
    if (this.failed) throw failure();
    try {
      await this.guard(context);
      const stableLeaseKey = this.options.avdName ? androidAvdLeaseKey(this.options.avdName) : androidSerialLeaseKey(this.options.deviceId);
      if ((this.options.avdName !== undefined && !/^[\w.-]+$/.test(this.options.avdName))
        || this.options.binding.leaseKey !== stableLeaseKey) {
        throw new NativeError('precondition_failed', 'Android mutation requires the lease for its discovered stable device identity.');
      }
      if (this.previous) await this.assertRecord(context);
      const identity = await this.observe(context);
      if (this.previous) {
        if (Object.entries(identity).some(([key, value]) => this.previous!.value[key as keyof AndroidDeviceRecord] !== value)) {
          throw new NativeError('device_mismatch', 'Android serial, AVD, boot or OS identity changed; the original device evidence was retained.');
        }
      } else {
        if (this.options.readOnly) {
          const current = await this.read();
          const value = JSON.parse(current.bytes) as unknown;
          if (!isAndroidDeviceRecord(value) || value.leaseKey !== this.options.binding.leaseKey
            || value.ownerGeneration !== this.options.binding.ownerGeneration) throw failure();
          this.previous = { ...current, value };
          if (Object.entries(identity).some(([key, field]) => value[key as keyof AndroidDeviceRecord] !== field)) {
            throw new NativeError('device_mismatch', 'Delegated Android identity differs from the parent device binding.');
          }
        } else {
        const value: AndroidDeviceRecord = { version: 1, journalId: randomUUID(), ...this.options.binding, ...identity };
        if (!isAndroidDeviceRecord(value)) throw failure();
        const bytes = JSON.stringify(value);
        // From publication onward, an unconfirmed outcome must retain exclusion.
        this.failed = true;
        const file = await open(this.options.path, 'wx', 0o600);
        try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
        await this.syncDirectory();
        const current = await this.read();
        if (current.bytes !== bytes) throw failure();
        this.previous = { ...current, value };
        }
      }
      await this.assertRecord(context);
      this.failed = false;
    } catch (error) { if (this.previous) this.failed = true; throw error; }
  }

  /** Complete only after the owner has verified all app/permission cleanup. */
  async complete(context: NativeOperationContext): Promise<void> {
    if (!this.previous) return;
    await this.verify(context);
    await this.assertRecord(context);
    await rm(this.options.path);
    await this.syncDirectory();
    this.previous = undefined;
    check(context);
  }

  private async observe(context: NativeOperationContext): Promise<Pick<AndroidDeviceRecord, 'serialKey' | 'avdKey' | 'bootKey' | 'osKey'>> {
    const run = async (args: string[]) => {
      await this.guard(context);
      const result = await this.executor(this.options.adbPath ?? defaultAdbPath(), ['-s', this.options.deviceId, ...args], context);
      check(context);
      if (result.length > 4096) throw failure();
      return result.toString('utf8').trim();
    };
    const serial = await run(['get-serialno']);
    const avd = this.options.avdName ? await run(['emu', 'avd', 'name']) : undefined;
    const boot = await run(['shell', 'cat /proc/sys/kernel/random/boot_id']);
    const fingerprint = await run(['shell', 'getprop ro.build.fingerprint']);
    const sdk = await run(['shell', 'getprop ro.build.version.sdk']);
    if (serial !== this.options.deviceId || (this.options.avdName !== undefined
      && avd !== this.options.avdName + '\nOK' && avd !== this.options.avdName + '\r\nOK')
      || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(boot)
      || !/^[\x21-\x7e]{1,1024}$/.test(fingerprint) || !/^\d{2,3}$/.test(sdk) || Number(sdk) < 23
      || await run(['shell', 'cat /proc/sys/kernel/random/boot_id']) !== boot
      || (this.options.avdName !== undefined && await run(['emu', 'avd', 'name']) !== avd) || await run(['get-serialno']) !== serial) {
      throw new NativeError('device_mismatch', 'Android did not confirm one stable serial, AVD, boot and OS identity.');
    }
    return { serialKey: hash(`android\0${serial}`), avdKey: this.options.avdName
      ? androidAvdKey(this.options.avdName) : hash(`android-device\0${serial}`),
      bootKey: hash(boot), osKey: hash(`${sdk}\0${fingerprint}`) };
  }
  private async assertRecord(context: NativeOperationContext): Promise<void> {
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
        if (!before.isFile() || before.nlink !== 1 || before.size > 4096) throw failure();
        const buffer = Buffer.alloc(4097), { bytesRead } = await file.read(buffer, 0, buffer.length, 0), after = await file.stat();
        if (bytesRead > 4096 || fileIdentity(before) !== fileIdentity(after) || fileIdentity(after) !== fileIdentity(await lstat(this.options.path))) throw failure();
        return { bytes: buffer.subarray(0, bytesRead).toString('utf8'), identity: fileIdentity(after) };
      } finally { await file.close(); }
    } catch (cause) { throw failure(cause); }
  }
  private async guard(context: NativeOperationContext): Promise<void> {
    check(context); await this.options.assertOwned(); check(context);
    const file = await open(dirname(this.options.path), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY);
    try {
      const info = await file.stat(), identity = JSON.stringify([info.dev, info.ino, info.mode]);
      this.directoryIdentity ??= identity;
      if (identity !== this.directoryIdentity) throw failure();
    } finally { await file.close(); }
  }
  private async syncDirectory(): Promise<void> {
    const file = await open(dirname(this.options.path), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY);
    try { await file.sync(); } finally { await file.close(); }
  }
}

export function androidAvdKey(name: string): string { return hash(`android-avd\0${name}`); }
function androidAvdLeaseKey(name: string): string { return hash(`${hostname()}\0android\0avd:${name}`); }
function androidSerialLeaseKey(serial: string): string { return hash(`${hostname()}\0android\0${serial}`); }
export function isAndroidDeviceRecord(value: unknown): value is AndroidDeviceRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>, hashes = ['leaseKey', 'ownerGeneration', 'serialKey', 'avdKey', 'bootKey', 'osKey'];
  return record.version === 1 && typeof record.journalId === 'string'
    && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(record.journalId)
    && Object.keys(record).length === hashes.length + 2 && hashes.every(key => typeof record[key] === 'string' && /^[a-f0-9]{64}$/.test(record[key]));
}
function hash(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function fileIdentity(info: Stats): string { return JSON.stringify([info.dev, info.ino, info.mode, info.nlink, info.size, info.mtimeMs, info.ctimeMs]); }
function check(context: NativeOperationContext): void {
  context.signal.throwIfAborted();
  if (Date.now() >= context.deadline) throw new NativeError('timeout', 'Android device identity deadline exceeded.');
}
function failure(cause?: unknown): NativeError {
  return new NativeError('cleanup_failed', 'Android device recovery evidence could not be confirmed; preserve the original records.', cause === undefined ? undefined : { cause });
}
