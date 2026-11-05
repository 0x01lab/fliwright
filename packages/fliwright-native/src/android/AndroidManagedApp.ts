import { NativeError, type NativeOperationContext } from '@fliwright/core';
import { randomUUID } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { executeTool, quoteAndroidShell, type ToolExecutor } from '../ToolExecutor.js';
import { defaultAdbPath } from './AdbSession.js';
import { appIdentity } from './AndroidPermissionPreparation.js';
import { checkAndroidAppDeadline, withAndroidApk } from './AndroidApk.js';
import { AndroidAppJournal } from './AndroidAppJournal.js';
import { parseAndroidProcessInventory, type AndroidProcess } from './AndroidProcessInventory.js';

export interface AndroidAppInstallInput { apkPath: string; apkAnalyzerPath: string; }
export interface AndroidInstalledApp {
  appId: string; activity: string; sha256: string; uid: number; installedBySession: boolean;
  minSdk: number; targetSdk: number; permissions: string[];
}
export interface AndroidAppLaunch { url: string; pid: number; generation: string; }

/** Owned single-APK installation and launch, without flutter run's reinstall path. */
export class AndroidManagedApp {
  private readonly executor: ToolExecutor;
  private installed?: AndroidInstalledApp;
  private forward?: { hostPort: number; devicePort: number };
  private launched = false;
  private unknown = false;
  private closed = false;
  private busy = false;
  private readonly journal: AndroidAppJournal;
  constructor(private readonly options: { deviceId: string; appId: string; adbPath?: string; recoveryPath: string;
    recoveryBinding?: { leaseKey: string; ownerGeneration: string }; executor?: ToolExecutor; assertOwned?(): Promise<void> }) {
    if (!options.deviceId || options.deviceId.startsWith('-') || /[\s\0]/.test(options.deviceId)
      || !/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+$/.test(options.appId)
      || !isAbsolute(options.recoveryPath) || options.recoveryPath.includes('\0')) throw new NativeError('precondition_failed', 'Managed app installation requires an owned device, package and private recovery path.');
    this.executor = options.executor ?? executeTool;
    this.journal = new AndroidAppJournal({ path: options.recoveryPath, deviceId: options.deviceId,
      recoveryBinding: options.recoveryBinding, assertOwned: options.assertOwned });
  }
  get outcomeUnknown(): boolean { return this.unknown; }
  get hasInstallation(): boolean { return this.installed !== undefined; }
  get recoverySummary(): Pick<AndroidInstalledApp, 'sha256' | 'uid' | 'installedBySession'> | undefined {
    return this.installed && { sha256: this.installed.sha256, uid: this.installed.uid, installedBySession: this.installed.installedBySession };
  }

  install(input: AndroidAppInstallInput, context: NativeOperationContext): Promise<AndroidInstalledApp> {
    return this.operation(context, async () => {
      if (this.installed) throw new NativeError('precondition_failed', 'Install the managed APK once before preparing attempts.');
      try {
        await lstat(this.options.recoveryPath);
        throw new NativeError('cleanup_failed', 'A managed app recovery record already exists; verify prior cleanup before reuse.');
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      return withAndroidApk(input, this.options.appId, this.executor, context, async apk => {
        await this.primaryUser(context);
        const existing = await this.isInstalled(context);
        const installed: AndroidInstalledApp = { appId: apk.appId, activity: apk.activity, sha256: apk.sha256, uid: 0,
          installedBySession: !existing, minSdk: apk.minSdk, targetSdk: apk.targetSdk, permissions: [...apk.permissions] };
        if (!existing) {
          await this.singleUser(context);
          await this.checkpoint('install', installed, context);
          this.unknown = true;
          const output = (await this.run(['install', '-t', '--user', '0', apk.path], context)).toString('utf8');
          if (!/^(?:Performing (?:Streamed|Push) Install\r?\n)?Success\s*$/.test(output)) throw new NativeError('action_outcome_unknown', 'APK installation did not return its expected acknowledgement.');
        }
        installed.uid = await this.verifyInstallation(installed, context, false);
        await this.checkpoint('installed', installed, context);
        this.installed = installed;
        this.unknown = false;
        return { ...installed, permissions: [...installed.permissions] };
      });
    });
  }

  launch(context: NativeOperationContext): Promise<AndroidAppLaunch> {
    return this.operation(context, async () => {
      const app = this.requireInstalled();
      if (this.launched || this.forward) throw new NativeError('precondition_failed', 'Confirm the previous managed app is stopped before relaunching.');
      await this.verifyInstallation(app, context);
      await this.assertStopped(app, context);
      const cursor = logCursor((await this.shell('logcat -b main -d -v epoch -t 1', context)).toString('utf8'));
      await this.checkpoint('launch', app, context);
      this.unknown = true;
      const component = quoteAndroidShell(`${app.appId}/${app.activity}`);
      const output = (await this.shell(`am start --user 0 -a android.intent.action.MAIN -c android.intent.category.LAUNCHER -n ${component} --ez enable-checked-mode true --ez verify-entry-points true`, context)).toString('utf8');
      if (!output.includes('Starting: Intent') || /error|exception|warning/i.test(output)) throw new NativeError('action_outcome_unknown', 'Android did not acknowledge a fresh managed app launch.');
      let pid: number | undefined, uri: URL | undefined;
      while (!uri) {
        checkAndroidAppDeadline(context);
        const processes = await this.processes(context);
        const matches = processes.filter(item => item.uid === app.uid && item.name === app.appId);
        if (matches.length > 1 || (pid && (matches.length !== 1 || matches[0].pid !== pid))) throw new NativeError('device_mismatch', 'The managed app process changed during VM endpoint discovery.');
        if (matches.length) {
          pid = matches[0].pid;
          const logs = (await this.shell(`logcat -b main -d -v epoch --pid=${pid} -T ${quoteAndroidShell(cursor)}`, context)).toString('utf8');
          uri = vmUri(logs, pid, cursor);
        }
        if (!uri) await delay(Math.min(100, Math.max(1, context.deadline - Date.now())), undefined, { signal: context.signal });
      }
      const devicePort = Number(uri.port);
      await this.checkpoint('forward', app, context);
      const port = (await this.run(['forward', 'tcp:0', `tcp:${devicePort}`], context)).toString('utf8').trim();
      if (!/^[1-9]\d*$/.test(port) || Number(port) > 65535) throw new NativeError('action_outcome_unknown', 'ADB did not identify the owned VM forwarding port.');
      this.forward = { hostPort: Number(port), devicePort };
      await this.assertForward(context);
      await this.checkpoint('forward', app, context);
      // Do not return an endpoint if the app exited or its PID changed while forwarding.
      const current = (await this.processes(context)).filter(item => item.uid === app.uid && item.name === app.appId);
      if (current.length !== 1 || current[0].pid !== pid) throw new NativeError('device_mismatch', 'The managed app exited before VM binding.');
      await this.checkpoint('running', app, context);
      this.launched = true; this.unknown = false;
      uri.protocol = 'ws:'; uri.hostname = '127.0.0.1'; uri.port = port; uri.pathname += 'ws';
      return { url: uri.href, pid: pid!, generation: randomUUID() };
    });
  }

  /** Guard later stop/permission writes against replacement of the verified installation. */
  assertInstalled(context: NativeOperationContext): Promise<void> {
    return this.operation(context, async () => { await this.verifyInstallation(this.requireInstalled(), context); });
  }

  /** The launcher stops the app first; this method only verifies and cleans owned forwarding. */
  confirmStopped(context: NativeOperationContext): Promise<void> {
    return this.operation(context, async () => { await this.stopped(context); });
  }

  dispose(context: NativeOperationContext): Promise<void> {
    return this.operation(context, async () => {
      if (!this.installed) { this.closed = true; return; }
      await this.stopped(context);
      const app = this.installed;
      if (app.installedBySession) {
        await this.singleUser(context);
        await this.checkpoint('uninstall', app, context);
        this.unknown = true;
        const output = (await this.run(['uninstall', app.appId], context)).toString('utf8').trim();
        if (output !== 'Success' || await this.isInstalled(context)) throw new NativeError('action_outcome_unknown', 'Owned APK removal could not be confirmed.');
        await this.checkpoint('removed', app, context);
        this.unknown = false;
      }
      this.closed = true;
    });
  }

  /** Called by the retained owner only after permission restoration and all owned cleanup. */
  async complete(context: NativeOperationContext): Promise<void> {
    if (!this.closed || this.busy || this.unknown) throw new NativeError('cleanup_failed', 'Complete managed app cleanup before removing its recovery evidence.');
    this.busy = true;
    try { await this.journal.complete(context); }
    catch (cause) {
      this.unknown = true;
      throw new NativeError('cleanup_failed', 'Managed app recovery completion could not be confirmed; explicit recovery is required.', { cause });
    } finally { this.busy = false; }
  }

  private async stopped(context: NativeOperationContext): Promise<void> {
    const app = this.requireInstalled();
    await this.verifyInstallation(app, context);
    await this.assertStopped(app, context);
    if (this.forward) {
      await this.assertForward(context);
      await this.checkpoint('remove-forward', app, context);
      this.unknown = true;
      const { hostPort } = this.forward;
      if ((await this.run(['forward', '--remove', `tcp:${hostPort}`], context)).toString('utf8').trim()) throw new NativeError('action_outcome_unknown', 'Owned VM forwarding removal was not acknowledged.');
      const remaining = (await this.run(['forward', '--list'], context)).toString('utf8');
      if (remaining.split('\n').some(line => line.trim().split(/\s+/)[1] === `tcp:${hostPort}`)) throw new NativeError('cleanup_failed', 'Owned VM forwarding is still present.');
      this.forward = undefined;
    }
    await this.checkpoint('stopped', app, context);
    this.launched = false; this.unknown = false;
  }

  private async verifyInstallation(app: AndroidInstalledApp, context: NativeOperationContext, compareUid = true): Promise<number> {
    await this.primaryUser(context);
    const paths = (await this.shell(`pm path --user 0 ${quoteAndroidShell(app.appId)}`, context)).toString('utf8').trim().split('\n');
    if (paths.length !== 1 || !/^package:\/data\/app\/[^\r\n\0]+\/base\.apk$/.test(paths[0])) throw new NativeError('precondition_failed', 'Only one verifiable installed base APK is supported; split or unavailable packages are refused.');
    const path = paths[0].slice('package:'.length);
    const hash = (await this.shell(`sha256sum ${quoteAndroidShell(path)}`, context)).toString('utf8').trim();
    if (hash !== `${app.sha256}  ${path}`) throw new NativeError('precondition_failed', 'The installed APK differs from the managed artifact; automatic replacement is refused.');
    const identity = appIdentity((await this.shell(`dumpsys package ${quoteAndroidShell(app.appId)}`, context)).toString('utf8'), app.appId);
    const uid = Number(identity.uid);
    if (compareUid && uid !== app.uid) throw new NativeError('device_mismatch', 'The installed application UID changed during the managed session.');
    return uid;
  }

  private async assertStopped(app: AndroidInstalledApp, context: NativeOperationContext): Promise<void> {
    const identity = appIdentity((await this.shell(`dumpsys package ${quoteAndroidShell(app.appId)}`, context)).toString('utf8'), app.appId);
    if (Number(identity.uid) !== app.uid || !/\bstopped=true\b/.test(identity.user)
      || (await this.processes(context)).some(item => item.uid === app.uid)) throw new NativeError('precondition_failed', 'Confirm the managed app and all its UID processes are stopped before launch or cleanup.');
  }

  private async processes(context: NativeOperationContext): Promise<AndroidProcess[]> {
    return parseAndroidProcessInventory((await this.shell('ps -A -o UID,PID,NAME', context)).toString('utf8'));
  }

  private async isInstalled(context: NativeOperationContext): Promise<boolean> {
    const packages = (await this.shell(`pm list packages -u --user 0 ${quoteAndroidShell(this.options.appId)}`, context)).toString('utf8').trim();
    if (!packages) return false;
    const lines = packages.split('\n');
    if (lines.some(line => !/^package:[A-Za-z][\w]*(?:\.[A-Za-z0-9_]+)+$/.test(line))) throw new NativeError('protocol_mismatch', 'Android package inventory could not be verified.');
    return lines.includes(`package:${this.options.appId}`);
  }
  private async primaryUser(context: NativeOperationContext): Promise<void> {
    if ((await this.shell('am get-current-user', context)).toString('utf8').trim() !== '0') throw new NativeError('unsupported_capability', 'Managed APK preparation currently requires primary Android user 0.');
  }
  private async singleUser(context: NativeOperationContext): Promise<void> {
    const lines = (await this.shell('pm list users', context)).toString('utf8').trim().split('\n');
    if (lines.shift()?.trim() !== 'Users:' || lines.length !== 1 || !/^\s*UserInfo\{0:[^{}\r\n]+\}(?: running)?\s*$/.test(lines[0])) {
      throw new NativeError('unsupported_capability', 'Owning a new APK installation requires a dedicated emulator with only primary user 0.');
    }
  }
  private async assertForward(context: NativeOperationContext): Promise<void> {
    const { hostPort, devicePort } = this.forward!;
    const matches = (await this.run(['forward', '--list'], context)).toString('utf8').split('\n').filter(line => line.trim().split(/\s+/)[1] === `tcp:${hostPort}`);
    if (matches.length !== 1 || matches[0].trim() !== `${this.options.deviceId} tcp:${hostPort} tcp:${devicePort}`) throw new NativeError('device_mismatch', 'The VM forwarding port is no longer owned by this device session.');
  }
  private async checkpoint(operation: string, app: AndroidInstalledApp, context: NativeOperationContext): Promise<void> {
    try {
      await this.journal.checkpoint({ operation, ...app, ...(this.forward ? { forward: this.forward } : {}) }, context);
    } catch (cause) {
      this.unknown = true;
      throw new NativeError('cleanup_failed', 'Managed app recovery checkpoint could not be confirmed; explicit recovery is required.', { cause });
    }
  }
  private requireInstalled(): AndroidInstalledApp {
    if (!this.installed) throw new NativeError('precondition_failed', 'Verify the managed APK installation before launch.');
    return this.installed;
  }
  private async operation<T>(context: NativeOperationContext, action: () => Promise<T>): Promise<T> {
    if (this.unknown) throw new NativeError('cleanup_failed', 'Managed app mutation outcome is unknown; explicit recovery is required.');
    if (this.closed || this.busy) throw new NativeError('precondition_failed', 'Managed app lifecycle is closed or already running.');
    checkAndroidAppDeadline(context); this.busy = true;
    try {
      try { await this.journal.assertOwned(context); }
      catch (cause) {
        if (!this.installed) throw cause;
        this.unknown = true;
        throw new NativeError('cleanup_failed', 'Managed app recovery ownership could not be confirmed; no further platform work is allowed.', { cause });
      }
      return await action();
    } finally { this.busy = false; }
  }
  private shell(command: string, context: NativeOperationContext): Promise<Buffer> { return this.run(['shell', command], context); }
  private async run(args: string[], context: NativeOperationContext): Promise<Buffer> {
    checkAndroidAppDeadline(context);
    const output = await this.executor(this.options.adbPath ?? defaultAdbPath(), ['-s', this.options.deviceId, ...args], context);
    checkAndroidAppDeadline(context); return output;
  }
}

function logCursor(output: string): string {
  const records = output.split('\n').filter(line => line.trim() && !line.startsWith('--------- beginning of '));
  if (!records.length) return '0.000000';
  if (records.length !== 1 || !/^\d{10,}\.\d{6}\s+\d+\s+\d+\s+[VDIWEFAS]\s/.test(records[0])) throw new NativeError('protocol_mismatch', 'Android log cursor could not be verified.');
  return records[0].split(/\s+/)[0];
}
function vmUri(output: string, pid: number, cursor: string): URL | undefined {
  const candidates: URL[] = [];
  for (const line of output.split('\n')) {
    const parsed = /^(\d{10,}\.\d{6})\s+(\d+)\s+\d+\s+[VDIWEFAS]\s+flutter\s*:\s*(?:The Dart VM service|Dart VM service|Observatory) is listening on (\S+)\s*$/.exec(line);
    if (!parsed || Number(parsed[2]) !== pid || Number(parsed[1]) <= Number(cursor)) continue;
    let uri: URL;
    try { uri = new URL(parsed[3]); } catch { throw new NativeError('protocol_mismatch', 'Android reported an invalid VM service endpoint.'); }
    if (uri.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(uri.hostname) || !/^[1-9]\d*$/.test(uri.port)
      || Number(uri.port) > 65535 || uri.username || uri.password || uri.search || uri.hash || !/^\/[A-Za-z0-9_=-]+\/$/.test(uri.pathname)) throw new NativeError('protocol_mismatch', 'Android VM service must use authenticated device loopback.');
    if (!candidates.some(candidate => candidate.href === uri.href)) candidates.push(uri);
  }
  if (candidates.length > 1) throw new NativeError('device_mismatch', 'Android advertised multiple current VM service endpoints.');
  return candidates[0];
}
