import { randomUUID } from 'node:crypto';
import { NativeError, nativeConfigSchema, type DeviceCapabilities, type NativeConfig, type NativeOperationContext } from '@fliwright/core';
import { DeviceDiscovery, type DeviceInventory, type DiscoveredDevice } from '@fliwright/devices';
import { AdbSession, defaultAdbPath } from './android/AdbSession.js';
import { xctestCapabilities } from './ios/XctestSession.js';
import { preflightXctestSession } from './ios/XctestRunner.js';
import { executeTool, quoteAndroidShell, type ToolExecutor } from './ToolExecutor.js';

export interface NativeDoctorResult {
  ready: boolean;
  device?: DiscoveredDevice;
  checks: Array<{ name: string; passed: boolean; message: string }>;
  capabilities: DeviceCapabilities;
  diagnostics: DeviceInventory['diagnostics'];
  /** Doctor does not start a Runner; this is distinct from environment readiness. */
  runnerStarted: false;
}
export interface NativeDoctorOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  discovery?: { scan(options: { platforms: Array<'android' | 'ios'>; signal?: AbortSignal }): Promise<DeviceInventory> };
  executor?: ToolExecutor;
}

/** Read-only prerequisites and support declarations; never boots, builds or resets a device. */
export async function inspectNativeEnvironment(config: NativeConfig, options: NativeDoctorOptions = {}): Promise<NativeDoctorResult> {
  if (!nativeConfigSchema.safeParse(config).success) throw new NativeError('precondition_failed', 'A valid native configuration is required for native doctor.');
  if (options.signal?.aborted) throw new NativeError('cancelled', 'Native doctor cancelled.');
  const timeout = options.timeoutMs ?? 15_000;
  if (!Number.isSafeInteger(timeout) || timeout <= 0) throw new NativeError('precondition_failed', 'Native doctor timeout must be positive.');
  const signal = AbortSignal.any([AbortSignal.timeout(timeout), ...(options.signal ? [options.signal] : [])]);
  const context: NativeOperationContext = { requestId: randomUUID(), deadline: Date.now() + timeout, signal };
  const inventory = await (options.discovery ?? new DeviceDiscovery({ tools: config.tools })).scan({ platforms: [config.platform], signal });
  if (signal.aborted) throw new NativeError(options.signal?.aborted ? 'cancelled' : 'timeout', 'Native doctor was interrupted.');
  const device = inventory.devices.find(item => item.id === config.deviceId && item.platform === config.platform);
  const result: NativeDoctorResult = { ready: false, device, checks: [], capabilities: {}, diagnostics: inventory.diagnostics, runnerStarted: false };
  const check = (name: string, passed: boolean, message: string) => result.checks.push({ name, passed, message });
  check('enabled', config.enabled, config.enabled ? 'Native automation is enabled.' : 'Enable native automation before running tests.');
  check('device', device?.state === 'online', device ? `Selected device is ${device.state}.` : 'Selected device was not discovered; inspect tool diagnostics.');
  if (!device || device.state !== 'online') return result;
  const run = options.executor ?? executeTool;
  const probe = async (name: string, read: () => Promise<string>, validate = (text: string) => !!text.trim()) => {
    try {
      const value = (await read()).trim();
      check(name, validate(value), validate(value) ? value : 'The target application was not found; install it on the selected device.');
    } catch (error) {
      if (signal.aborted) throw new NativeError(options.signal?.aborted ? 'cancelled' : 'timeout', 'Native doctor did not finish within its budget.', { cause: error });
      check(name, false, error instanceof Error ? error.message : String(error));
    }
  };
  if (config.platform === 'android') {
    const adapter = new AdbSession({ deviceId: device.id, appId: config.targetAppId, kind: device.kind, fingerprints: config.fingerprints });
    const adb = config.tools?.adb ?? defaultAdbPath();
    await probe('adb-version', async () => (await run(adb, ['version'], context)).toString('utf8'));
    await probe('target-app', async () => (await run(adb, ['-s', device.id, 'shell', `pm path ${quoteAndroidShell(config.targetAppId)}`], context)).toString('utf8'), text => /^package:\//m.test(text));
    result.capabilities = await adapter.capabilities(context);
  } else {
    check('platform', device.kind === 'simulator', device.kind === 'simulator' ? 'iOS Simulator selected.' : 'Physical iOS signing and transport remain unsupported.');
    await probe('xcode-version', async () => (await run(config.tools?.xcodebuild ?? 'xcodebuild', ['-version'], context)).toString('utf8'));
    await probe('target-app', async () => (await run(config.tools?.xcrun ?? 'xcrun', ['simctl', 'get_app_container', device.id, config.targetAppId, 'app'], context)).toString('utf8'), text => text.startsWith('/'));
    try { await preflightXctestSession(config); check('runner-product', true, 'Prepared Runner product exists; doctor does not launch it.'); }
    catch (error) { check('runner-product', false, error instanceof Error ? error.message : String(error)); }
    result.capabilities = Object.fromEntries(Object.entries(xctestCapabilities()).map(([key, value]) => [key,
      value.support === 'supported' ? { ...value, ready: false, reason: 'Runner handshake is required; native snapshot starts an owned session.' } : value]));
  }
  result.ready = result.checks.every(item => item.passed);
  if (!result.ready) result.capabilities = Object.fromEntries(Object.entries(result.capabilities).map(([key, value]) => [key,
    value.ready ? { ...value, ready: false, reason: 'Resolve failed native doctor checks first.' } : value]));
  return result;
}
