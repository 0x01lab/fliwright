import { z } from 'zod';
import { NativeError, nativeConfigSchema, type NativeConfig } from '@fliwright/core';
import { createNativeSession, inspectNativeEnvironment, inspectDeviceLease, inspectIosRunnerRecovery, prepareIosRunner,
  restoreAndroidApp, restoreIosRunner } from '@fliwright/native';
import { CliError, type CommandRegistry } from '../CommandRegistry.js';
import { resolveProjectConfig } from '../config.js';

export interface NativeCommandDeps {
  doctor?: typeof inspectNativeEnvironment;
  createSession?: typeof createNativeSession;
  prepare?: typeof prepareIosRunner;
  inspectLease?: typeof inspectDeviceLease;
  inspectRunnerRecovery?: typeof inspectIosRunnerRecovery;
  restoreRunnerRecovery?: typeof restoreIosRunner;
  restoreAndroidApp?: typeof restoreAndroidApp;
}

/** Native inspection uses the explicit platform device, independent of a Flutter VM URL. */
export function registerNative(registry: CommandRegistry, deps: NativeCommandDeps = {}): void {
  const native = nativeConfigSchema.optional();
  const timeout = z.number().int().positive().optional();
  const resolveNative = async (cwd: string, explicit?: NativeConfig) => {
    const config = (await resolveProjectConfig(cwd, explicit ? { native: explicit } : {})).native;
    if (!config) throw new CliError('INVALID_INPUT', 'Configure native with an explicit platform, deviceId and targetAppId in fliwright.config.ts or structured input.', 2);
    return config;
  };
  registry.add({ path: 'native.recovery.inspect', description: 'Read local device ownership, host process and recovery evidence without changing device state',
    input: z.object({ native }), effects: ['local-runtime-read'], output: 'DeviceLeaseInspection',
    execute: async (input, context) => {
      const config = await resolveNative(context.cwd, input.native);
      context.signal.throwIfAborted();
      const report = await (deps.inspectLease ?? inspectDeviceLease)({ platform: config.platform, deviceId: config.deviceId });
      context.signal.throwIfAborted();
      return report;
    },
  });
  registry.add({ path: 'native.recovery.verify', description: 'Read the selected iOS Simulator boot generation and XCTest Runner identity before recovery',
    input: z.object({ native, timeout }), effects: ['device-read'], output: 'IosRunnerRecoveryInspection',
    execute: async (input, context) => {
      const config = await resolveNative(context.cwd, input.native);
      if (config.platform !== 'ios') throw new CliError('INVALID_INPUT', 'Runner recovery verification is available only for iOS Simulators.', 2);
      try {
        return await (deps.inspectRunnerRecovery ?? inspectIosRunnerRecovery)({ platform: 'ios', deviceId: config.deviceId },
          { xcrunPath: config.tools?.xcrun, signal: context.signal, timeoutMs: input.timeout });
      } catch (error) { throw nativeCommandError(error, config); }
    },
  });
  registry.add({ path: 'native.recovery.restore', description: 'Restore isolated iOS Runner or Android app, permission and forward resources from the exact inspected evidence fingerprint',
    input: z.object({ native, fingerprint: z.string().regex(/^[a-f0-9]{64}$/), timeout }),
    effects: ['device-lease', 'device-write', 'native-runner-recovery', 'native-app-permission-forward-recovery', 'recovery-archive'], output: 'NativeRecoveryReceipt',
    execute: async (input, context) => {
      const config = await resolveNative(context.cwd, input.native);
      try {
        if (config.platform === 'ios') {
          return await (deps.restoreRunnerRecovery ?? restoreIosRunner)({ deviceId: config.deviceId, fingerprint: input.fingerprint },
            { xcrunPath: config.tools?.xcrun, signal: context.signal, timeoutMs: input.timeout });
        }
        return await (deps.restoreAndroidApp ?? restoreAndroidApp)({ deviceId: config.deviceId, fingerprint: input.fingerprint },
          { adbPath: config.tools?.adb, signal: context.signal, timeoutMs: input.timeout });
      } catch (error) { throw nativeCommandError(error, config); }
    },
  });
  registry.add({ path: 'native.doctor', description: 'Inspect native device prerequisites without booting, building or starting a Runner',
    input: z.object({ native, strict: z.boolean().optional(), timeout }), effects: ['environment-probe'], output: 'NativeDoctorResult',
    execute: async (input, context) => {
      const config = await resolveNative(context.cwd, input.native);
      let result;
      try { result = await (deps.doctor ?? inspectNativeEnvironment)(config, { signal: context.signal, timeoutMs: input.timeout }); }
      catch (error) { throw nativeCommandError(error, config); }
      if (input.strict && !result.ready) throw new CliError('ENVIRONMENT_INVALID', 'Native prerequisites are not ready; inspect checks and diagnostics.', 3, result);
      return result;
    },
  });
  registry.add({ path: 'native.snapshot', description: 'Capture the native UI tree in an owned device session',
    input: z.object({ native, timeout, query: z.object({ field: z.enum(['resourceId', 'text', 'label']), value: z.string().min(1),
      exact: z.boolean().default(true), scope: z.union([z.enum(['app', 'system']), z.object({ appId: z.string().min(1) }).strict()]).default('app') }).strict().optional() }),
    effects: ['device-lease', 'native-runner', 'owned-device-temp-files'], output: 'NativeSnapshotEvidence',
    execute: async (input, context) => {
      const config = await resolveNative(context.cwd, input.native);
      if (!config.enabled) throw new CliError('INVALID_INPUT', 'Enable native automation before capturing its tree.', 2);
      let runtime;
      try { runtime = await (deps.createSession ?? createNativeSession)(config, { signal: context.signal }); }
      catch (error) { throw nativeCommandError(error, config); }
      let failure: unknown;
      let failed = false;
      let snapshot;
      try { snapshot = await runtime.native.snapshot({ timeout: input.timeout, signal: context.signal, query: input.query }); }
      catch (error) { failed = true; failure = error; }
      try { await runtime.dispose(); }
      catch (error) { throw nativeCommandError(failed ? failure : error, config, failed ? error : undefined); }
      if (failed) throw nativeCommandError(failure, config);
      return { surface: 'native', schemaVersion: 1, query: input.query, snapshot };
    },
  });
  registry.add({ path: 'native.prepare', description: 'Explicitly build or reuse the unsigned iOS Simulator XCTest Runner',
    input: z.object({ cacheRoot: z.string().min(1).optional(), timeout }), effects: ['runner-build', 'build-cache'], output: 'PreparedIosRunner',
    execute: (input, context) => (deps.prepare ?? prepareIosRunner)({ cacheRoot: input.cacheRoot, timeoutMs: input.timeout, signal: context.signal }),
  });
}

function nativeCommandError(error: unknown, config: NativeConfig, cleanupError?: unknown): CliError {
  const nativeCode = error instanceof NativeError ? error.code : undefined;
  const exitCode = nativeCode === 'cancelled' ? 130 : nativeCode === 'timeout' ? 5 : nativeCode === 'device_busy' ? 4 : 3;
  return new CliError(nativeCode ? `NATIVE_${nativeCode.toUpperCase()}` : 'EXECUTION_UNAVAILABLE', error instanceof Error ? error.message : String(error), exitCode,
    { platform: config.platform, backend: config.backend ?? (config.platform === 'android' ? 'adb' : 'xctest'), nativeCode,
      ...(cleanupError === undefined ? {} : { cleanupError: cleanupError instanceof Error ? cleanupError.message : String(cleanupError) }) });
}
