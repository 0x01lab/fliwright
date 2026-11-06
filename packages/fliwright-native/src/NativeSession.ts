import { NativeError, NativeRuntime, nativeConfigSchema, type NativeConfig, type NativeRuntimeOptions, type NativeSessionAdapter, type NativeOperationContext } from '@fliwright/core';
import { DeviceDiscovery, type DeviceInventory, type DiscoveredDevice } from '@fliwright/devices';
import { AdbSession } from './android/AdbSession.js';
import { DeviceLeaseManager, type DeviceLease } from './DeviceLease.js';
import { preflightXctestSession, startXctestSession } from './ios/XctestRunner.js';
import type { ToolExecutor } from './ToolExecutor.js';

export interface CreateNativeSessionOptions {
  signal?: AbortSignal;
  runtime?: Omit<NativeRuntimeOptions, 'signal' | 'systemAppIds' | 'externalAppIds'>;
  leaseManager?: Pick<DeviceLeaseManager, 'acquire'>;
  discovery?: { scan(options: { platforms: Array<'android' | 'ios'>; signal?: AbortSignal }): Promise<DeviceInventory> };
  /** Extension seam; construction happens only after device ownership is acquired. */
  createAdapter?: (device: DiscoveredDevice, config: NativeConfig, signal?: AbortSignal) => Promise<NativeSessionAdapter>;
  /** @internal Parent-owned Android binding verification for managed and delegated sessions. */
  verifyDeviceIdentity?: (context: NativeOperationContext) => Promise<void>;
  /** @internal Read-only identity observations used by the parent-owned verifier. */
  deviceExecutor?: ToolExecutor;
}

/** Resolve and own one explicit device before constructing its platform adapter. */
export async function createNativeSession(config: NativeConfig, options: CreateNativeSessionOptions = {}): Promise<NativeRuntime> {
  const validation = nativeConfigSchema.safeParse(config);
  if (!validation.success) throw new NativeError('precondition_failed', 'Invalid native configuration; check platform, backend, device, IDs and positive time budgets.');
  config = validation.data;
  if (!config.enabled) throw new NativeError('precondition_failed', 'Native automation is disabled in the run configuration.');
  if (!config.deviceId || !config.targetAppId) throw new NativeError('precondition_failed', 'Native automation requires an explicit device and target application.');
  if (!options.createAdapter && config.backend && config.backend !== (config.platform === 'android' ? 'adb' : 'xctest')) {
    throw new NativeError('precondition_failed', 'Selected native backend does not match the platform.');
  }
  const inventory = await (options.discovery ?? new DeviceDiscovery({ tools: config.tools })).scan({ platforms: [config.platform], signal: options.signal });
  const device = inventory.devices.find(item => item.id === config.deviceId && item.platform === config.platform);
  if (!device || device.state !== 'online') throw new NativeError('device_mismatch', `The selected native device is not online (${device?.state ?? 'not discovered'}). Check device authorization and native doctor diagnostics.`);
  if (!options.createAdapter && config.platform === 'ios' && device.kind !== 'simulator') throw new NativeError('unsupported_capability', 'Physical iOS devices require a verified signing and transport setup.');
  // Read-only prerequisites must not poison a device lease on harmless setup errors.
  if (!options.createAdapter && config.platform === 'ios') await preflightXctestSession(config);
  const stableId = device.kind === 'simulator' && device.avdName ? `avd:${device.avdName}` : device.id;
  const lease = await (options.leaseManager ?? DeviceLeaseManager.fromEnvironment()).acquire(config.platform, stableId, { signal: options.signal });
  const signal = AbortSignal.any([...(options.signal ? [options.signal] : []), ...(lease.signal ? [lease.signal] : [])]);
  let adapter: NativeSessionAdapter | undefined;
  try {
    await lease.assertOwned?.();
    signal.throwIfAborted();
    const initialize = async () => {
      signal.throwIfAborted();
      adapter = options.createAdapter ? await options.createAdapter(device, config, signal)
        : config.platform === 'ios' ? await startXctestSession(config, signal, action => lease.runOwnedTool ? lease.runOwnedTool(action) : action(),
          lease.iosRunnerRecoveryPath && lease.recoveryBinding ? { path: lease.iosRunnerRecoveryPath,
            binding: lease.recoveryBinding, assertOwned: async () => { await lease.assertOwned?.(); } } : undefined)
        : new AdbSession({ deviceId: device.id, appId: config.targetAppId, kind: device.kind, adbPath: config.tools?.adb, fingerprints: config.fingerprints,
          beforeCommand: options.verifyDeviceIdentity ? options.verifyDeviceIdentity : lease.verifyAndroidDevice
            ? context => lease.verifyAndroidDevice!({ deviceId: device.id, avdName: device.avdName, adbPath: config.tools?.adb,
              executor: options.deviceExecutor }, context)
            : undefined });
      if (adapter.identity.deviceId !== config.deviceId || adapter.identity.appId !== config.targetAppId || adapter.identity.platform !== config.platform) {
        throw new NativeError('device_mismatch', 'Native adapter identity differs from the selected device/application.');
      }
      if (signal.aborted) throw new NativeError('cancelled', 'Native session initialization cancelled.');
    };
    // Runner construction can touch the device before its first Adapter request.
    if (lease.runExclusive) await lease.runExclusive(initialize, signal);
    else await initialize();
    return new NativeRuntime(withLease(adapter!, lease, config.cleanupTimeoutMs ?? 15_000, config, device, options), {
      ...options.runtime, signal, timeoutMs: config.timeoutMs ?? options.runtime?.timeoutMs,
      systemAppIds: config.systemAppIds ?? defaultSystemApps(config.platform), externalAppIds: config.externalAppIds,
    });
  } catch (error) {
    const errors: unknown[] = [error];
    if (adapter) {
      try { await closeAdapter(adapter, lease, config.cleanupTimeoutMs ?? 15_000); }
      catch (cleanup) { errors.push(cleanup); }
    } else {
      try { await lease.quarantine('Native adapter initialization did not complete.'); }
      catch (quarantine) { errors.push(quarantine); }
      try { await lease.release(); } catch (release) { errors.push(release); }
    }
    if (errors.length > 1) throw new AggregateError(errors, 'Native initialization and its cleanup failed.');
    throw error;
  }
}

function withLease(adapter: NativeSessionAdapter, lease: DeviceLease, timeout: number, config: NativeConfig,
  device: DiscoveredDevice, options: CreateNativeSessionOptions): NativeSessionAdapter {
  let disposed: Promise<void> | undefined;
  const dispose = () => disposed ??= closeAdapter(adapter, lease, timeout, config, device, options)
    .finally(() => lease.signal?.removeEventListener('abort', onLeaseLost));
  const onLeaseLost = () => { void dispose().catch(() => undefined); };
  lease.signal?.addEventListener('abort', onLeaseLost, { once: true });
  if (lease.signal?.aborted) onLeaseLost();
  const run = <T>(context: NativeOperationContext, action: () => Promise<T>): Promise<T> => {
    const execute = async () => {
      await lease.assertOwned?.();
      if (config.platform === 'android' && options.verifyDeviceIdentity) await options.verifyDeviceIdentity(context);
      else if (config.platform === 'android' && lease.verifyAndroidDevice) {
        await lease.verifyAndroidDevice({ deviceId: device.id, avdName: device.avdName, adbPath: config.tools?.adb,
          executor: options.deviceExecutor }, context);
      }
      return action();
    };
    return lease.runExclusive ? lease.runExclusive(execute, context.signal) : execute();
  };
  return {
    identity: adapter.identity,
    capabilities: context => run(context, () => adapter.capabilities(context)),
    snapshot: (context, query) => run(context, () => adapter.snapshot(context, query)),
    execute: (command, context) => run(context, () => adapter.execute(command, context)),
    screenshot: context => run(context, () => adapter.screenshot(context)),
    dispose,
  };
}
async function closeAdapter(adapter: NativeSessionAdapter, lease: DeviceLease, timeout: number, config?: NativeConfig,
  device?: DiscoveredDevice, options?: CreateNativeSessionOptions): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const errors: unknown[] = [];
  let entered = false;
  try {
    const dispose = () => lease.runExclusive ? lease.runExclusive(async () => {
      entered = true;
      await adapter.dispose();
      if (config?.platform === 'android' && device && !options?.verifyDeviceIdentity) {
        const context = { requestId: 'native-close-' + Date.now(), deadline: Date.now() + timeout, signal: AbortSignal.timeout(timeout) };
        await lease.completeAndroidDevice?.({ deviceId: device.id, avdName: device.avdName, adbPath: config.tools?.adb,
          executor: options?.deviceExecutor }, context);
      }
    }, AbortSignal.timeout(timeout))
      : (entered = true, adapter.dispose());
    await Promise.race([dispose(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new NativeError('cleanup_failed', 'Native adapter cleanup timed out.')), timeout);
    })]);
  } catch (error) {
    errors.push(error);
    if (!entered) {
      try { await adapter.dispose(); }
      catch (cleanup) { errors.push(cleanup); }
    }
    try { await lease.quarantine('Native adapter cleanup was not confirmed.'); }
    catch (quarantine) { errors.push(quarantine); }
  } finally { clearTimeout(timer); }
  try { await lease.release(); } catch (release) { errors.push(release); }
  if (errors.length) throw new NativeError('cleanup_failed', 'Native adapter cleanup or lease release failed; device recovery is required.', {
    cause: errors.length === 1 ? errors[0] : new AggregateError(errors, 'Native adapter cleanup, quarantine or release failed.'),
  });
}
function defaultSystemApps(platform: 'android' | 'ios'): string[] {
  return platform === 'android' ? ['com.android.permissioncontroller', 'com.google.android.permissioncontroller', 'com.android.documentsui',
    'com.google.android.documentsui', 'com.android.providers.media.module', 'com.google.android.providers.media.module', 'com.android.systemui']
    : ['com.apple.springboard', 'com.apple.mobileslideshow', 'com.apple.PhotosUI.PhotosPicker'];
}
