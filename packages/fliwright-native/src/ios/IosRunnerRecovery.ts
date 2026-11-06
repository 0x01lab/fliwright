import { randomUUID } from 'node:crypto';
import { rename } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { NativeError, type NativeConfig, type NativeOperationContext } from '@fliwright/core';
import { DeviceLeaseManager, deviceLeaseKey } from '../DeviceLease.js';
import { inspectDeviceLease, inspectIosRecoveryCandidate, type DeviceLeaseInspectionInput } from '../DeviceRecovery.js';
import { RecoveryTransaction, inspectRecoveryTransaction, syncDirectory } from '../RecoveryTransaction.js';
import { withNativeToolOwnership } from '../NativeToolOwnership.js';
import { executeTool, type ToolExecutor } from '../ToolExecutor.js';
import { readSimulatorBootGeneration, readSimulatorRunnerPids } from './IosSimulatorIdentity.js';
import { RunnerRecoveryClient } from './RunnerRecoveryClient.js';

import { readRecoveryOriginal, recoveryPathExists } from '../RecoveryEvidence.js';
interface Options {
  fingerprint: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  xcrunPath?: string;
  executor?: ToolExecutor;
  /** Internal fault-injection seam. Never supplied by project config, CLI or Worker input. */
  onBoundary?(name: string): Promise<void>;
}

/** Internal narrow restorer: valid owner-bound Runner plus exited host tools only. */
export async function restoreIosRunnerRecovery(input: DeviceLeaseInspectionInput, options: Options) {
  const timeout = options.timeoutMs ?? 15000;
  if (input.platform !== 'ios' || !/^[a-f0-9]{64}$/.test(options.fingerprint) || !Number.isSafeInteger(timeout) || timeout < 1 || timeout > 600000) throw failure();
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
  // The caller is bounded; the actual work retains its epoch until it settles.
  return Promise.race([work, cancelled]).finally(() => { if (abort) context.signal.removeEventListener('abort', abort); });
}

async function restore(input: DeviceLeaseInspectionInput, options: Options, context: NativeOperationContext) {
  const report = await inspectDeviceLease(input);
  if (report.fingerprint !== options.fingerprint) throw failure();
  const root = new DeviceLeaseManager({ rootDir: input.rootDir }).rootDir, key = deviceLeaseKey('ios', input.deviceId);
  const path = join(root, `${key}.recovery`), reservation = await recoveryPathExists(path) ? await inspectRecoveryTransaction(path) : undefined;
  if (report.recovery === 'live') throw new NativeError('device_busy', 'Recovery is still owned by another process or host tool.');
  if (reservation && !reservation.valid) throw failure();
  const initial = await readRecoveryOriginal(root, key, path);
  if ((initial.lockArchived || initial.dirtyArchived) && !['archiving', 'archived', 'retired'].includes(reservation?.checkpoint?.phase ?? '')) throw failure();
  await inspectIosRecoveryCandidate(input, initial);
  const binding = reservation?.checkpoint ? { deviceKey: key, fingerprint: reservation.checkpoint.fingerprint, originalDigest: reservation.checkpoint.originalDigest }
    : { deviceKey: key, fingerprint: options.fingerprint, originalDigest: initial.digest };
  if (initial.digest !== binding.originalDigest || (await inspectDeviceLease(input)).fingerprint !== options.fingerprint) throw failure();
  check(context);
  const tx = await RecoveryTransaction.claim(path, binding, options.onBoundary);
  let retired = false;
  const boundary = async (name: string) => { await options.onBoundary?.(name); check(context); };
  const guard = async () => {
    check(context); await tx.assertOwned();
    const source = await readRecoveryOriginal(root, key, path);
    if (source.digest !== binding.originalDigest) throw failure();
    await inspectIosRecoveryCandidate(input, source);
    check(context);
  };
  try {
    await boundary('claimed'); await guard();
    const candidate = await inspectIosRecoveryCandidate(input, await readRecoveryOriginal(root, key, path)), saved = candidate.runner;
    const config: NativeConfig = { enabled: true, platform: 'ios', deviceId: input.deviceId, targetAppId: saved.bundleId,
      tools: options.xcrunPath ? { xcrun: options.xcrunPath } : undefined };
    const executor: ToolExecutor = async (tool, args, operation) => {
      await guard();
      const result = await (options.executor ?? executeTool)(tool, args, operation);
      check(context); await guard(); return result;
    };
    const readback = async () => {
      return withNativeToolOwnership({ path: tx.toolPath, operationToken: tx.operationToken, assertOwned: guard }, async () => {
        const boot = await readSimulatorBootGeneration(config, context, executor);
        if (boot !== saved.simulatorBootedAt) throw new NativeError('device_mismatch', 'Simulator boot generation changed; original evidence was retained.');
        const pids = await readSimulatorRunnerPids(config, context, executor);
        if (await readSimulatorBootGeneration(config, context, executor) !== boot) throw new NativeError('device_mismatch', 'Simulator rebooted during recovery readback.');
        return { boot, pids };
      });
    };
    let observed = await readback();
    if (observed.pids.length && tx.current.phase === 'claimed' && !tx.current.shutdownPending && saved.phase === 'running') {
      if (observed.pids[0] !== saved.runnerPid) throw new NativeError('device_mismatch', 'Runner PID differs from the recorded generation.');
      const control = new RunnerRecoveryClient({ deviceId: input.deviceId, sessionId: saved.sessionId, generation: saved.generation,
        simulatorBootedAt: saved.simulatorBootedAt, runnerPid: saved.runnerPid!, recoveryKey: saved.recoveryKey, recoveryPort: saved.recoveryPort! });
      await control.request('identify', context); await guard();
      observed = await readback();
      if (observed.pids[0] !== saved.runnerPid) throw new NativeError('device_mismatch', 'Runner changed during authentication.');
      await tx.checkpoint('shutdown-pending'); await boundary('shutdown-pending'); await guard();
      try { await control.request('shutdown', context); }
      catch (error) { if (!(error instanceof NativeError) || error.code !== 'action_outcome_unknown') throw error; }
      await boundary('shutdown-dispatched');
    }
    // A pending write survives takeover. Never repeat it, even if no ACK or dispatch proof survived.
    do {
      observed = await readback();
      if (!observed.pids.length) break;
      await delay(Math.min(50, Math.max(1, context.deadline - Date.now())), undefined, { signal: context.signal }).catch(() => check(context));
    } while (true);
    if (['claimed', 'shutdown-pending'].includes(tx.current.phase)) {
      await tx.checkpoint('readback-completed', observed.boot); await boundary('readback-completed');
    } else if (tx.current.completionBoot !== observed.boot) throw failure();
    if (tx.current.phase === 'readback-completed') { await tx.checkpoint('archiving'); await boundary('archiving'); }
    await guard();
    let source = await readRecoveryOriginal(root, key, path);
    if (!source.lockArchived) {
      await rename(source.lockPath, join(path, 'original.lock'));
      await boundary('lock-renamed'); await syncDirectory(path); await boundary('lock-destination-synced'); await syncDirectory(root); await boundary('lock-synced');
    }
    await guard(); source = await readRecoveryOriginal(root, key, path);
    if (source.dirtyPresent && !source.dirtyArchived) {
      await rename(source.dirtyPath, join(path, 'original.dirty'));
      await boundary('dirty-renamed'); await syncDirectory(path); await boundary('dirty-destination-synced'); await syncDirectory(root); await boundary('dirty-synced');
    }
    await guard(); observed = await readback();
    if (observed.pids.length || observed.boot !== tx.current.completionBoot) throw failure();
    if (tx.current.phase === 'archiving') { await tx.checkpoint('archived'); await boundary('archived'); }
    await guard();
    const archiveDirectory = await tx.retire(); retired = true;
    // This seam follows the last durable step; failure here must not attempt to recreate exclusion.
    await options.onBoundary?.('retired');
    return { status: 'retired' as const, transactionId: tx.current.transactionId, archiveDirectory };
  } catch (error) {
    // Await all work before ending an epoch; malformed/changed/live-tool evidence refuses this too.
    if (!retired) {
      try { await tx.suspend(); }
      catch (cleanup) { throw new AggregateError([error, cleanup], 'Recovery failed and its ownership epoch remains unresolved.'); }
    }
    throw error;
  }
}

function check(context: NativeOperationContext): void {
  if (context.signal.aborted || Date.now() >= context.deadline) throw new NativeError(
    context.signal.reason instanceof DOMException && context.signal.reason.name !== 'TimeoutError' ? 'cancelled' : 'timeout',
    'Runner recovery was cancelled or its total budget expired; exclusion was retained.');
}
function failure(): NativeError { return new NativeError('cleanup_failed', 'iOS Runner recovery evidence is stale, changed or outside this restorer; preserve its original records.'); }
