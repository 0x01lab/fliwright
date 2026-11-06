import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { NativeError, type NativeConfig, type NativeOperationContext } from '@fliwright/core';
import { DeviceLeaseManager, deviceLeaseKey } from './DeviceLease.js';
import { inspectNativeToolProcess, isNativeToolRecord } from './NativeToolOwnership.js';
import { decodeAndroidRecoveryApp, decodeAndroidRecoveryPermission, inspectAndroidAppJournal, inspectAndroidPermissionJournal } from './android/AndroidRecoveryRecords.js';
import { androidAvdKey, isAndroidDeviceRecord } from './android/AndroidDeviceBinding.js';
import { isIosRunnerRecord } from './ios/IosRunnerJournal.js';
import { readSimulatorBootGeneration, readSimulatorRunnerPids } from './ios/IosSimulatorIdentity.js';
import { executeTool, type ToolExecutor } from './ToolExecutor.js';
import { inspectRecoveryTransaction, readPrivateRecord } from './RecoveryTransaction.js';

export interface DeviceLeaseInspectionInput {
  platform: 'android' | 'ios';
  deviceId: string;
  /** Private local storage override, intended for embedding and isolated tests. */
  rootDir?: string;
}
export type DeviceLeaseProcessState = 'absent' | 'live' | 'exited' | 'invalid';
export type DeviceLeaseRecordState = 'absent' | 'present' | 'invalid';
export interface DeviceLeaseInspection {
  schemaVersion: 1;
  deviceKey: string;
  /** Evidence identity only; not a platform readiness or restoration receipt. */
  fingerprint: string;
  state: 'available' | 'owned' | 'quarantined' | 'recovery-required' | 'recovering';
  owner: DeviceLeaseProcessState;
  delegate: DeviceLeaseProcessState;
  operation: DeviceLeaseProcessState;
  /** Owned platform-tool wrapper or group; a dead operation owner alone is insufficient. */
  hostTool: DeviceLeaseProcessState;
  recovery: DeviceLeaseProcessState;
  quarantine: DeviceLeaseRecordState;
  appRecord: DeviceLeaseRecordState;
  permissionRecord: DeviceLeaseRecordState;
  deviceRecord: DeviceLeaseRecordState;
  iosRunnerRecord: DeviceLeaseRecordState;
  issues: string[];
}

interface Owner { token: string; pid: number; createdAt: string; }
interface Evidence {
  state: DeviceLeaseRecordState;
  identity: string;
  value?: Record<string, unknown>;
}
interface Inventory { report: DeviceLeaseInspection; evidenceFingerprint: string; recoveryFingerprint: string; recoveryOwner?: Owner; }

/** Reads bounded local evidence without acquiring ownership, running tools or creating storage. */
export async function inspectDeviceLease(input: DeviceLeaseInspectionInput): Promise<DeviceLeaseInspection> {
  const { rootDir, key } = location(input);
  return (await inventory(rootDir, key, input.platform, input.deviceId)).report;
}

export interface IosRunnerRecoveryInspection {
  status: 'runner-absent' | 'runner-matches-record' | 'runner-mismatch';
  recordedBootGenerationMatches: boolean;
}

/** Online read-only reconciliation before an explicit Simulator Runner restore. */
export async function inspectIosRunnerRecovery(input: DeviceLeaseInspectionInput,
  options: { xcrunPath?: string; executor?: ToolExecutor; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<IosRunnerRecoveryInspection> {
  if (input.platform !== 'ios') throw failure('iOS Runner recovery requires an iOS device identity.');
  const timeoutMs = options.timeoutMs ?? 5000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 600000) throw failure('Invalid iOS Runner inspection budget.');
  const context: NativeOperationContext = { requestId: randomUUID(), deadline: Date.now() + timeoutMs,
    signal: AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(options.signal ? [options.signal] : [])]) };
  check(context.signal);
  const { rootDir, key } = location(input), before = await inventory(rootDir, key, 'ios', input.deviceId);
  const report = before.report;
  if (report.issues.length !== 1 || report.issues[0] !== 'unresolved-ios-runner' || report.iosRunnerRecord !== 'present'
    || report.recovery !== 'absent'
    || [report.owner, report.delegate, report.operation, report.hostTool].some(state => state === 'live' || state === 'invalid')) {
    throw failure('Device evidence is not an isolated, owner-bound iOS Runner recovery candidate.');
  }
  const evidence = await record(join(rootDir, `${key}.lock`, 'ios-runner-recovery.json'));
  if (evidence.state !== 'present' || !isIosRunnerRecord(evidence.value)) throw failure('iOS Runner recovery evidence changed during inspection.');
  const afterRead = await inventory(rootDir, key, 'ios', input.deviceId);
  if (afterRead.report.fingerprint !== report.fingerprint) throw failure('iOS Runner recovery evidence changed during inspection.');
  const config: NativeConfig = { enabled: true, platform: 'ios', deviceId: input.deviceId, targetAppId: 'dev.fliwright.NativeRunner.xctrunner',
    tools: options.xcrunPath ? { xcrun: options.xcrunPath } : undefined };
  const executor = options.executor ?? executeTool;
  check(context.signal);
  const currentBootGeneration = await readSimulatorBootGeneration(config, context, executor);
  check(context.signal);
  const pids = await readSimulatorRunnerPids(config, context, executor);
  check(context.signal);
  const finalBootGeneration = await readSimulatorBootGeneration(config, context, executor);
  check(context.signal);
  if (finalBootGeneration !== currentBootGeneration) throw failure('Simulator boot generation changed during platform readback.');
  const current = await inventory(rootDir, key, 'ios', input.deviceId);
  check(context.signal);
  if (current.report.fingerprint !== report.fingerprint) throw failure('iOS Runner recovery evidence changed during platform readback.');
  const sameBoot = evidence.value.simulatorBootedAt === currentBootGeneration;
  const status = pids.length === 0 ? 'runner-absent'
    : evidence.value.phase === 'running' && sameBoot && pids[0] === evidence.value.runnerPid ? 'runner-matches-record' : 'runner-mismatch';
  return { status, recordedBootGenerationMatches: sameBoot };
}

/** Internal recovery reservation. Releasing it never removes quarantine or old evidence. */
export interface DeviceRecoveryClaim {
  readonly signal: AbortSignal;
  readonly inspection: DeviceLeaseInspection;
  assertOwned(): Promise<void>;
  runExclusive<T>(action: (signal: AbortSignal) => Promise<T>): Promise<T>;
  release(): Promise<void>;
}

/** Reserve only the exact inspected evidence. Live or malformed owners are never adopted. */
export async function claimDeviceRecovery(input: DeviceLeaseInspectionInput,
  options: { fingerprint: string; signal?: AbortSignal; timeoutMs?: number }): Promise<DeviceRecoveryClaim> {
  const { rootDir, key } = location(input);
  if (!/^[a-f0-9]{64}$/.test(options.fingerprint) || !Number.isSafeInteger(options.timeoutMs ?? 15000)
    || (options.timeoutMs ?? 15000) <= 0 || (options.timeoutMs ?? 15000) > 600000) throw failure('Invalid recovery inspection or budget.');
  const signal = AbortSignal.any([AbortSignal.timeout(options.timeoutMs ?? 15000), ...(options.signal ? [options.signal] : [])]);
  check(signal);
  const before = await inventory(rootDir, key, input.platform, input.deviceId);
  check(signal);
  validateClaim(before, options.fingerprint);
  const path = join(rootDir, `${key}.recovery`);
  const owner: Owner = { token: randomUUID(), pid: process.pid, createdAt: new Date().toISOString() };
  try { await mkdir(path, { mode: 0o700 }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw busy();
    throw failure('Recovery reservation could not be created.', error);
  }
  const createdDirectory = (await directory(path)).identity;
  let ownerWritten = false;
  let claimedFingerprint = '';
  try {
    const file = await open(join(path, 'owner.json'), 'wx', 0o600);
    try { await file.writeFile(JSON.stringify(owner)); await file.sync(); } finally { await file.close(); }
    ownerWritten = true;
    await syncDirectory(path); await syncDirectory(rootDir);
    check(signal);
    const after = await inventory(rootDir, key, input.platform, input.deviceId);
    if (after.report.issues.length || after.recoveryOwner?.token !== owner.token || after.evidenceFingerprint !== before.evidenceFingerprint) {
      throw failure('Device evidence changed while recovery was being reserved.');
    }
    claimedFingerprint = after.recoveryFingerprint;
  } catch (error) {
    // Never discard a reservation that cannot be identified as our own.
    try {
      if (ownerWritten && (await directory(path)).identity === createdDirectory && (await ownerRecord(join(path, 'owner.json'))).owner?.token === owner.token) {
        await rm(path, { recursive: true }); await syncDirectory(rootDir);
      }
    } catch (cleanup) { throw new AggregateError([error, cleanup], 'Recovery reservation and its cleanup both failed.'); }
    throw error;
  }
  let released = false, closing: Promise<void> | undefined, active: Promise<unknown> | undefined;
  const assertOwned = async () => {
    check(signal);
    if (released || closing) throw failure('Recovery reservation is closed.');
    const current = await inventory(rootDir, key, input.platform, input.deviceId);
    check(signal);
    if (current.report.issues.length || current.recoveryOwner?.token !== owner.token || current.recoveryFingerprint !== claimedFingerprint || current.evidenceFingerprint !== before.evidenceFingerprint) {
      throw failure('Recovery ownership or original evidence changed; quarantine was retained.');
    }
  };
  return {
    signal, inspection: structuredClone(before.report), assertOwned,
    runExclusive(action) {
      if (active || closing || released) return Promise.reject(busy());
      const work = (async () => {
        await assertOwned();
        const result = await Promise.resolve().then(() => action(signal)).then(value => ({ ok: true as const, value }), error => ({ ok: false as const, error }));
        try { await assertOwned(); }
        catch (error) {
          if (!result.ok) throw new AggregateError([result.error, error], 'Recovery work failed and its ownership or cancellation check also failed.');
          throw error;
        }
        if (!result.ok) throw result.error;
        return result.value;
      })();
      active = work;
      void work.then(() => { if (active === work) active = undefined; }, () => { if (active === work) active = undefined; });
      let abort: (() => void) | undefined;
      const cancelled = new Promise<never>((_, reject) => {
        abort = () => { try { check(signal); } catch (error) { reject(error); } };
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
      });
      // The caller's deadline is bounded, but exclusion follows actual work,
      // including an action which ignores cancellation and returns much later.
      return Promise.race([work, cancelled]).finally(() => { if (abort) signal.removeEventListener('abort', abort); });
    },
    release() {
      if (active) return Promise.reject(failure('Recovery work is still active; its reservation was retained.'));
      return closing ??= (async () => {
        const current = await inventory(rootDir, key, input.platform, input.deviceId);
        if (current.report.issues.length || current.recoveryOwner?.token !== owner.token || current.recoveryFingerprint !== claimedFingerprint || current.evidenceFingerprint !== before.evidenceFingerprint) {
          throw failure('Recovery evidence changed during release; its reservation was retained.');
        }
        await rm(path, { recursive: true }); await syncDirectory(rootDir);
        released = true;
      })();
    },
  };
}

function validateClaim(current: Inventory, fingerprint: string): void {
  const report = current.report;
  if ([report.owner, report.delegate, report.operation, report.hostTool, report.recovery].includes('live')) throw busy();
  if (report.fingerprint !== fingerprint || report.issues.length || report.recovery !== 'absent') {
    throw failure('Recovery evidence is stale, malformed or already reserved; preserve the original records.');
  }
  if (report.state !== 'quarantined' && report.state !== 'recovery-required') throw failure('No quarantined or abandoned device evidence requires recovery.');
}

async function inventory(rootDir: string, key: string, platform: 'android' | 'ios', deviceId: string,
  original?: { lockPath: string; dirtyPath: string }): Promise<Inventory> {
  const root = await directory(rootDir), lockPath = original?.lockPath ?? join(rootDir, `${key}.lock`);
  const lock = root.state === 'present' ? await directory(lockPath) : absent();
  const recoveryPath = join(rootDir, `${key}.recovery`);
  const recovery = root.state === 'present' ? await directory(recoveryPath) : absent();
  const issues: string[] = [];
  if (root.state === 'invalid') issues.push('invalid-storage');
  if (lock.state === 'invalid') issues.push('invalid-lock');
  const dirty = root.state === 'present' ? await record(original?.dirtyPath ?? join(rootDir, `${key}.dirty`)) : absent();
  if (dirty.state === 'invalid' || dirty.state === 'present' && !validDirty(dirty.value!)) issues.push('invalid-quarantine');
  const owner = lock.state === 'present' ? await ownerRecord(join(lockPath, 'owner.json')) : { evidence: absent(), state: 'absent' as const };
  if (lock.state === 'present' && ['invalid', 'absent'].includes(owner.state)) issues.push('invalid-owner');
  const delegate = lock.state === 'present' ? await processDirectory(join(lockPath, 'delegate.lock'), true) : emptyProcess();
  const operation = lock.state === 'present' ? await processDirectory(join(lockPath, 'operation.lock'), true) : emptyProcess();
  const operationTool = lock.state === 'present' && operation.state !== 'absent' && operation.state !== 'invalid'
    ? await record(join(lockPath, 'operation.lock', 'tool-recovery.json')) : absent();
  const leaseTool = lock.state === 'present' ? await record(join(lockPath, 'native-tool-recovery.json')) : absent();
  const delegateTool = lock.state === 'present' ? await record(join(lockPath, 'delegate.lock', 'native-tool-recovery.json')) : absent();
  const operationToolState = await inspectToolEvidence(operationTool, operation.owner);
  const leaseToolState = await inspectToolEvidence(leaseTool, owner.owner);
  const delegateToolState = await inspectToolEvidence(delegateTool, delegate.owner);
  const hostTool = combineToolStates([operationToolState, leaseToolState, delegateToolState]);
  if (hostTool === 'invalid') issues.push('invalid-host-tool');
  if (delegate.state === 'invalid') issues.push('invalid-delegate');
  if (operation.state === 'invalid') issues.push('invalid-operation');
  const app = lock.state === 'present' ? await record(join(lockPath, 'app-recovery.json')) : absent();
  const permission = lock.state === 'present' ? await record(join(lockPath, 'permission-recovery.json')) : absent();
  const device = lock.state === 'present' ? await record(join(lockPath, 'device-recovery.json')) : absent();
  const iosRunner = lock.state === 'present' ? await record(join(lockPath, 'ios-runner-recovery.json')) : absent();
  const deviceValue = device.value;
  const validDevice = device.state === 'present' && isAndroidDeviceRecord(deviceValue);
  if (device.state === 'invalid' || device.state === 'present' && (!validDevice || platform !== 'android')) issues.push('invalid-device-record');
  if (validDevice && (!hasOwnerBinding(deviceValue, key, owner.owner)
    || (deviceId.startsWith('avd:') ? deviceValue.avdKey !== androidAvdKey(deviceId.slice(4)) : deviceValue.serialKey !== digest(`android\0${deviceId}`)))) {
    issues.push('inconsistent-device-record');
  }
  const validIosRunner = iosRunner.state === 'present' && isIosRunnerRecord(iosRunner.value);
  if (iosRunner.state === 'invalid' || iosRunner.state === 'present' && (!validIosRunner || platform !== 'ios')) {
    issues.push('invalid-ios-runner-record');
  } else if (validIosRunner) {
    const runnerValue = iosRunner.value!;
    if (!hasOwnerBinding(runnerValue, key, owner.owner)
      || runnerValue.deviceKey !== digest(`ios\0${deviceId.toLowerCase()}`)) issues.push('inconsistent-ios-runner-record');
    else issues.push('unresolved-ios-runner');
  }
  const serialKey = validDevice ? deviceValue.serialKey : digest(`android\0${deviceId}`);
  if (app.state === 'invalid') issues.push('invalid-app-record');
  if (permission.state === 'invalid') issues.push('invalid-permission-record');
  const appCompatibility = platform === 'android' && app.state === 'present' ? inspectAndroidAppJournal(app.value!) : undefined;
  const permissionCompatibility = platform === 'android' && permission.state === 'present'
    ? inspectAndroidPermissionJournal(permission.value!) : undefined;
  if (app.state === 'present' && appCompatibility === 'invalid') issues.push('invalid-app-record');
  else if (app.state === 'present' && (appCompatibility === 'legacy' || !hasOwnerBinding(app.value!, key, owner.owner))) issues.push('unbound-app-record');
  if (permission.state === 'present' && permissionCompatibility === 'invalid') issues.push('invalid-permission-record');
  else if (permission.state === 'present' && (permissionCompatibility === 'legacy' || !hasOwnerBinding(permission.value!, key, owner.owner))) issues.push('unbound-permission-record');
  if (platform === 'android' && app.state === 'present' && appCompatibility === 'bound'
    && (!hasOwnerBinding(app.value!, key, owner.owner) || app.value!.deviceKey !== serialKey)) issues.push('inconsistent-android-records');
  if (platform === 'android' && permission.state === 'present' && permissionCompatibility === 'bound'
    && (!hasOwnerBinding(permission.value!, key, owner.owner) || permission.value!.deviceKey !== serialKey)) issues.push('inconsistent-android-records');
  if (platform === 'android' && permissionCompatibility === 'bound'
    && (permission.value!.appSha256 === null || permission.value!.appInstalledBySession === null || app.state === 'absent')) {
    issues.push('incomplete-android-installation');
  }
  if (platform === 'android' && app.state === 'present' && permission.state === 'present'
    && appCompatibility === 'bound' && permissionCompatibility === 'bound'
    && !consistentAndroidRecords(app.value!, permission.value!)) issues.push('inconsistent-android-records');
  const delegation = lock.state === 'present' ? await record(join(lockPath, 'delegation.json')) : absent();
  if (delegation.state === 'invalid' || delegation.state === 'present' && !validGrant(delegation.value!)) issues.push('invalid-delegation');
  let entries: string[] = [];
  if (lock.state === 'present') {
    entries = await readdir(lockPath).catch(() => ['unreadable']);
    if (entries.some(name => !['owner.json', 'delegation.json', 'delegate.lock', 'operation.lock', 'app-recovery.json', 'permission-recovery.json', 'device-recovery.json', 'native-tool-recovery.json', 'ios-runner-recovery.json'].includes(name))) issues.push('unrecognized-records');
  }
  let recoveryOwner = recovery.state === 'present' ? await ownerRecord(join(recoveryPath, 'owner.json')) : { evidence: absent(), state: recovery.state === 'invalid' ? 'invalid' as const : 'absent' as const };
  const recoveryEntries = recovery.state === 'present' ? await readdir(recoveryPath).catch(() => ['unreadable']) : [];
  const transaction = recovery.state === 'present' && !recoveryEntries.includes('owner.json') ? await inspectRecoveryTransaction(recoveryPath) : undefined;
  if (transaction?.valid) {
    recoveryOwner = { evidence: { state: 'present', identity: transaction.identity }, state: transaction.state, owner: transaction.owner };
    if (!transaction.owner) issues.push('incomplete-recovery-transaction');
    else if (transaction.checkpoint?.deviceKey !== key) issues.push('invalid-recovery-claim');
  } else if (recovery.state === 'invalid' || recovery.state === 'present' && (recoveryOwner.state === 'invalid' || recoveryOwner.state === 'absent' || recoveryEntries.some(name => name !== 'owner.json'))) issues.push('invalid-recovery-claim');
  // Recheck enclosing directory identities after reading their bounded records.
  if ((await directory(rootDir)).identity !== root.identity || (root.state === 'present' && (await directory(lockPath)).identity !== lock.identity)
    || (root.state === 'present' && (await directory(recoveryPath)).identity !== recovery.identity)) issues.push('changed-during-inspection');
  const evidenceFingerprint = digest(JSON.stringify([root.identity, lock.identity, dirty.identity, owner.evidence.identity, owner.state,
    delegate.identity, delegate.state, operation.identity, operation.state, operationTool.identity, leaseTool.identity, delegateTool.identity, hostTool,
    app.identity, permission.identity, device.identity, iosRunner.identity, delegation.identity, entries.sort()]));
  const recoveryFingerprint = digest(JSON.stringify([recovery.identity, recoveryOwner.evidence.identity, recoveryOwner.state, recoveryEntries.sort()]));
  const quarantine = dirty.state === 'present' && !validDirty(dirty.value!) ? 'invalid' : dirty.state;
  const state = recoveryOwner.state === 'live' ? 'recovering' : quarantine !== 'absent' ? 'quarantined'
    : owner.state === 'live' ? 'owned' : lock.state !== 'absent' || recovery.state !== 'absent' || issues.length ? 'recovery-required' : 'available';
  const issueCodes = [...new Set(issues)];
  const stableFingerprint = digest(JSON.stringify([evidenceFingerprint, recoveryFingerprint, issueCodes]));
  return { evidenceFingerprint, recoveryFingerprint, recoveryOwner: recoveryOwner.owner, report: { schemaVersion: 1, deviceKey: key, fingerprint: stableFingerprint, state,
    owner: owner.state, delegate: delegate.state, operation: operation.state, hostTool, recovery: recoveryOwner.state,
    quarantine, appRecord: app.state, permissionRecord: permission.state, deviceRecord: device.state,
    iosRunnerRecord: iosRunner.state, issues: issueCodes } };
}

async function directory(path: string): Promise<Evidence> {
  try {
    const details = await lstat(path);
    return { state: details.isDirectory() && !details.isSymbolicLink() ? 'present' : 'invalid',
      identity: JSON.stringify([details.dev, details.ino, details.mode]) };
  } catch (error) { return missing(error) ? absent() : { state: 'invalid', identity: 'unreadable' }; }
}
async function record(path: string): Promise<Evidence> {
  try {
    const current = await readPrivateRecord(path);
    return { state: 'present', identity: current.identity, value: current.value };
  } catch (error) { return missing(error) ? absent() : { state: 'invalid', identity: 'unreadable' }; }
}
async function ownerRecord(path: string): Promise<{ evidence: Evidence; state: DeviceLeaseProcessState; owner?: Owner }> {
  const evidence = await record(path);
  if (evidence.state === 'absent') return { evidence, state: 'absent' };
  if (evidence.state !== 'present' || !validOwner(evidence.value!)) return { evidence, state: 'invalid' };
  const owner = evidence.value as unknown as Owner;
  let live = true;
  try { process.kill(owner.pid, 0); } catch (error) { live = (error as NodeJS.ErrnoException).code !== 'ESRCH'; }
  return { evidence, state: live ? 'live' : 'exited', owner };
}
async function processDirectory(path: string, allowTool = false): Promise<{ identity: string; state: DeviceLeaseProcessState; owner?: Owner }> {
  const dir = await directory(path);
  if (dir.state !== 'present') return { identity: dir.identity, state: dir.state === 'invalid' ? 'invalid' : 'absent' };
  const owner = await ownerRecord(join(path, 'owner.json'));
  const entries = await readdir(path).catch(() => ['unreadable']);
  const changed = (await directory(path)).identity !== dir.identity;
  return { identity: digest(JSON.stringify([dir.identity, owner.evidence.identity, entries.sort(), changed])),
    owner: owner.owner,
    state: changed || owner.state === 'absent' || entries.some(name => name !== 'owner.json' && (!allowTool || !['tool-recovery.json', 'native-tool-recovery.json'].includes(name))) ? 'invalid' : owner.state };
}
function emptyProcess(): { identity: string; state: DeviceLeaseProcessState; owner?: Owner } { return { identity: 'absent', state: 'absent' }; }
async function inspectToolEvidence(evidence: Evidence, owner?: Owner): Promise<DeviceLeaseProcessState> {
  if (evidence.state === 'absent') return 'absent';
  if (evidence.state !== 'present' || !owner) return 'invalid';
  const value = evidence.value!;
  if (!isNativeToolRecord(value) || value.operationToken !== owner.token || value.ownerPid !== owner.pid || value.phase === 'reserved') return 'invalid';
  return inspectNativeToolProcess(value);
}
function combineToolStates(states: DeviceLeaseProcessState[]): DeviceLeaseProcessState {
  if (states.includes('invalid')) return 'invalid';
  if (states.includes('live')) return 'live';
  if (states.includes('exited')) return 'exited';
  return 'absent';
}
function hasOwnerBinding(value: Record<string, unknown>, key: string, owner?: Owner): boolean {
  return !!owner && value.leaseKey === key && value.ownerGeneration === digest(owner.token);
}
function consistentAndroidRecords(app: Record<string, unknown>, permission: Record<string, unknown>): boolean {
  return app.deviceKey === permission.deviceKey && app.leaseKey === permission.leaseKey
    && app.ownerGeneration === permission.ownerGeneration && app.appId === permission.appId && app.uid === permission.uid
    && (permission.appSha256 === null || app.sha256 === permission.appSha256)
    && (permission.appInstalledBySession === null || app.installedBySession === permission.appInstalledBySession);
}
function absent(): Evidence { return { state: 'absent', identity: 'absent' }; }
function digest(value: string | Buffer): string { return createHash('sha256').update(value).digest('hex'); }
function missing(error: unknown): boolean { return (error as NodeJS.ErrnoException).code === 'ENOENT'; }
function validOwner(value: Record<string, unknown>): boolean {
  return typeof value.token === 'string' && value.token.length > 0 && value.token.length <= 128
    && Number.isSafeInteger(value.pid) && (value.pid as number) > 0 && typeof value.createdAt === 'string' && Number.isFinite(Date.parse(value.createdAt))
    && Object.keys(value).every(key => ['token', 'pid', 'createdAt'].includes(key));
}
function validDirty(value: Record<string, unknown>): boolean {
  return typeof value.createdAt === 'string' && Number.isFinite(Date.parse(value.createdAt))
    && ['cleanup-unconfirmed', 'permission-cleanup-unconfirmed', 'app-cleanup-unconfirmed', 'delegate-cleanup-unconfirmed', 'operation-cleanup-unconfirmed', 'host-tool-cleanup-unconfirmed', 'device-cleanup-unconfirmed'].includes(value.reason as string)
    && (value.owner === undefined || typeof value.owner === 'string') && Object.keys(value).every(key => ['createdAt', 'reason', 'owner'].includes(key));
}
function validGrant(value: Record<string, unknown>): boolean {
  return typeof value.ownerToken === 'string' && typeof value.tokenHash === 'string' && /^[a-f0-9]{64}$/.test(value.tokenHash)
    && Object.keys(value).every(key => ['ownerToken', 'tokenHash'].includes(key));
}
function location(input: DeviceLeaseInspectionInput): { rootDir: string; key: string } {
  if (!input || !['ios', 'android'].includes(input.platform) || typeof input.deviceId !== 'string' || !input.deviceId.trim() || input.deviceId.includes('\0')
    || input.rootDir !== undefined && (typeof input.rootDir !== 'string' || !input.rootDir || input.rootDir.includes('\0'))) throw failure('A valid explicit device and local lease storage are required.');
  return { rootDir: resolve(new DeviceLeaseManager({ rootDir: input.rootDir }).rootDir), key: deviceLeaseKey(input.platform, input.deviceId) };
}
async function syncDirectory(path: string): Promise<void> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY);
  try { await file.sync(); } finally { await file.close(); }
}
function check(signal: AbortSignal): void {
  if (signal.aborted) throw new NativeError(signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError' ? 'timeout' : 'cancelled', 'Recovery reservation was cancelled or its budget expired.');
}
function failure(message: string, cause?: unknown): NativeError { return new NativeError('cleanup_failed', message, cause === undefined ? undefined : { cause }); }
function busy(): NativeError { return new NativeError('device_busy', 'A device owner, operation or recovery reservation is still active.'); }

/** Internal journal-specific qualification, including archived originals on explicit resume. */
export async function inspectIosRecoveryCandidate(input: DeviceLeaseInspectionInput, original?: { lockPath: string; dirtyPath: string }) {
  if (input.platform !== 'ios') throw failure('Only iOS Runner evidence can be restored by this transaction.');
  const { rootDir, key } = location(input), current = await inventory(rootDir, key, 'ios', input.deviceId, original);
  const report = current.report;
  if ([report.owner, report.delegate, report.operation, report.hostTool].some(state => state === 'live')) throw busy();
  const candidateIssues = report.issues.filter(issue => issue !== 'incomplete-recovery-transaction');
  if (candidateIssues.length !== 1 || candidateIssues[0] !== 'unresolved-ios-runner'
    || [report.owner, report.delegate, report.operation, report.hostTool].some(state => state === 'invalid')
    || [report.appRecord, report.permissionRecord, report.deviceRecord].some(state => state !== 'absent')) {
    throw failure('Evidence is not an isolated, valid owner-bound iOS Runner recovery candidate.');
  }
  const lockPath = original?.lockPath ?? join(rootDir, `${key}.lock`);
  const runner = await readPrivateRecord(join(lockPath, 'ios-runner-recovery.json'));
  if (!isIosRunnerRecord(runner.value)) throw failure('Runner recovery record changed.');
  const oldOwner = await ownerRecord(join(lockPath, 'owner.json'));
  const quarantine = await record(original?.dirtyPath ?? join(rootDir, `${key}.dirty`));
  if (quarantine.value?.owner !== undefined && quarantine.value.owner !== oldOwner.owner?.token) throw failure('Quarantine belongs to a different original owner.');
  if ((await inventory(rootDir, key, 'ios', input.deviceId, original)).report.fingerprint !== report.fingerprint) throw failure('Recovery candidate changed during qualification.');
  return { rootDir, key, report, runner: runner.value };
}

/** Internal Android restoration qualification. No platform work, adoption or evidence mutation. */
export async function inspectAndroidRecoveryCandidate(input: DeviceLeaseInspectionInput, original?: { lockPath: string; dirtyPath: string }) {
  if (input.platform !== 'android' || !/^avd:[\w.-]+$/.test(input.deviceId)) throw failure('Android recovery requires a dedicated emulator identity.');
  const { rootDir, key } = location(input), current = await inventory(rootDir, key, 'android', input.deviceId, original), report = current.report;
  if ([report.owner, report.delegate, report.operation, report.hostTool].some(state => state === 'live')) throw busy();
  if (report.issues.some(issue => issue !== 'incomplete-recovery-transaction')
    || [report.owner, report.delegate, report.operation, report.hostTool].some(state => state === 'invalid')
    || report.deviceRecord !== 'present' || report.appRecord !== 'present' || report.iosRunnerRecord !== 'absent') {
    throw failure('Evidence is not a complete, owner-bound Android recovery candidate.');
  }
  const lockPath = original?.lockPath ?? join(rootDir, `${key}.lock`);
  const app = decodeAndroidRecoveryApp((await readPrivateRecord(join(lockPath, 'app-recovery.json'))).value);
  const permission = report.permissionRecord === 'present'
    ? decodeAndroidRecoveryPermission((await readPrivateRecord(join(lockPath, 'permission-recovery.json'))).value) : undefined;
  const device = (await readPrivateRecord(join(lockPath, 'device-recovery.json'))).value;
  if (!isAndroidDeviceRecord(device) || app.operation === 'forward' && !app.forward) throw failure('Android forward allocation or device identity is unresolved.');
  const quarantine = await record(original?.dirtyPath ?? join(rootDir, `${key}.dirty`));
  const owner = await ownerRecord(join(lockPath, 'owner.json'));
  if (quarantine.value?.owner !== undefined && quarantine.value.owner !== owner.owner?.token) throw failure('Quarantine belongs to another owner.');
  if ((await inventory(rootDir, key, 'android', input.deviceId, original)).report.fingerprint !== report.fingerprint) throw failure('Android evidence changed during qualification.');
  return { rootDir, key, report, app, permission, device };
}
