import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { hostname, homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { NativeError } from '@fliwright/core';
import type { NativeOperationContext } from '@fliwright/core';
import { withNativeToolOwnership, type NativeToolOwnershipScope } from './NativeToolOwnership.js';
import type { ToolExecutor } from './ToolExecutor.js';

export interface DeviceLease {
  readonly key: string;
  readonly signal?: AbortSignal;
  /** Private parent-only recovery record; delegated children cannot own app installation. */
  readonly recoveryPath?: string;
  /** Private parent-only permission baseline and pending write record. */
  readonly permissionRecoveryPath?: string;
  /** Private parent-only serial/AVD/boot/OS recovery binding. */
  readonly deviceRecoveryPath?: string;
  /** Private parent-bound Simulator Runner evidence; a delegated Runner uses the same owner binding. */
  readonly iosRunnerRecoveryPath?: string;
  /** @internal Shared app/permission recovery binding; contains no raw device ID or lease token. */
  readonly recoveryBinding?: { leaseKey: string; ownerGeneration: string };
  /** Verify a delegated Android runtime against its parent-owned identity record. */
  verifyAndroidDevice?(input: { deviceId: string; avdName?: string; adbPath?: string; executor?: ToolExecutor }, context: NativeOperationContext): Promise<void>;
  /** Complete a parent-owned Android binding only after its runtime has stopped. */
  completeAndroidDevice?(input: { deviceId: string; avdName?: string; adbPath?: string; executor?: ToolExecutor }, context: NativeOperationContext): Promise<void>;
  assertOwned?(): Promise<void>;
  /** Serialize platform work across the retained parent owner and its delegated child. */
  runExclusive?<T>(action: () => Promise<T>, signal?: AbortSignal): Promise<T>;
  /** @internal Persist host-process evidence for a tool whose lifetime outlasts one operation. */
  runOwnedTool?<T>(action: () => Promise<T>): Promise<T>;
  /** Pass only through the supervised child's environment, never project config. */
  delegate?(): Promise<DeviceLeaseDelegation>;
  quarantine(reason: string): Promise<void>;
  release(): Promise<void>;
}
export interface DeviceLeaseDelegation { rootDir: string; key: string; token: string; }
export interface DeviceLeaseOptions { rootDir?: string; retryDelayMs?: number; delegation?: DeviceLeaseDelegation; }
interface Owner { token: string; pid: number; createdAt: string; }
interface Grant { ownerToken: string; tokenHash: string; }
export const NATIVE_DEVICE_LEASE_ENV = 'FLIWRIGHT_NATIVE_DEVICE_LEASE';

/** Host-wide cross-process ownership, independent of Flutter VM endpoints. */
export class DeviceLeaseManager {
  readonly rootDir: string;
  constructor(private readonly options: DeviceLeaseOptions = {}) {
    this.rootDir = options.rootDir ?? options.delegation?.rootDir ?? join(homedir(), '.fliwright', 'device-leases');
  }
  static fromEnvironment(environment: Record<string, string | undefined> = process.env): DeviceLeaseManager {
    const encoded = environment[NATIVE_DEVICE_LEASE_ENV];
    if (!encoded) return new DeviceLeaseManager();
    let delegation: DeviceLeaseDelegation;
    try { delegation = JSON.parse(encoded); } catch { throw invalidDelegation(); }
    if (!delegation || typeof delegation.rootDir !== 'string' || !isAbsolute(delegation.rootDir)
      || !/^[a-f0-9]{64}$/.test(delegation.key) || !/^[a-f0-9]{64}$/.test(delegation.token)) throw invalidDelegation();
    return new DeviceLeaseManager({ delegation });
  }
  async acquire(platform: 'android' | 'ios', deviceIdentity: string, options: { signal?: AbortSignal } = {}): Promise<DeviceLease> {
    if (!deviceIdentity) throw new NativeError('precondition_failed', 'Device lease requires a stable identity.');
    const key = deviceLeaseKey(platform, deviceIdentity);
    const lockPath = join(this.rootDir, `${key}.lock`);
    const dirtyPath = join(this.rootDir, `${key}.dirty`);
    const recoveryClaimPath = join(this.rootDir, `${key}.recovery`);
    if (this.options.delegation) return acquireDelegated(this.options.delegation, this.rootDir, key, platform, options.signal, this.options.retryDelayMs ?? 50);
    await mkdir(this.rootDir, { recursive: true, mode: 0o700 });
    const owner: Owner = { token: randomUUID(), pid: process.pid, createdAt: new Date().toISOString() };
    while (true) {
      if (options.signal?.aborted) throw cancelled();
      if (await exists(recoveryClaimPath)) throw new NativeError('device_busy', 'Device recovery has exclusive ownership; inspect its recovery claim before reuse.');
      if (await exists(dirtyPath)) throw new NativeError('cleanup_failed', 'Device is quarantined. Confirm prior processes stopped and restore its baseline before explicit recovery.');
      try {
        await mkdir(lockPath, { mode: 0o700 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        const current = await readOwner(lockPath);
        if (current && !isAlive(current.pid)) {
          throw new NativeError('cleanup_failed', 'A previous device owner exited without confirmed cleanup; explicit recovery is required.');
        }
        if (!current) {
          const modified = await stat(lockPath).catch(() => undefined);
          if (modified && Date.now() - modified.mtimeMs > 15_000) throw new NativeError('cleanup_failed', 'Device lock has no valid owner; confirm cleanup before explicit recovery.');
        }
        try { await delay(this.options.retryDelayMs ?? 50, undefined, { signal: options.signal }); }
        catch { throw cancelled(); }
        continue;
      }
      try {
        // Recovery can reserve a quarantined device with no old lock. Recheck
        // after mkdir so acquisition cannot race through its reservation.
        if (await exists(recoveryClaimPath)) throw new NativeError('device_busy', 'Device recovery has exclusive ownership.');
        if (await exists(dirtyPath)) throw new NativeError('cleanup_failed', 'Device was quarantined during acquisition.');
        await persistOwner(lockPath, owner);
        if (options.signal?.aborted) throw cancelled();
      } catch (error) {
        await rm(lockPath, { recursive: true, force: true });
        throw error;
      }
      let released: Promise<void> | undefined;
      let grant: DeviceLeaseDelegation | undefined;
      const deviceBindings = new Map<string, import('./android/AndroidDeviceBinding.js').AndroidDeviceBinding>();
      const assertOwned = async () => {
        if (released || (await readOwner(lockPath))?.token !== owner.token) throw invalidDelegation();
        if (await exists(dirtyPath)) throw new NativeError('cleanup_failed', 'Native device ownership is quarantined.');
      };
      return {
        key,
        recoveryPath: join(lockPath, 'app-recovery.json'),
        permissionRecoveryPath: join(lockPath, 'permission-recovery.json'),
        deviceRecoveryPath: join(lockPath, 'device-recovery.json'),
        iosRunnerRecoveryPath: join(lockPath, 'ios-runner-recovery.json'),
        recoveryBinding: { leaseKey: key, ownerGeneration: hash(owner.token) },
        assertOwned,
        async verifyAndroidDevice(input, context) {
          const isAvd = deviceIdentity.startsWith('avd:');
          if (isAvd ? !input.avdName || 'avd:' + input.avdName !== deviceIdentity
            : input.avdName !== undefined || input.deviceId !== deviceIdentity) {
            throw new NativeError('device_mismatch', 'Android native automation requires the lease for its discovered stable device identity.');
          }
          const { AndroidDeviceBinding } = await import('./android/AndroidDeviceBinding.js');
          const id = `${input.deviceId}\0${input.avdName}`;
          let binding = deviceBindings.get(id);
          if (!binding) {
            binding = new AndroidDeviceBinding({ path: join(lockPath, 'device-recovery.json'), deviceId: input.deviceId,
              avdName: input.avdName, adbPath: input.adbPath, binding: { leaseKey: key, ownerGeneration: hash(owner.token) },
              executor: input.executor, assertOwned });
            deviceBindings.set(id, binding);
          }
          await binding.verify(context);
        },
        async completeAndroidDevice(input, context) {
          const id = input.deviceId + '\0' + input.avdName;
          const binding = deviceBindings.get(id);
          if (binding) await binding.complete(context);
        },
        runExclusive: (action, signal) => runDeviceOperation(lockPath, assertOwned, action, signal, this.options.retryDelayMs ?? 50),
        runOwnedTool: action => withNativeToolOwnership(leaseToolScope(lockPath, owner, assertOwned), action),
        async delegate() {
          await assertOwned();
          if (grant) return { ...grant };
          const token = randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '');
          await writeFile(join(lockPath, 'delegation.json'), JSON.stringify({ ownerToken: owner.token, tokenHash: hash(token) } satisfies Grant), { mode: 0o600, flag: 'wx' });
          grant = { rootDir: resolve(lockPath, '..'), key, token };
          return { ...grant };
        },
        async quarantine(_reason) {
          if ((await readOwner(lockPath))?.token !== owner.token) throw new NativeError('cleanup_failed', 'Device lease ownership changed during cleanup.');
          // Do not persist arbitrary error text, which can contain paths or credentials.
          await writeFile(dirtyPath, JSON.stringify({ owner: owner.token, createdAt: new Date().toISOString(), reason: 'cleanup-unconfirmed' }), { mode: 0o600 });
        },
        release() {
          return released ??= (async () => {
            if ((await readOwner(lockPath))?.token !== owner.token) throw new NativeError('cleanup_failed', 'Cannot release a device lease owned by another process.');
            if (await exists(join(lockPath, 'device-recovery.json'))) {
              await writeFile(dirtyPath, JSON.stringify({ createdAt: new Date().toISOString(), reason: 'device-cleanup-unconfirmed' }), { mode: 0o600 });
              throw new NativeError('cleanup_failed', 'Device identity recovery evidence remains; its record and device lock were retained.');
            }
            if (await exists(join(lockPath, 'permission-recovery.json'))) {
              await writeFile(dirtyPath, JSON.stringify({ createdAt: new Date().toISOString(), reason: 'permission-cleanup-unconfirmed' }), { mode: 0o600 });
              throw new NativeError('cleanup_failed', 'Permission recovery evidence remains; its record and device lock were retained.');
            }
            if (await exists(join(lockPath, 'native-tool-recovery.json'))) {
              await writeFile(dirtyPath, JSON.stringify({ createdAt: new Date().toISOString(), reason: 'host-tool-cleanup-unconfirmed' }), { mode: 0o600 });
              throw new NativeError('cleanup_failed', 'A long-lived native host tool remains; its process evidence and device lock were retained.');
            }
            if (await exists(join(lockPath, 'ios-runner-recovery.json'))) {
              await writeFile(dirtyPath, JSON.stringify({ createdAt: new Date().toISOString(), reason: 'device-cleanup-unconfirmed' }), { mode: 0o600 });
              throw new NativeError('cleanup_failed', 'Simulator Runner recovery evidence remains; its record and device lock were retained.');
            }
            if (await exists(join(lockPath, 'app-recovery.json'))) {
              await writeFile(dirtyPath, JSON.stringify({ createdAt: new Date().toISOString(), reason: 'app-cleanup-unconfirmed' }), { mode: 0o600 });
              throw new NativeError('cleanup_failed', 'Managed app cleanup is unconfirmed; its recovery record and device lock were retained.');
            }
            try { await mkdir(join(lockPath, 'delegate.lock'), { mode: 0o700 }); }
            catch (error) {
              if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
              await writeFile(dirtyPath, JSON.stringify({ createdAt: new Date().toISOString(), reason: 'delegate-cleanup-unconfirmed' }), { mode: 0o600 });
              throw new NativeError('cleanup_failed', 'Delegated device ownership is still active; the device was quarantined and its lock retained.');
            }
            try { await mkdir(join(lockPath, 'operation.lock'), { mode: 0o700 }); }
            catch (error) {
              if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
              await writeFile(dirtyPath, JSON.stringify({ createdAt: new Date().toISOString(), reason: 'operation-cleanup-unconfirmed' }), { mode: 0o600 });
              throw new NativeError('cleanup_failed', 'Native platform work is still active; the device was quarantined and its lock retained.');
            }
            await rm(lockPath, { recursive: true, force: true });
          })();
        },
      };
    }
  }
}

/** Internal shared identity; no raw device identifier is persisted in lease reports. */
export function deviceLeaseKey(platform: 'android' | 'ios', deviceIdentity: string): string {
  const canonical = platform === 'ios' ? deviceIdentity.toLowerCase() : deviceIdentity;
  return createHash('sha256').update(`${hostname()}\0${platform}\0${canonical}`).digest('hex');
}

async function acquireDelegated(grant: DeviceLeaseDelegation, rootDir: string, key: string, platform: 'android' | 'ios', signal: AbortSignal | undefined, retryMs: number): Promise<DeviceLease> {
  if (grant.key !== key || resolve(grant.rootDir) !== resolve(rootDir)) throw invalidDelegation();
  const lockPath = join(rootDir, `${key}.lock`), claimPath = join(lockPath, 'delegate.lock'), dirtyPath = join(rootDir, `${key}.dirty`);
  const owner = await readOwner(lockPath);
  if (!owner) throw invalidDelegation();
  const validate = async () => {
    const current = await readOwner(lockPath);
    let stored: Grant | undefined;
    try { stored = JSON.parse(await readFile(join(lockPath, 'delegation.json'), 'utf8')); } catch { /* A revoked grant is never reacquired. */ }
    if (!owner || !current || current.token !== owner.token || !isAlive(current.pid)
      || stored?.ownerToken !== current.token || stored?.tokenHash !== hash(grant.token)) throw invalidDelegation();
  };
  const claim: Owner = { token: randomUUID(), pid: process.pid, createdAt: new Date().toISOString() };
  for (;;) {
    if (signal?.aborted) throw cancelled();
    await validate();
    if (await exists(dirtyPath)) throw new NativeError('cleanup_failed', 'Delegated device is quarantined; restore its baseline before reuse.');
    try { await mkdir(claimPath, { mode: 0o700 }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw invalidDelegation();
      const current = await readOwner(claimPath);
      if (current && !isAlive(current.pid)) {
        throw new NativeError('cleanup_failed', 'A delegated device owner exited without confirmed cleanup.');
      }
      const details = !current ? await stat(claimPath).catch(() => undefined) : undefined;
      if (details && Date.now() - details.mtimeMs > 15_000) throw new NativeError('cleanup_failed', 'Delegated device lock has no confirmed owner.');
      try { await delay(retryMs, undefined, { signal }); } catch { throw cancelled(); }
      continue;
    }
    try {
      await persistOwner(claimPath, claim);
      await validate();
      if (signal?.aborted) throw cancelled();
    } catch (error) { await rm(claimPath, { recursive: true, force: true }); throw error; }
    break;
  }
  const lifetime = new AbortController();
  let released: Promise<void> | undefined;
  const deviceBindings = new Map<string, import('./android/AndroidDeviceBinding.js').AndroidDeviceBinding>();
  const assertOwned = async () => {
    if (released) throw invalidDelegation();
    await validate();
    if ((await readOwner(claimPath))?.token !== claim.token) throw invalidDelegation();
    if (await exists(dirtyPath)) throw new NativeError('cleanup_failed', 'Delegated native device ownership is quarantined.');
  };
  let checking = false;
  const monitor = setInterval(() => {
    if (checking) return;
    checking = true;
    void assertOwned().catch(error => { lifetime.abort(error); clearInterval(monitor); }).finally(() => { checking = false; });
  }, 100);
  monitor.unref();
  return {
    key, signal: lifetime.signal, assertOwned,
    ...(platform === 'ios' ? { iosRunnerRecoveryPath: join(lockPath, 'ios-runner-recovery.json'),
      recoveryBinding: { leaseKey: key, ownerGeneration: hash(owner.token) } } : {}),
    async verifyAndroidDevice(input, context) {
      const stableIdentity = input.avdName ? 'avd:' + input.avdName : input.deviceId;
      if (deviceLeaseKey('android', stableIdentity) !== key) {
        throw new NativeError('device_mismatch', 'Delegated Android automation requires the lease for its discovered stable device identity.');
      }
      const { AndroidDeviceBinding } = await import('./android/AndroidDeviceBinding.js');
      const id = `${input.deviceId}\0${input.avdName}`;
      let binding = deviceBindings.get(id);
      if (!binding) {
        binding = new AndroidDeviceBinding({ path: join(lockPath, 'device-recovery.json'), deviceId: input.deviceId,
          avdName: input.avdName, adbPath: input.adbPath, binding: { leaseKey: key, ownerGeneration: hash(owner.token) },
          executor: input.executor, readOnly: true, assertOwned });
        deviceBindings.set(id, binding);
      }
      await binding.verify(context);
    },
    runExclusive: (action, signal) => runDeviceOperation(lockPath, assertOwned, action, signal, retryMs),
    runOwnedTool: action => withNativeToolOwnership({ path: join(claimPath, 'native-tool-recovery.json'), operationToken: claim.token,
      assertOwned: async () => {
        await assertOwned();
        if ((await readOwner(claimPath))?.token !== claim.token) throw invalidDelegation();
      } }, action),
    async quarantine(_reason) {
      await assertOwned();
      await writeFile(dirtyPath, JSON.stringify({ createdAt: new Date().toISOString(), reason: 'delegate-cleanup-unconfirmed' }), { mode: 0o600 });
    },
    release() {
      return released ??= (async () => {
        clearInterval(monitor);
        lifetime.abort(cancelled());
        try { await validate(); }
        catch (error) { throw new NativeError('cleanup_failed', 'Parent device ownership was lost during delegated cleanup.', { cause: error }); }
        if ((await readOwner(claimPath))?.token !== claim.token) throw new NativeError('cleanup_failed', 'Delegated device ownership changed during cleanup.');
        if (await exists(join(claimPath, 'native-tool-recovery.json'))) {
          await writeFile(dirtyPath, JSON.stringify({ createdAt: new Date().toISOString(), reason: 'host-tool-cleanup-unconfirmed' }), { mode: 0o600 });
          throw new NativeError('cleanup_failed', 'A delegated native host tool remains; its process evidence and device lock were retained.');
        }
        await rm(claimPath, { recursive: true, force: true });
      })();
    },
  };
}
async function runDeviceOperation<T>(lockPath: string, assertOwned: () => Promise<void>, action: () => Promise<T>,
  signal: AbortSignal | undefined, retryMs: number): Promise<T> {
  const operationPath = join(lockPath, 'operation.lock');
  const owner: Owner = { token: randomUUID(), pid: process.pid, createdAt: new Date().toISOString() };
  for (;;) {
    if (signal?.aborted) throw cancelled();
    await assertOwned();
    try { await mkdir(operationPath, { mode: 0o700 }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const current = await readOwner(operationPath);
      const details = !current ? await stat(operationPath).catch(() => undefined) : undefined;
      if ((current && !isAlive(current.pid)) || (details && Date.now() - details.mtimeMs > 15000)) {
        throw new NativeError('cleanup_failed', 'Native platform work exited without confirmed cleanup; explicit device recovery is required.');
      }
      try { await delay(retryMs, undefined, { signal }); } catch { throw cancelled(); }
      continue;
    }
    let written = false;
    let failed = false, primary: unknown;
    try {
      await persistOwner(operationPath, owner); written = true;
      await assertOwned();
      if (signal?.aborted) throw cancelled();
      return await withNativeToolOwnership({ path: join(operationPath, 'tool-recovery.json'), operationToken: owner.token,
        assertOwned: async () => {
          await assertOwned();
          if ((await readOwner(operationPath))?.token !== owner.token) throw new NativeError('cleanup_failed', 'Native tool operation ownership changed.');
        } }, action);
    } catch (error) {
      failed = true; primary = error; throw error;
    } finally {
      try {
        if (written && (await readOwner(operationPath))?.token !== owner.token) {
          throw new NativeError('cleanup_failed', 'Native platform operation ownership changed during cleanup.');
        }
        if (await exists(join(operationPath, 'tool-recovery.json'))) {
          throw new NativeError('cleanup_failed', 'Native tool work has retained recovery evidence; its operation lock was preserved.');
        }
        await rm(operationPath, { recursive: true, force: true });
      } catch (cleanup) {
        if (failed) throw new AggregateError([primary, cleanup], 'Native platform operation and its cleanup both failed.');
        throw cleanup;
      }
    }
  }
}
function hash(token: string): string { return createHash('sha256').update(token).digest('hex'); }
function leaseToolScope(lockPath: string, owner: Owner, assertOwned: () => Promise<void>): NativeToolOwnershipScope {
  return { path: join(lockPath, 'native-tool-recovery.json'), operationToken: owner.token, assertOwned: async () => {
    await assertOwned();
    if ((await readOwner(lockPath))?.token !== owner.token) throw new NativeError('cleanup_failed', 'Native tool lease ownership changed.');
  } };
}
function invalidDelegation(): NativeError { return new NativeError('device_mismatch', 'Native device ownership delegation is invalid, revoked or belongs to another device.'); }
async function readOwner(lockPath: string): Promise<Owner | undefined> {
  try {
    const value = JSON.parse(await readFile(join(lockPath, 'owner.json'), 'utf8')) as Partial<Owner>;
    return typeof value.token === 'string' && Number.isSafeInteger(value.pid) && value.pid! > 0 ? value as Owner : undefined;
  } catch { return undefined; }
}
async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}
function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH'; }
}
function cancelled(): NativeError { return new NativeError('cancelled', 'Device lease acquisition cancelled.'); }
async function persistOwner(path: string, owner: Owner): Promise<void> {
  const file = await open(join(path, 'owner.json'), 'wx', 0o600);
  try { await file.writeFile(JSON.stringify(owner)); await file.sync(); } finally { await file.close(); }
  for (const directoryPath of [path, dirname(path)]) {
    const directory = await open(directoryPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY);
    try { await directory.sync(); } finally { await directory.close(); }
  }
}
