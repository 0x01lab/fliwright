import { createHash } from 'node:crypto';
import { NativeError, parseAndroidAppObservation, type AndroidAppObservation, type NativeOperationContext } from '@fliwright/core';
import { AndroidPermissionPreparation, appIdentity } from './AndroidPermissionPreparation.js';
import { defaultAdbPath } from './AdbSession.js';
import { executeTool, quoteAndroidShell, type ToolExecutor } from '../ToolExecutor.js';
import { parseAndroidProcessInventory } from './AndroidProcessInventory.js';

/** Independent child-side inspection. Never installs, launches, stops or captures a baseline. */
export async function inspectAndroidApp(options: { deviceId: string; appId: string; adbPath?: string; executor?: ToolExecutor },
  names: readonly string[], context: NativeOperationContext): Promise<AndroidAppObservation> {
  // Reuse the permission parser's identity validation, without adopting managed-app ownership.
  const permissions = new AndroidPermissionPreparation(options);
  if (!Array.isArray(names) || names.length > 2 || new Set(names).size !== names.length
    || names.some(name => !['camera', 'microphone'].includes(name))) throw new NativeError('precondition_failed', 'Observe unique camera/microphone permission names.');
  const selected = [...names];
  const run = async (command: string) => {
    context.signal.throwIfAborted();
    if (Date.now() >= context.deadline) throw new NativeError('timeout', 'Android app observation deadline exceeded.');
    const result = await (options.executor ?? executeTool)(options.adbPath ?? defaultAdbPath(), ['-s', options.deviceId, 'shell', command], context);
    context.signal.throwIfAborted();
    if (Date.now() >= context.deadline) throw new NativeError('timeout', 'Android app observation deadline exceeded.');
    if (result.byteLength > 1024 * 1024) throw new NativeError('protocol_mismatch', 'Android app observation output exceeds its limit.');
    return result.toString('utf8').trim();
  };
  const installation = async () => {
    if (await run('am get-current-user') !== '0') throw new NativeError('unsupported_capability', 'Android app observation requires primary user 0.');
    const paths = (await run(`pm path --user 0 ${quoteAndroidShell(options.appId)}`)).split('\n');
    if (paths.length !== 1 || !/^package:\/data\/app\/[^\r\n\0]+\/base\.apk$/.test(paths[0])) {
      throw new NativeError('unsupported_capability', 'Android app observation requires a single installed base APK.');
    }
    const path = paths[0].slice(8), digest = await run(`sha256sum ${quoteAndroidShell(path)}`);
    if (!/^[a-f0-9]{64}/.test(digest) || digest.slice(64) !== `  ${path}`) throw new NativeError('protocol_mismatch', 'Android installed APK digest could not be observed.');
    const { uid } = appIdentity(await run(`dumpsys package ${quoteAndroidShell(options.appId)}`), options.appId);
    const processes = parseAndroidProcessInventory(await run('ps -A -o UID,PID,NAME'));
    const main = processes.filter(item => item.name === options.appId);
    if (main.length !== 1 || main[0].uid !== Number(uid) || main[0].pid <= 1) throw new NativeError('device_mismatch', 'Android current app process does not match the installed UID.');
    return { path, apkSha256: digest.slice(0, 64), uid: Number(uid), pid: main[0].pid };
  };
  const before = await installation();
  const observed = selected.length ? await permissions.inspect(selected, context) : [];
  const after = await installation();
  if (Object.keys(before).some(key => before[key as keyof typeof before] !== after[key as keyof typeof after])) {
    throw new NativeError('device_mismatch', 'Android installation or process changed during app readback.');
  }
  return parseAndroidAppObservation({ platform: 'android', deviceKey: createHash('sha256').update(`android\0${options.deviceId}`).digest('hex'),
    appId: options.appId, apkSha256: after.apkSha256, uid: after.uid, pid: after.pid, permissions: observed });
}
