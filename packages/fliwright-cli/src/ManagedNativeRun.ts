import { openNativeDevice, type DeviceLeaseDelegation, type NativeDeviceSession } from '@fliwright/native';
import { fingerprintScenario, prepareScenarioDevice, ScenarioResolver, validateScenarioDevicePreparation, type ManagedAppAttemptRequest, type ManagedAppControl, type TestScenario } from '@fliwright/core';
import { resolveProjectConfig } from './config.js';
import { CliError } from './CommandRegistry.js';
import { startInstalledAndroidControl, type ManagedNativeLaunch, type InstalledAndroidDependencies } from './InstalledAndroidRun.js';
import { ManagedNativeTelemetry, type ManagedNativePhaseObserver } from './ManagedNativeTelemetry.js';
export type { ManagedNativeLaunch } from './InstalledAndroidRun.js';

/** Parent ownership is acquired before launch; each child task borrows it serially. */
export interface ManagedNativeRun {
  delegation: DeviceLeaseDelegation;
  /** Private owner channel for installed-app attempts; never persist in config or artifacts. */
  managedAppControl?: ManagedAppControl;
  /** Supervisor-only, after confirmed app stop. No new device claim is acquired. */
  prepareAttempt(request: ManagedAppAttemptRequest, signal: AbortSignal): Promise<void>;
  /** Finish app cleanup before reset without releasing the retained device claim. */
  quiesce(): Promise<void>;
  dispose(options?: { cleanupConfirmed?: boolean }): Promise<void>;
}

/** Private supervisor reply; app commands and artifact paths never cross this grant. */
export type ManagedNativeGrant = Pick<ManagedNativeRun, 'delegation' | 'managedAppControl'>;

export async function prepareNativeRun(cwd: string, options: { deviceId: string; signal?: AbortSignal; scenario?: string | null; launch?: ManagedNativeLaunch },
  deps: { openDevice?: typeof openNativeDevice; onPhase?: ManagedNativePhaseObserver } & InstalledAndroidDependencies = {}): Promise<ManagedNativeRun | undefined> {
  const launch = options.launch ? { ...options.launch, flutterArgs: [...(options.launch.flutterArgs ?? [])],
    requiredCapabilities: [...(options.launch.requiredCapabilities ?? [])] } : undefined;
  const config = await resolveProjectConfig(cwd);
  const resolver = new ScenarioResolver(config.scenarios ?? {});
  const selected = options.scenario === undefined ? config.defaultScenario : options.scenario;
  const scenario = selected ? resolver.resolve(selected) : undefined;
  const deviceLayer = scenario ? validateScenarioDevicePreparation(scenario) : undefined;
  if (deviceLayer && !config.native?.enabled) throw new CliError('NATIVE_REQUIRED', 'Enable native automation before preparing a device scenario.', 3);
  if (!config.native?.enabled) return;
  if (config.native.deviceId !== options.deviceId) throw new CliError('NATIVE_DEVICE_MISMATCH', 'Managed launch and native configuration must select the same device.', 3);
  const telemetry = new ManagedNativeTelemetry(deps.onPhase);
  const owner: NativeDeviceSession = await telemetry.run('native.acquire', () => (deps.openDevice ?? openNativeDevice)(config.native!, { signal: options.signal }));
  const checkScenario = async (current: TestScenario | undefined, attemptId: string, signal?: AbortSignal) => {
    if (!current || !validateScenarioDevicePreparation(current)) return;
    const runtime = await owner.createRuntime({ signal });
    try {
      await prepareScenarioDevice(current, runtime, { mode: 'managed-start', attemptId, signal });
    } catch (error) {
      try { await runtime.dispose(); }
      catch (cleanup) { throw new AggregateError([error, cleanup], 'Native readiness and preparation Adapter cleanup failed.'); }
      throw error;
    }
    // This inspection is not a receipt for a later child attempt.
    await runtime.dispose();
  };
  let delegation: DeviceLeaseDelegation;
  try {
    if (deviceLayer && scenario) {
      await checkScenario(scenario, 'managed-prelaunch', options.signal);
    }
    if (!owner.delegate) throw new Error('Native device owner does not support supervised delegation.');
    delegation = await owner.delegate();
  } catch (error) {
    try { await owner.dispose(); }
    catch (cleanup) { throw new AggregateError([error, cleanup], 'Native delegation and owner cleanup failed.'); }
    throw error;
  }
  let closing: Promise<void> | undefined;
  let quiescing: Promise<void> | undefined;
  let active: Promise<void> | undefined;
  let installedControl: Awaited<ReturnType<typeof startInstalledAndroidControl>> | undefined;
  let failed = false;
  const lifetime = new AbortController(), seen = new Set<string>();
  const run: ManagedNativeRun = {
    delegation,
    async prepareAttempt(request, signal) {
      if (closing || quiescing || failed) throw new Error('Managed native preparation is unusable after failed or unconfirmed work.');
      if (active) throw new Error('Managed native preparation is already running.');
      validateAttempt(request);
      const current = request.scenarioName ? resolver.resolve(request.scenarioName) : undefined;
      if (current && fingerprintScenario(current) !== request.scenarioFingerprint) throw new Error('Managed native scenario differs from the frozen supervisor configuration.');
      // Destructive declarations remain gated until platform acceptance.
      if (current) validateScenarioDevicePreparation(current);
      if (seen.has(request.attemptKey) || seen.size >= 10000) throw new Error('Managed native attempt is repeated or exceeds the session limit.');
      const attemptKey = request.attemptKey;
      seen.add(attemptKey);
      const combined = AbortSignal.any([signal, lifetime.signal, ...(options.signal ? [options.signal] : [])]);
      const work = telemetry.run('native.prepare', async () => {
        combined.throwIfAborted(); await checkScenario(current, attemptKey, combined); combined.throwIfAborted();
      }, { attemptKey: request.attemptKey, signal: combined });
      active = work;
      try { await work; } catch (error) { failed = true; throw error; }
      finally { if (active === work) active = undefined; }
    },
    quiesce() {
      return quiescing ??= (async () => {
        lifetime.abort(new Error('Managed native owner closed.'));
        const errors: unknown[] = [];
        let timer: ReturnType<typeof setTimeout> | undefined;
        let cleanupConfirmed = true;
        try {
          try { await installedControl?.dispose(); }
          catch (error) { cleanupConfirmed = false; errors.push(error); }
          try {
            await Promise.race([active?.catch(() => undefined), new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new Error('Managed native preparation cleanup is unconfirmed.')), config.native?.cleanupTimeoutMs ?? 15000);
            })]);
          } catch (error) { cleanupConfirmed = false; errors.push(error); }
          if (!cleanupConfirmed) {
            if (!owner.quarantine) throw new Error('Native device owner cannot quarantine unconfirmed managed cleanup.');
            await owner.quarantine('Managed app cleanup was not confirmed.');
          }
        } catch (error) { errors.push(error); }
        finally { clearTimeout(timer); }
        try { await telemetry.run('native.cleanup', () => owner.quiesce()); } catch (error) { errors.push(error); }
        if (errors.length === 1) throw errors[0];
        if (errors.length > 1) throw new AggregateError(errors, 'Managed native cleanup, quarantine or release failed.');
      })();
    },
    dispose(request = {}) {
      return closing ??= (async () => {
        const errors: unknown[] = [];
        if (request.cleanupConfirmed === false) {
          try {
            if (!owner.quarantine) throw new Error('Native device owner cannot quarantine unconfirmed managed cleanup.');
            await owner.quarantine('Managed app cleanup was not confirmed.');
          } catch (error) { errors.push(error); }
        }
        try { await run.quiesce(); } catch (error) { errors.push(error); }
        try { await telemetry.run('native.release', () => owner.dispose()); } catch (error) { errors.push(error); }
        if (errors.length === 1) throw errors[0];
        if (errors.length > 1) throw new AggregateError(errors, 'Managed native cleanup and release failed.');
      })();
    },
  };
  try {
    if (launch && config.native.platform === 'android' && owner.deviceKind === 'simulator') {
      installedControl = await startInstalledAndroidControl(cwd, owner, config.native, launch, run.prepareAttempt,
        AbortSignal.any([lifetime.signal, ...(options.signal ? [options.signal] : [])]), { ...deps, onPhase: deps.onPhase });
      run.managedAppControl = installedControl.control;
    }
  } catch (error) {
    try { await run.dispose(); }
    catch (cleanup) { throw new AggregateError([error, cleanup], 'Installed Android setup and cleanup failed.'); }
    throw error;
  }
  return run;
}

function validateAttempt(request: ManagedAppAttemptRequest): void {
  if (!request || typeof request !== 'object' || Object.keys(request).some(key => !['attemptKey', 'scenarioName', 'scenarioFingerprint'].includes(key))
    || typeof request.attemptKey !== 'string' || !request.attemptKey || request.attemptKey.length > 512
    || !((request.scenarioName === undefined && request.scenarioFingerprint === undefined)
      || (typeof request.scenarioName === 'string' && request.scenarioName.length > 0 && request.scenarioName.length <= 256
        && typeof request.scenarioFingerprint === 'string' && /^[a-f0-9]{64}$/.test(request.scenarioFingerprint)))) {
    throw new Error('Invalid managed native attempt identity.');
  }
}
