import { VMServiceConnector, waitForVmServiceEndpoint, getAndroidScenarioPermissions, type ManagedAppAttemptRequest, type NativeConfig } from '@fliwright/core';
import type { NativeDeviceSession } from '@fliwright/native';
import { withFlutterAndroidApk } from './FlutterAndroidBuild.js';
import { FlutterBuildError } from './FlutterBuildProcess.js';
import { startManagedAppControl } from './ManagedAppRun.js';
import { createHash } from 'node:crypto';
import type { AndroidInstalledApp, AndroidPermissionState } from '@fliwright/native';
import { ManagedNativeTelemetry, type ManagedNativePhaseObserver } from './ManagedNativeTelemetry.js';

/** Trusted launch configuration frozen by the CLI or Worker supervisor. */
export interface ManagedNativeLaunch {
  target?: string;
  flutterBin?: string;
  flutterArgs?: readonly string[];
  requiredCapabilities?: readonly string[];
  keepAppAlive?: boolean;
}
export interface InstalledAndroidDependencies {
  buildAndroid?: typeof withFlutterAndroidApk;
  verifyEndpoint?: typeof verifyInstalledAndroidEndpoint;
  onPhase?: ManagedNativePhaseObserver;
  onError?: (error: unknown) => void;
}

/** No daemon launch or installation occurs until the first authenticated attempt. */
export async function startInstalledAndroidControl(cwd: string, owner: NativeDeviceSession, config: NativeConfig,
  input: ManagedNativeLaunch, prepareDevice: (request: ManagedAppAttemptRequest, signal: AbortSignal) => Promise<void>,
  signal: AbortSignal, deps: InstalledAndroidDependencies = {}) {
  if (input.keepAppAlive) throw new Error('Installed native sessions cannot keep the app alive after cleanup.');
  if (!config.tools?.apkAnalyzer) throw new Error('Configure native.tools.apkAnalyzer before managed Android installation.');
  if (!owner.installApp || !owner.stopApp || !owner.launchApp || !owner.preparePermissions) throw new Error('Native owner cannot manage an installed Android app.');
  const launch = { ...input, flutterArgs: [...(input.flutterArgs ?? [])], requiredCapabilities: [...(input.requiredCapabilities ?? [])] };
  const apkAnalyzerPath = config.tools.apkAnalyzer;
  const telemetry = new ManagedNativeTelemetry(deps.onPhase);
  let installed: AndroidInstalledApp | undefined, unsafeFailure: unknown;
  let permissions: AndroidPermissionState[] = [];
  const control = await startManagedAppControl(cwd, { signal, timeoutMs: 600000, cleanupTimeoutMs: config.cleanupTimeoutMs ?? 15000, onError: deps.onError,
    async prepareDevice(request, attemptSignal, scenario) {
      await prepareDevice(request, attemptSignal);
      attemptSignal.throwIfAborted();
      // The control validates the frozen scene and release gate before stopping the app.
      permissions = await telemetry.run('native.prepare', () => owner.preparePermissions!(getAndroidScenarioPermissions(scenario),
        { mode: 'managed-start', signal: attemptSignal }), { attemptKey: request.attemptKey, signal: attemptSignal });
    },
    async stop(attemptSignal, request, reportPhase) {
      attemptSignal.throwIfAborted();
      if (!installed) {
        reportPhase('build-app');
        const buildPhase = telemetry.start('native.build', { attemptKey: request.attemptKey, signal: attemptSignal });
        try {
          await (deps.buildAndroid ?? withFlutterAndroidApk)({ projectRoot: cwd, target: launch.target, flutterBin: launch.flutterBin,
            flutterArgs: launch.flutterArgs, signal: attemptSignal }, async apk => {
            attemptSignal.throwIfAborted();
            buildPhase.finish();
            reportPhase('install-app');
            const installation = await telemetry.run('native.install', () => owner.installApp!({ apkPath: apk.apkPath, apkAnalyzerPath },
              { mode: 'managed-start', signal: attemptSignal, timeout: 120000 }), { attemptKey: request.attemptKey, signal: attemptSignal });
            if (installation.sha256 !== apk.sha256) throw new Error('Installed APK identity differs from the supervised build.');
            installed = { ...installation, permissions: [...installation.permissions] };
          });
          buildPhase.finish();
        } catch (error) {
          buildPhase.finish(error);
          if (error instanceof FlutterBuildError && !error.cleanupConfirmed) unsafeFailure = error;
          throw error;
        }
      }
      attemptSignal.throwIfAborted();
      reportPhase('stop-app');
      await telemetry.run('native.stop', () => owner.stopApp!({ mode: 'managed-start', signal: attemptSignal, timeout: 120000 }), { attemptKey: request.attemptKey, signal: attemptSignal });
    },
    async launch(attemptSignal, request, reportPhase) {
      const app = await telemetry.run('native.launch', () => owner.launchApp!({ mode: 'managed-start', signal: attemptSignal, timeout: 120000 }), { attemptKey: request.attemptKey, signal: attemptSignal });
      attemptSignal.throwIfAborted();
      reportPhase('verify-endpoint');
      const vmPid = await telemetry.run('native.verify', () => (deps.verifyEndpoint ?? verifyInstalledAndroidEndpoint)(app.url, app.pid, launch.requiredCapabilities, attemptSignal), { attemptKey: request.attemptKey, signal: attemptSignal });
      attemptSignal.throwIfAborted();
      if (vmPid !== app.pid) throw new Error('Managed VM process differs from the installed app launch.');
      await owner.verifyAppProcess(vmPid, { signal: attemptSignal, timeout: 30000 });
      attemptSignal.throwIfAborted();
      return { url: app.url, nativeApp: { platform: 'android',
        deviceKey: createHash('sha256').update(`android\0${config.deviceId}`).digest('hex'),
        appId: installed!.appId, apkSha256: installed!.sha256, uid: installed!.uid, pid: app.pid,
        permissions: structuredClone(permissions), attemptKey: request.attemptKey, launchGeneration: app.generation,
        ...(request.scenarioFingerprint ? { scenarioFingerprint: request.scenarioFingerprint } : {}),
      } };
    },
  });
  return { control: control.control, async dispose() {
    const errors: unknown[] = [];
    try { await telemetry.run('native.cleanup', () => control.dispose()); } catch (error) { errors.push(error); }
    if (unsafeFailure) errors.push(unsafeFailure);
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, 'Installed Android control cleanup is unconfirmed.');
  } };
}

/** Fresh Bridge verification plus an independent VM PID observation before returning an endpoint. */
export async function verifyInstalledAndroidEndpoint(url: string, pid: number, requiredCapabilities: readonly string[], parent: AbortSignal): Promise<number> {
  const signal = AbortSignal.any([parent, AbortSignal.timeout(30000)]);
  signal.throwIfAborted();
  const health = await waitForVmServiceEndpoint({ url, kind: 'direct-vm', source: 'owned-android-launch', scope: 'execution-worker', acquiredAt: new Date().toISOString() }, { signal, timeoutMs: 30000 });
  if (health.status !== 'ok' || requiredCapabilities.some(capability => health.bridgeCapabilities?.[capability] !== true)) {
    throw new Error('Managed Android app lacks required Bridge capabilities.');
  }
  signal.throwIfAborted();
  const connector = new VMServiceConnector();
  const abort = () => connector.disconnect({ force: true });
  signal.addEventListener('abort', abort, { once: true });
  try {
    signal.throwIfAborted();
    await connector.connect(url);
    const vm = await connector.sendRequest('getVM') as { pid?: unknown };
    signal.throwIfAborted();
    if (!Number.isSafeInteger(vm?.pid) || vm.pid !== pid) throw new Error('Managed VM PID does not match the freshly launched Android app.');
    return vm.pid as number;
  } finally { signal.removeEventListener('abort', abort); connector.disconnect({ force: true }); }
}
