import { createHash, randomUUID } from 'node:crypto';
import { rename } from 'node:fs/promises';
import { join } from 'node:path';
import { NativeError, type NativeOperationContext } from '@fliwright/core';
import { DeviceLeaseManager, deviceLeaseKey } from '../DeviceLease.js';
import { inspectAndroidRecoveryCandidate, inspectDeviceLease, type DeviceLeaseInspectionInput } from '../DeviceRecovery.js';
import { RecoveryTransaction, inspectRecoveryTransaction, syncDirectory } from '../RecoveryTransaction.js';
import { readRecoveryOriginal, recoveryPathExists } from '../RecoveryEvidence.js';
import { withNativeToolOwnership } from '../NativeToolOwnership.js';
import { executeTool, quoteAndroidShell, type ToolExecutor } from '../ToolExecutor.js';
import { AndroidRecoveryPlatform } from './AndroidRecoveryPlatform.js';

interface Options {
  serial: string;
  fingerprint: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  adbPath?: string;
  executor?: ToolExecutor;
  /** Internal fault injection. Not accepted from config, CLI or Worker. */
  onBoundary?(name: string): Promise<void>;
}

/** Serial-bound worker; public callers resolve and verify serial through AndroidRecoveryApi. */
export async function restoreAndroidRecovery(input: DeviceLeaseInspectionInput, options: Options) {
  const timeout = options.timeoutMs ?? 30000;
  if (input.platform !== 'android' || !/^avd:[\w.-]+$/.test(input.deviceId) || !/^emulator-\d+$/.test(options.serial) && options.executor === undefined
    || !options.serial || options.serial.startsWith('-') || /[\s\0]/.test(options.serial)
    || !/^[a-f0-9]{64}$/.test(options.fingerprint) || !Number.isSafeInteger(timeout) || timeout < 1 || timeout > 600000) throw failure();
  options = { ...options }; input = { ...input };
  const context: NativeOperationContext = { requestId: randomUUID(), deadline: Date.now() + timeout,
    signal: AbortSignal.any([AbortSignal.timeout(timeout), ...(options.signal ? [options.signal] : [])]) };
  check(context);
  const work = restore(input, options, context);
  let abort: (() => void) | undefined;
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => { try { check(context); } catch (error) { reject(error); } };
    context.signal.addEventListener('abort', abort, { once: true });
    if (context.signal.aborted) abort();
  });
  return Promise.race([work, cancelled]).finally(() => { if (abort) context.signal.removeEventListener('abort', abort); });
}

async function restore(input: DeviceLeaseInspectionInput, options: Options, context: NativeOperationContext) {
  const report = await inspectDeviceLease(input);
  if (report.fingerprint !== options.fingerprint) throw failure();
  if (report.recovery === 'live') throw new NativeError('device_busy', 'Another recovery process or host tool is still active.');
  const root = new DeviceLeaseManager({ rootDir: input.rootDir }).rootDir, key = deviceLeaseKey('android', input.deviceId), path = join(root, `${key}.recovery`);
  const previous = await recoveryPathExists(path) ? await inspectRecoveryTransaction(path) : undefined;
  if (previous && !previous.valid) throw failure();
  const source = await readRecoveryOriginal(root, key, path), saved = await inspectAndroidRecoveryCandidate(input, source);
  if ((source.lockArchived || source.dirtyArchived) && !['archiving', 'archived', 'retired'].includes(previous?.checkpoint?.phase ?? '')) throw failure();
  const binding = previous?.checkpoint ? { deviceKey: key, fingerprint: previous.checkpoint.fingerprint, originalDigest: previous.checkpoint.originalDigest }
    : { deviceKey: key, fingerprint: options.fingerprint, originalDigest: source.digest };
  if (source.digest !== binding.originalDigest || (await inspectDeviceLease(input)).fingerprint !== options.fingerprint) throw failure();
  check(context);
  const tx = await RecoveryTransaction.claim(path, binding, options.onBoundary);
  let retired = false;
  const boundary = async (name: string) => { await options.onBoundary?.(name); check(context); };
  const guard = async () => {
    check(context); await tx.assertOwned();
    const current = await readRecoveryOriginal(root, key, path);
    if (current.digest !== binding.originalDigest) throw failure();
    await inspectAndroidRecoveryCandidate(input, current); check(context);
  };
  const owned = <T>(action: () => Promise<T>) => withNativeToolOwnership({ path: tx.toolPath,
    operationToken: tx.operationToken, assertOwned: guard }, action);
  const platform = new AndroidRecoveryPlatform({ serial: options.serial, avdName: input.deviceId.slice(4), app: saved.app,
    permission: saved.permission, devicePath: async () => join((await readRecoveryOriginal(root, key, path)).lockPath, 'device-recovery.json'),
    executor: options.executor ?? executeTool, adbPath: options.adbPath, guard, context });
  const allowRemoved = () => saved.app.installedBySession && (['uninstall', 'removed'].includes(saved.app.operation)
    || tx.current.action?.id === 'app.uninstall');
  const observe = () => owned(() => platform.observe(allowRemoved(), allowRemoved()));
  type State = Awaited<ReturnType<typeof observe>>;
  const permissions = { camera: 'android.permission.CAMERA', microphone: 'android.permission.RECORD_AUDIO' } as const;
  const appId = quoteAndroidShell(saved.app.appId);
  const actions: Array<{ id: string; args: string[]; satisfied(state: State): boolean }> = [
    { id: 'app.stop', args: ['shell', `am force-stop --user 0 ${appId}`], satisfied: state => state.stopped && state.uidProcesses === 0 },
  ];
  for (const original of saved.permission?.baseline ?? []) {
    const name = original.permission, target = `${appId} ${quoteAndroidShell(permissions[name])}`;
    const current = (state: State) => state.permissions.find(item => item.permission === name);
    actions.push({ id: `permission.${name}.grant`, args: ['shell', `pm ${original.granted ? 'grant' : 'revoke'} --user 0 ${target}`],
      satisfied: state => current(state)?.granted === original.granted });
    actions.push({ id: `permission.${name}.clear-flags`, args: ['shell', `pm clear-permission-flags --user 0 ${target} user-set user-fixed`],
      satisfied: state => current(state)?.userSet === false && current(state)?.userFixed === false });
    if (original.userSet || original.userFixed) {
      const flags = [original.userSet ? 'user-set' : '', original.userFixed ? 'user-fixed' : ''].filter(Boolean).join(' ');
      actions.push({ id: `permission.${name}.set-flags`, args: ['shell', `pm set-permission-flags --user 0 ${target} ${flags}`],
        satisfied: state => current(state)?.userSet === original.userSet && current(state)?.userFixed === original.userFixed });
    }
  }
  actions.push({ id: 'permissions.readback', args: [], satisfied: state => (saved.permission?.baseline ?? []).every(expected => {
    const actual = state.permissions.find(item => item.permission === expected.permission);
    return !!actual && expected.granted === actual.granted && expected.userSet === actual.userSet && expected.userFixed === actual.userFixed
      && expected.flags.length === actual.flags.length && expected.flags.every(flag => actual.flags.includes(flag));
  }) });
  if (saved.app.forward) actions.push({ id: 'forward.remove', args: ['forward', '--remove', `tcp:${saved.app.forward.hostPort}`], satisfied: state => !state.forwardPresent });
  if (saved.app.installedBySession) actions.push({ id: 'app.uninstall', args: ['uninstall', saved.app.appId], satisfied: state => !state.installed && state.uidProcesses === 0 });
  // A later checkpoint does not preserve an earlier stop proof across app restarts.
  const isSatisfied = (action: typeof actions[number], state: State) => state.stopped && state.uidProcesses === 0 && action.satisfied(state);
  try {
    await boundary('claimed'); await guard();
    let state = await observe(); // Validate the whole batch, including flags/app-ops/forward, before stopping or writing.
    const pendingId = tx.current.action?.id, pendingIndex = pendingId ? actions.findIndex(item => item.id === pendingId) : -1;
    if (pendingId && pendingIndex < 0 && pendingId !== 'restoration.observe') throw failure();
    if (['claimed', 'restoring'].includes(tx.current.phase)) {
      for (const [index, action] of actions.entries()) {
        if (pendingIndex >= 0 && index < pendingIndex || !state.installed && action.id !== 'app.uninstall') continue;
        const intent = hash(JSON.stringify([binding.originalDigest, action.id, action.args]));
        const pending = tx.current.action?.id === action.id && tx.current.action.state === 'pending';
        if (tx.current.action?.id === action.id && tx.current.action.state === 'verified') {
          if (tx.current.action.intent !== intent || !isSatisfied(action, state)) throw failure();
          continue;
        }
        if (pending) {
          if (tx.current.action!.intent !== intent || !isSatisfied(action, state)) throw new NativeError('action_outcome_unknown', 'A pending Android recovery write has no confirming readback; it will not be replayed.');
        } else {
          // A completed action becoming false indicates external change, never an implicit retry.
          if (tx.current.action?.id === action.id) throw failure();
          await tx.checkpointAction({ id: action.id, intent, state: 'pending' }); await boundary(`${action.id}.pending`);
          await guard(); state = await observe();
          if (!isSatisfied(action, state)) {
            if (!action.args.length) throw failure();
            await owned(() => platform.mutate(action.args));
            await boundary(`${action.id}.dispatched`);
            state = await observe();
          }
          if (!isSatisfied(action, state)) throw new NativeError('action_outcome_unknown', 'Android restoration did not match independent platform readback.');
        }
        await tx.checkpointAction({ id: action.id, intent, state: 'verified', observation: hash(JSON.stringify(state)) });
        await boundary(`${action.id}.verified`);
      }
      state = await observe(); await assertRestored(state);
      if (!tx.current.action) {
        // A no-op recovery still persists an observed completion before archival.
        await tx.checkpointAction({ id: 'restoration.observe', intent: binding.originalDigest, state: 'pending' });
      }
      if (tx.current.action?.id === 'restoration.observe' && tx.current.action.state === 'pending') {
        await tx.checkpointAction({ id: 'restoration.observe', intent: binding.originalDigest, state: 'verified', observation: hash(JSON.stringify(state)) });
      }
      await tx.checkpoint('readback-completed', saved.device.bootKey); await boundary('readback-completed');
    } else {
      if (tx.current.completionBoot !== saved.device.bootKey) throw failure();
      await assertRestored(state);
    }
    if (tx.current.phase === 'readback-completed') { await tx.checkpoint('archiving'); await boundary('archiving'); }
    await guard(); let current = await readRecoveryOriginal(root, key, path);
    if (!current.lockArchived) {
      await rename(current.lockPath, join(path, 'original.lock')); await boundary('lock-renamed');
      await syncDirectory(path); await boundary('lock-destination-synced'); await syncDirectory(root); await boundary('lock-synced');
    }
    await guard(); current = await readRecoveryOriginal(root, key, path);
    if (current.dirtyPresent && !current.dirtyArchived) {
      await rename(current.dirtyPath, join(path, 'original.dirty')); await boundary('dirty-renamed');
      await syncDirectory(path); await boundary('dirty-destination-synced'); await syncDirectory(root); await boundary('dirty-synced');
    }
    await guard(); await assertRestored(await observe());
    if (tx.current.phase === 'archiving') { await tx.checkpoint('archived'); await boundary('archived'); }
    await guard(); const archiveDirectory = await tx.retire(); retired = true;
    return { status: 'retired' as const, transactionId: tx.current.transactionId, archiveDirectory };
  } catch (error) {
    if (!retired) {
      try { await tx.suspend(); }
      catch (cleanup) { throw new AggregateError([error, cleanup], 'Android recovery failed and ownership remains unresolved.'); }
    }
    throw error;
  }

  async function assertRestored(state: State): Promise<void> {
    if (!state.stopped || state.uidProcesses || state.forwardPresent || state.installed === saved.app.installedBySession) throw failure();
    if (!state.installed) {
      const completed = await tx.verifiedActions();
      if (saved.permission?.baseline.length && !completed.has('permissions.readback')) throw failure();
      return;
    }
    if ((saved.permission?.baseline ?? []).some(expected => {
      const actual = state.permissions.find(item => item.permission === expected.permission);
      return !actual || expected.granted !== actual.granted || expected.userSet !== actual.userSet || expected.userFixed !== actual.userFixed
        || expected.flags.length !== actual.flags.length || expected.flags.some(flag => !actual.flags.includes(flag));
    })) throw failure();
  }
}
function hash(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function check(context: NativeOperationContext): void {
  if (context.signal.aborted || Date.now() >= context.deadline) throw new NativeError(
    context.signal.reason instanceof DOMException && context.signal.reason.name !== 'TimeoutError' ? 'cancelled' : 'timeout',
    'Android recovery was cancelled or its budget expired; exclusion was retained.');
}
function failure(): NativeError { return new NativeError('cleanup_failed', 'Android recovery evidence or platform state is unverified; preserve its original records.'); }
