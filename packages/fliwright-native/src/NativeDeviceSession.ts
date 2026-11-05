import { NativeError, nativeConfigSchema, parseAndroidPermissionDeclarations, type AndroidAppObservation, type NativeConfig, type NativeRuntime, type NativeOperationOptions, type NativeOperationContext } from '@fliwright/core';
import { DeviceDiscovery } from '@fliwright/devices';
import { DeviceLeaseManager, type DeviceLeaseDelegation } from './DeviceLease.js';
import { createNativeSession, type CreateNativeSessionOptions } from './NativeSession.js';
import { preflightXctestSession } from './ios/XctestRunner.js';
import { verifyNativeAppProcess } from './NativeBinding.js';
import { randomUUID } from 'node:crypto';
import { AndroidPermissionPreparation, type AndroidPermissionState, type NativePermissionRequest } from './android/AndroidPermissionPreparation.js';
import { executeTool, type ToolExecutor } from './ToolExecutor.js';
import { AndroidManagedApp, type AndroidAppInstallInput, type AndroidInstalledApp, type AndroidAppLaunch } from './android/AndroidManagedApp.js';
import { inspectAndroidApp } from './android/AndroidAppObservation.js';
import { AndroidPermissionJournal } from './android/AndroidPermissionJournal.js';
import { AndroidDeviceBinding } from './android/AndroidDeviceBinding.js';

/** Task ownership outlives each attempt's Adapter and generation. */
export interface NativeDeviceSession {
  /** Actual discovered hardware kind; never inferred from a caller readiness flag. */
  readonly deviceKind: 'physical' | 'simulator';
  delegate?(): Promise<DeviceLeaseDelegation>;
  quarantine?(reason: string): Promise<void>;
  /** Low-level Android permission-manager preparation; full scenario support requires platform acceptance. */
  preparePermissions?(input: readonly NativePermissionRequest[], options: NativeOperationOptions & { mode: 'managed-start' }): Promise<AndroidPermissionState[]>;
  /** Managed-only Android force-stop with package/UID readback, before preparation or restoration. */
  stopApp?(options: NativeOperationOptions & { mode: 'managed-start' }): Promise<void>;
  /** Parent-only single Debug APK ownership; does not launch or grant permissions. */
  installApp?(input: AndroidAppInstallInput, options: NativeOperationOptions & { mode: 'managed-start' }): Promise<AndroidInstalledApp>;
  /** Launch the verified installed Android app without invoking flutter run or reinstalling. */
  launchApp?(options: NativeOperationOptions & { mode: 'managed-start' }): Promise<AndroidAppLaunch>;
  /** Independent read-only package-manager observation; never adopts a restoration baseline. */
  inspectPermissions?(permissions: readonly string[], options?: NativeOperationOptions): Promise<AndroidPermissionState[]>;
  /** Independent read-only installed APK/UID/PID and permission observation under the owner fence. */
  inspectAppState?(permissions: readonly string[], options?: NativeOperationOptions): Promise<AndroidAppObservation>;
  verifyAppProcess(vmPid: unknown, options?: NativeOperationOptions): Promise<void>;
  createRuntime(options?: Pick<CreateNativeSessionOptions, 'signal' | 'runtime'>): Promise<NativeRuntime>;
  /** Close platform work and restore owned app state, retaining exclusion until dispose. */
  quiesce(): Promise<void>;
  dispose(): Promise<void>;
}

export interface OpenNativeDeviceOptions extends CreateNativeSessionOptions {
  /** Internal seam for bounded permission-manager platform execution. */
  permissionExecutor?: ToolExecutor;
  /** Internal seam for bounded APK inspection, installation, launch and forwarding. */
  appExecutor?: ToolExecutor;
  /** Internal seam for read-only serial/AVD/boot/OS observations. */
  deviceExecutor?: ToolExecutor;
}

/** Acquire before the Flutter endpoint and retain ownership through all retries. */
export async function openNativeDevice(config: NativeConfig, options: OpenNativeDeviceOptions = {}): Promise<NativeDeviceSession> {
  const validation = nativeConfigSchema.safeParse(config);
  if (!validation.success || !validation.data.enabled) throw new NativeError('precondition_failed', 'Enable native automation with a valid explicit device configuration.');
  // Zod returns an independent snapshot, including tool paths and nested configuration.
  config = validation.data;
  const discovery = options.discovery ?? new DeviceDiscovery({ tools: config.tools });
  const inventory = await discovery.scan({ platforms: [config.platform], signal: options.signal });
  const device = inventory.devices.find(item => item.id === config.deviceId && item.platform === config.platform);
  if (!device || device.state !== 'online') throw new NativeError('device_mismatch', 'The selected native device is not online.');
  if (!options.createAdapter && config.platform === 'ios') {
    if (device.kind !== 'simulator') throw new NativeError('unsupported_capability', 'Physical iOS automation requires verified signing and transport.');
    await preflightXctestSession(config);
  }
  const stableId = device.kind === 'simulator' && device.avdName ? `avd:${device.avdName}` : device.id;
  const lease = await (options.leaseManager ?? DeviceLeaseManager.fromEnvironment()).acquire(config.platform, stableId, { signal: options.signal });
  const lifetime = new AbortController();
  let closed = false, dirty = false;
  let active: NativeRuntime | undefined;
  let opening: Promise<NativeRuntime> | undefined;
  let permissionWork: Promise<unknown> | undefined;
  let permissions: AndroidPermissionPreparation | undefined;
  let permissionJournal: AndroidPermissionJournal | undefined;
  let managedApp: AndroidManagedApp | undefined;
  let deviceBinding: AndroidDeviceBinding | undefined;
  const verifyDevice = async (context: NativeOperationContext) => {
    if (!lease.deviceRecoveryPath || !lease.recoveryBinding) throw new NativeError('precondition_failed', 'Managed Android mutation requires durable parent device identity evidence.');
    deviceBinding ??= new AndroidDeviceBinding({ path: lease.deviceRecoveryPath, deviceId: config.deviceId, avdName: device.avdName,
      adbPath: config.tools?.adb, binding: { ...lease.recoveryBinding }, executor: options.deviceExecutor,
      assertOwned: async () => { await lease.assertOwned?.(); } });
    await deviceBinding.verify(context);
  };
  const bindingWork = new Set<Promise<void>>();
  let quiescing: Promise<void> | undefined;
  const cleanupErrors: unknown[] = [];
  let closing: Promise<void> | undefined;
  const leaseManager: Pick<DeviceLeaseManager, 'acquire'> = {
    async acquire(platform, id, request) {
      if (closed || request?.signal?.aborted) throw new NativeError('cancelled', 'Native device ownership has closed.');
      await lease.assertOwned?.();
      if (platform !== config.platform || id !== stableId) throw new NativeError('device_mismatch', 'Native device identity changed between attempts.');
      return { key: lease.key, signal: lease.signal, assertOwned: lease.assertOwned,
        runExclusive: lease.runExclusive?.bind(lease),
        runOwnedTool: lease.runOwnedTool?.bind(lease),
        iosRunnerRecoveryPath: lease.iosRunnerRecoveryPath,
        recoveryBinding: lease.recoveryBinding,
        verifyAndroidDevice: lease.verifyAndroidDevice?.bind(lease),
        completeAndroidDevice: lease.completeAndroidDevice?.bind(lease),
        async quarantine(reason) { dirty = true; await lease.quarantine(reason); },
        async release() { active = undefined; },
      };
    },
  };
  const runAndroidPreparation = async <T>(request: NativeOperationOptions, mutation: boolean,
    action: (preparation: AndroidPermissionPreparation, context: NativeOperationContext) => Promise<T>): Promise<T> => {
    if (closed) throw new NativeError('cancelled', 'Native device ownership has closed.');
    if (dirty) throw new NativeError('cleanup_failed', 'Native preparation cleanup was not confirmed; restore the device before reuse.');
    if (permissionWork || (mutation && (active || opening))) throw new NativeError('precondition_failed', 'Dispose the native Adapter and finish preparation before changing app state.');
    if (config.platform !== 'android' || device.kind !== 'simulator') throw new NativeError('unsupported_capability', 'Android app preparation and permission observation currently require a dedicated emulator.');
    if (!lease.runExclusive) throw new NativeError('precondition_failed', 'Android app preparation requires a device owner with cross-process operation exclusion.');
    const timeout = request.timeout ?? config.timeoutMs ?? 30000;
    if (!Number.isSafeInteger(timeout) || timeout <= 0 || timeout > 120000) throw new NativeError('precondition_failed', 'Android app preparation requires a positive budget no greater than 120000ms.');
    const deadline = Date.now() + timeout;
    const signal = AbortSignal.any([AbortSignal.timeout(timeout), lifetime.signal, ...(lease.signal ? [lease.signal] : []),
      ...(options.signal ? [options.signal] : []), ...(request.signal ? [request.signal] : [])]);
    if (!permissions && lease.permissionRecoveryPath) permissionJournal = new AndroidPermissionJournal({
      path: lease.permissionRecoveryPath, deviceId: config.deviceId, appId: config.targetAppId,
      recoveryBinding: lease.recoveryBinding, appIdentity: () => managedApp?.recoverySummary,
      assertOwned: async () => { await lease.assertOwned?.(); },
    });
    permissions ??= new AndroidPermissionPreparation({ deviceId: config.deviceId, appId: config.targetAppId, adbPath: config.tools?.adb, journal: permissionJournal,
      executor: async (program, args, context) => {
        await lease.assertOwned?.();
        if (isAndroidMutation(args)) await verifyDevice(context);
        // The parent owns the device already; reacquiring a delegated claim would deadlock.
        return (options.permissionExecutor ?? executeTool)(program, args, context);
      },
    });
    const preparation = permissions;
    const work = Promise.resolve().then(async () => {
      await lease.assertOwned?.(); signal.throwIfAborted();
      if (mutation && (active || opening)) throw new NativeError('precondition_failed', 'A native Adapter started during Android app preparation.');
      return lease.runExclusive!(async () => {
        const context = { requestId: randomUUID(), deadline, signal };
        if (mutation || deviceBinding?.hasRecord) await verifyDevice(context);
        const result = await action(preparation, context);
        if (deviceBinding?.hasRecord) await verifyDevice(context);
        signal.throwIfAborted();
        await lease.assertOwned?.();
        signal.throwIfAborted();
        return result;
      }, signal);
    });
    permissionWork = work;
    void work.then(() => { if (permissionWork === work) permissionWork = undefined; }, () => { if (permissionWork === work) permissionWork = undefined; });
    let abort: (() => void) | undefined;
    try {
      return await Promise.race([work, new Promise<never>((_, reject) => {
        abort = () => reject(new NativeError('cancelled', 'Android app preparation was cancelled or exceeded its budget.'));
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
      })]);
    } catch (error) {
      if (preparation.outcomeUnknown || managedApp?.outcomeUnknown || deviceBinding?.outcomeUnknown) {
        dirty = true;
        try { await lease.quarantine('Android app preparation could not be confirmed.'); }
        catch (cleanup) { throw new AggregateError([error, cleanup], 'Android app preparation and device quarantine failed.'); }
      }
      throw error;
    } finally { if (abort) signal.removeEventListener('abort', abort); }
  };
  const session: NativeDeviceSession = {
    deviceKind: device.kind,
    async quarantine(reason) { dirty = true; await lease.quarantine(reason); },
    async delegate() {
      if (closed || active || opening || permissionWork) throw new NativeError('precondition_failed', 'Delegate device ownership before starting an Adapter or preparation.');
      if (!lease.delegate) throw new NativeError('precondition_failed', 'This device owner cannot delegate ownership.');
      return lease.delegate();
    },
    async preparePermissions(input, request) {
      if (request?.mode !== 'managed-start') throw new NativeError('precondition_failed', 'Permission mutation requires managed-start before app launch.');
      if (!lease.permissionRecoveryPath) throw new NativeError('precondition_failed', 'Only a retained parent owner can capture a durable permission baseline.');
      const declaration = parseAndroidPermissionDeclarations(input);
      return runAndroidPreparation(request, true, async (preparation, context) => {
        await managedApp?.assertInstalled(context);
        return preparation.prepare(declaration, context);
      });
    },
    async stopApp(request) {
      if (request?.mode !== 'managed-start') throw new NativeError('precondition_failed', 'Stopping the target app requires managed-start.');
      if (!lease.permissionRecoveryPath) throw new NativeError('precondition_failed', 'Only a retained parent owner can journal a managed app stop.');
      return runAndroidPreparation(request, true, async (preparation, context) => {
        await managedApp?.assertInstalled(context);
        await preparation.stopApp(context);
        await managedApp?.confirmStopped(context);
      });
    },
    async installApp(input, request) {
      if (request?.mode !== 'managed-start') throw new NativeError('precondition_failed', 'APK installation requires managed-start before app launch.');
      if (!lease.recoveryPath) throw new NativeError('precondition_failed', 'Only the retained parent device owner can own APK installation.');
      const snapshot = { ...input };
      return runAndroidPreparation(request, true, async (preparation, context) => {
        if (preparation.hasBaseline) throw new NativeError('precondition_failed', 'Verify installation before capturing any permission baseline.');
        managedApp ??= new AndroidManagedApp({ deviceId: config.deviceId, appId: config.targetAppId,
          adbPath: config.tools?.adb, recoveryPath: lease.recoveryPath!, recoveryBinding: lease.recoveryBinding,
          assertOwned: lease.assertOwned?.bind(lease), executor: async (program, args, current) => {
            await lease.assertOwned?.();
            if (isAndroidMutation(args)) await verifyDevice(current);
            return (options.appExecutor ?? executeTool)(program, args, current);
          } });
        return managedApp.install(snapshot, context);
      });
    },
    async launchApp(request) {
      if (request?.mode !== 'managed-start') throw new NativeError('precondition_failed', 'Launching the installed app requires managed-start.');
      return runAndroidPreparation(request, true, async (_preparation, context) => {
        if (!managedApp) throw new NativeError('precondition_failed', 'Verify the managed APK installation before launch.');
        return managedApp.launch(context);
      });
    },
    async inspectPermissions(input, request = {}) {
      return runAndroidPreparation(request, false, (preparation, context) => preparation.inspect(input, context));
    },
    async inspectAppState(input, request = {}) {
      const selected = [...input];
      return runAndroidPreparation(request, false, (_preparation, context) => inspectAndroidApp({
        deviceId: config.deviceId, appId: config.targetAppId, adbPath: config.tools?.adb,
        executor: async (program, args, current) => {
          await lease.assertOwned?.();
          return (options.appExecutor ?? options.permissionExecutor ?? executeTool)(program, args, current);
        },
      }, selected, context));
    },
    async verifyAppProcess(vmPid, request) {
      if (closed) throw new NativeError('cancelled', 'Native device ownership has closed.');
      const timeout = request?.timeout ?? 5000;
      if (!Number.isSafeInteger(timeout) || timeout <= 0) throw new NativeError('precondition_failed', 'Device binding timeout must be a positive integer.');
      const deadline = Date.now() + timeout;
      const signal = AbortSignal.any([AbortSignal.timeout(timeout), lifetime.signal, ...(lease.signal ? [lease.signal] : []),
        ...(options.signal ? [options.signal] : []), ...(request?.signal ? [request.signal] : [])]);
      const work = Promise.resolve().then(async () => {
        await lease.assertOwned?.();
        const verify = async () => {
          signal.throwIfAborted();
          const remaining = deadline - Date.now();
          if (remaining <= 0) throw new NativeError('timeout', 'Device binding deadline exceeded while waiting for platform work.');
          await verifyNativeAppProcess(config, vmPid, { timeout: remaining, signal });
        };
        // Binding is platform work too; it must not cross a supervisor's preparation.
        return lease.runExclusive ? lease.runExclusive(verify, signal) : verify();
      });
      bindingWork.add(work);
      try { await work; } finally { bindingWork.delete(work); }
    },
    async createRuntime(attempt = {}) {
      if (closed) throw new NativeError('cancelled', 'Native device ownership has closed.');
      if (dirty) throw new NativeError('cleanup_failed', 'Native cleanup was not confirmed; restore the device baseline before retrying.');
      if (active || opening || permissionWork) throw new NativeError('precondition_failed', 'Dispose the previous native attempt and finish permission preparation before creating another one.');
      await lease.assertOwned?.();
      if (closed) throw new NativeError('cancelled', 'Native device ownership has closed.');
      if (active || opening || permissionWork) throw new NativeError('precondition_failed', 'Dispose the previous native attempt and finish permission preparation before creating another one.');
      const signal = AbortSignal.any([lifetime.signal, ...(lease.signal ? [lease.signal] : []), ...(options.signal ? [options.signal] : []), ...(attempt.signal ? [attempt.signal] : [])]);
      opening = createNativeSession(config, { ...options, ...attempt, discovery, leaseManager, signal,
        verifyDeviceIdentity: config.platform === 'android' && lease.deviceRecoveryPath ? verifyDevice : undefined,
        runtime: { ...options.runtime, ...attempt.runtime } });
      try { active = await opening; return active; }
      finally { opening = undefined; }
    },
    quiesce() {
      return quiescing ??= (async () => {
        closed = true;
        const cleanup = new AbortController();
        const deadline = Date.now() + (config.cleanupTimeoutMs ?? 15000);
        lifetime.abort(new NativeError('cancelled', 'Native device owner closed.'));
        let timer: ReturnType<typeof setTimeout> | undefined;
        const errors = cleanupErrors;
        try {
          await Promise.race([(async () => {
            await opening?.catch(() => undefined);
            await permissionWork?.catch(() => undefined);
            await Promise.allSettled([...bindingWork]);
            await active?.dispose();
            if (dirty) throw new NativeError('cleanup_failed', 'Native cleanup was not confirmed.');
            if (permissions || managedApp) {
              cleanup.signal.throwIfAborted();
              if (Date.now() >= deadline) throw new NativeError('cleanup_failed', 'Native owner cleanup deadline exceeded before permission restoration.');
              await lease.runExclusive!(async () => {
                const context = { requestId: randomUUID(), deadline, signal: cleanup.signal };
                if (deviceBinding?.hasRecord) await verifyDevice(context);
                // Verify before any cleanup write; never stop or restore a replacement app.
                if (managedApp?.hasInstallation) {
                  await managedApp.assertInstalled(context);
                  await permissions!.stopApp(context);
                  await managedApp.confirmStopped(context);
                }
                await permissions?.restore(context);
                await managedApp?.dispose(context);
                await permissionJournal?.complete(context);
                await managedApp?.complete(context);
                await deviceBinding?.complete(context);
              }, cleanup.signal);
            }
          })(), new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              const error = new NativeError('cleanup_failed', 'Native owner cleanup timed out.');
              cleanup.abort(error);
              reject(error);
            }, Math.max(0, deadline - Date.now()));
          })]);
        } catch (error) {
          dirty = true;
          errors.push(error);
          try { await lease.quarantine('Native device owner cleanup was not confirmed.'); }
          catch (quarantine) { errors.push(quarantine); }
        } finally {
          clearTimeout(timer);
          cleanup.abort(new NativeError('cancelled', 'Native owner cleanup completed.'));
        }
        if (errors.length) throw new NativeError('cleanup_failed', 'Native cleanup was not confirmed; device recovery is required.', {
          cause: errors.length === 1 ? errors[0] : new AggregateError(errors, 'Native owner cleanup, quarantine or release failed.'),
        });
      })();
    },
    dispose() {
      return closing ??= (async () => {
        try { await session.quiesce(); } catch { /* Retain original causes alongside release failures. */ }
        const errors = [...cleanupErrors];
        try { await lease.release(); } catch (release) { errors.push(release); }
        if (errors.length) throw new NativeError('cleanup_failed', 'Native cleanup or device release failed; device recovery is required.', {
          cause: errors.length === 1 ? errors[0] : new AggregateError(errors, 'Native owner cleanup, quarantine or release failed.'),
        });
      })();
    },
  };
  return session;
}

function isAndroidMutation(args: readonly string[]): boolean {
  if (args[0] !== '-s') return false;
  if (['install', 'uninstall'].includes(args[2])) return true;
  if (args[2] === 'forward') return args[3] !== '--list';
  return args[2] === 'shell' && /^(?:am (?:force-stop|start)\b|pm (?:grant|revoke|clear-permission-flags|set-permission-flags)\b)/.test(args[3] ?? '');
}
