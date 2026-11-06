import { NativeError, type NativeOperationContext } from '@fliwright/core';
import { AndroidDeviceBinding } from './AndroidDeviceBinding.js';
import { appIdentity, AndroidPermissionPreparation } from './AndroidPermissionPreparation.js';
import type { AndroidRecoveryApp, AndroidRecoveryPermission } from './AndroidRecoveryRecords.js';
import { defaultAdbPath } from './AdbSession.js';
import { quoteAndroidShell, type ToolExecutor } from '../ToolExecutor.js';
import { parseAndroidProcessInventory, type AndroidProcess } from './AndroidProcessInventory.js';

/** Finite Android restore primitives. Never adopts the old mutable permission manager. */
export class AndroidRecoveryPlatform {
  constructor(private readonly options: { serial: string; avdName: string; app: AndroidRecoveryApp; permission?: AndroidRecoveryPermission;
    devicePath(): Promise<string>; executor: ToolExecutor; adbPath?: string; guard(): Promise<void>; context: NativeOperationContext }) {}

  async observe(allowRemoved = false, allowMissingPermissions = false) {
    const { app, permission } = this.options;
    await this.identity();
    if (await this.shell('am get-current-user') !== '0') throw unsupported('Android recovery requires primary user 0.');
    const users = (await this.shell('pm list users')).split('\n');
    if (users.shift()?.trim() !== 'Users:' || users.length !== 1 || !/^\s*UserInfo\{0:[^{}\r\n]+\}(?: running)?\s*$/.test(users[0])) throw unsupported('Use a dedicated single-user emulator for recovery.');
    const inventory = await this.shell(`pm list packages -u --user 0 ${quoteAndroidShell(app.appId)}`);
    const packages = inventory ? inventory.split('\n') : [];
    if (packages.some(line => !/^package:[A-Za-z][\w]*(?:\.[A-Za-z0-9_]+)+$/.test(line)) || new Set(packages).size !== packages.length) throw failure('Invalid Android package inventory.');
    const installed = packages.includes(`package:${app.appId}`);
    if (!installed && permission?.baseline.length && !allowMissingPermissions) throw mismatch('The original app is missing before its captured permission baseline was restored.');
    let stopped = true, permissions: Awaited<ReturnType<AndroidPermissionPreparation['inspect']>> = [];
    if (installed) {
      const paths = (await this.shell(`pm path --user 0 ${quoteAndroidShell(app.appId)}`)).split('\n');
      if (paths.length !== 1 || !/^package:\/data\/app\/[^\r\n\0]+\/base\.apk$/.test(paths[0])) throw unsupported('Android recovery requires one installed base APK.');
      const path = paths[0].slice(8);
      if (await this.shell(`sha256sum ${quoteAndroidShell(path)}`) !== `${app.sha256}  ${path}`) throw mismatch('Installed APK differs from the original recovery record.');
      const identity = appIdentity(await this.shell(`dumpsys package ${quoteAndroidShell(app.appId)}`), app.appId);
      if (Number(identity.uid) !== app.uid) throw mismatch('Application UID changed before restoration.');
      const sdk = [...identity.block.matchAll(/\btargetSdk=(\d+)\b/g)];
      if (sdk.length !== 1 || Number(sdk[0][1]) !== app.targetSdk || app.targetSdk < 23) throw mismatch('Android runtime permission identity changed.');
      stopped = /\bstopped=true\b/.test(identity.user);
      if (!stopped && !/\bstopped=false\b/.test(identity.user)) throw failure('Android did not expose stopped state.');
      if (permission?.baseline.length) {
        permissions = await new AndroidPermissionPreparation({ deviceId: this.options.serial, appId: app.appId,
          adbPath: this.options.adbPath, executor: async (_tool, args) => Buffer.from(await this.run(args.slice(2))) })
          .inspect(permission.baseline.map(item => item.permission), this.options.context);
        for (const original of permission.baseline) {
          const actual = permissions.find(item => item.permission === original.permission)!;
          const immutable = (flags: string[]) => flags.filter(flag => !['USER_SET', 'USER_FIXED'].includes(flag)).sort().join('|');
          if (immutable(actual.flags) !== immutable(original.flags)) throw mismatch('Non-mutable permission flags changed from the original baseline.');
        }
      }
    } else if (!allowRemoved || !app.installedBySession) throw mismatch('The original application installation is missing.');
    const processInventory = await this.shell('ps -A -o UID,PID,NAME');
    let processes: AndroidProcess[];
    try { processes = parseAndroidProcessInventory(processInventory); }
    catch (cause) { throw new NativeError('cleanup_failed', 'Android recovery process inventory could not be verified.', { cause }); }
    const uidProcesses = processes.filter(item => item.uid === app.uid).length;
    if (!installed && uidProcesses) throw mismatch('The old UID still has processes after package removal.');
    const forwards = (await this.run(['forward', '--list'])).split('\n').filter(Boolean);
    if (forwards.some(line => !/^\S+\s+\S+\s+\S+$/.test(line))) throw failure('Invalid ADB forward inventory.');
    const mapping = app.forward, selected = mapping ? forwards.filter(line => line.trim().split(/\s+/)[1] === `tcp:${mapping.hostPort}`) : [];
    if (selected.length > 1 || selected.length && selected[0].trim() !== `${this.options.serial} tcp:${mapping!.hostPort} tcp:${mapping!.devicePort}`) throw mismatch('The recorded forward mapping now belongs to another resource.');
    await this.identity();
    return { installed, stopped, uidProcesses, permissions, forwardPresent: selected.length === 1 };
  }

  async mutate(args: string[]): Promise<void> {
    const stopping = args.length === 2 && args[0] === 'shell'
      && args[1] === `am force-stop --user 0 ${quoteAndroidShell(this.options.app.appId)}`;
    if (stopping) await this.identity();
    else {
      // The transaction's earlier observation may predate a restart. Recheck
      // installation, permissions, forward ownership and UID exit at dispatch.
      const state = await this.observe();
      if (!state.stopped || state.uidProcesses !== 0) {
        throw failure('The Android app is no longer confirmed stopped; recovery writes were refused without replaying force-stop.');
      }
    }
    const output = await this.run(args);
    if (args[0] === 'uninstall' ? output !== 'Success' : output !== '') {
      throw new NativeError('action_outcome_unknown', 'Android restoration did not return its expected acknowledgement.');
    }
    await this.identity();
  }

  private async identity(): Promise<void> {
    const { app, serial, avdName, context } = this.options;
    await new AndroidDeviceBinding({ path: await this.options.devicePath(), deviceId: serial, avdName,
      binding: { leaseKey: app.leaseKey, ownerGeneration: app.ownerGeneration }, readOnly: true,
      adbPath: this.options.adbPath, executor: this.options.executor, assertOwned: this.options.guard }).verify(context);
  }
  private shell(command: string): Promise<string> { return this.run(['shell', command]); }
  private async run(args: string[]): Promise<string> {
    const { context } = this.options;
    check(context); await this.options.guard();
    const result = await this.options.executor(this.options.adbPath ?? defaultAdbPath(), ['-s', this.options.serial, ...args], context);
    check(context); await this.options.guard();
    if (result.length > 1024 * 1024) throw failure('Android recovery output exceeds its limit.');
    return result.toString('utf8').trim();
  }
}

function check(context: NativeOperationContext): void {
  context.signal.throwIfAborted();
  if (Date.now() >= context.deadline) throw new NativeError('timeout', 'Android recovery budget expired.');
}
function mismatch(message: string): NativeError { return new NativeError('device_mismatch', message); }
function unsupported(message: string): NativeError { return new NativeError('unsupported_capability', message); }
function failure(message: string): NativeError { return new NativeError('cleanup_failed', message); }
