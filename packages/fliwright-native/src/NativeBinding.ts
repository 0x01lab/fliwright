import { randomUUID } from 'node:crypto';
import { NativeError, type NativeConfig, type NativeOperationOptions } from '@fliwright/core';
import { defaultAdbPath } from './android/AdbSession.js';
import { executeTool, type ToolExecutor } from './ToolExecutor.js';

/** Confirm current VM process ownership independently of cached workspace metadata. */
export async function verifyNativeAppProcess(config: NativeConfig, vmPid: unknown,
  options: NativeOperationOptions & { executor?: ToolExecutor } = {}): Promise<void> {
  if (typeof vmPid !== 'number' || !Number.isSafeInteger(vmPid) || vmPid <= 0) {
    throw new NativeError('device_mismatch', 'The connected Flutter VM did not report a valid process ID; device binding cannot be verified.');
  }
  const timeout = options.timeout ?? 5000;
  if (!Number.isSafeInteger(timeout) || timeout <= 0) throw new NativeError('precondition_failed', 'Device binding timeout must be a positive integer.');
  const context = { requestId: randomUUID(), deadline: Date.now() + timeout,
    signal: AbortSignal.any([AbortSignal.timeout(timeout), ...(options.signal ? [options.signal] : [])]) };
  const run = options.executor ?? executeTool;
  const processList = config.platform === 'android'
    ? await run(config.tools?.adb ?? defaultAdbPath(), ['-s', config.deviceId, 'shell', 'ps -A -o PID,NAME'], context)
    : await run(config.tools?.xcrun ?? 'xcrun', ['simctl', 'spawn', config.deviceId, 'launchctl', 'list'], context);
  const matches = processList.toString('utf8').split('\n').some(line => {
    const fields = line.trim().split(/\s+/);
    if (fields[0] !== String(vmPid)) return false;
    if (config.platform === 'android') return fields[1] === config.targetAppId || fields[1]?.startsWith(`${config.targetAppId}:`);
    const label = fields[2] ?? '';
    // iOS 26 exposes UIKitApplication labels for scene-managed Flutter hosts.
    // Parse the whole label so a bundle prefix or trailing garbage cannot bind.
    const uiKit = /^UIKitApplication:([^\[\]\s]+)\[[A-Fa-f0-9]+\]\[rb-legacy\]$/.exec(label);
    if (uiKit) return uiKit[1] === config.targetAppId;
    return label.slice(0, label.lastIndexOf('.')) === `application.${config.targetAppId}`;
  });
  if (!matches) throw new NativeError('device_mismatch', 'The connected Flutter VM process does not belong to the selected device and target app. Reconnect to that app before enabling native automation.');
}
