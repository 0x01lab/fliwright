import { NativeError, parseAndroidPermissionDeclarations, type AndroidPermissionObservation, type NativeOperationContext } from '@fliwright/core';
import { defaultAdbPath } from './AdbSession.js';
import { executeTool, quoteAndroidShell, type ToolExecutor } from '../ToolExecutor.js';
import type { AndroidPermissionCheckpoint, AndroidPermissionJournal } from './AndroidPermissionJournal.js';
import { parseAndroidProcessInventory } from './AndroidProcessInventory.js';

const permissions = { camera: 'android.permission.CAMERA', microphone: 'android.permission.RECORD_AUDIO' } as const;
type PermissionName = keyof typeof permissions;
export interface NativePermissionRequest { permission: string; state: 'granted' | 'denied' | 'prompt'; }
export type AndroidPermissionState = AndroidPermissionObservation;
const mutableFlags = ['USER_SET', 'USER_FIXED'];
const ordinaryFlags = new Set([...mutableFlags, 'USER_SENSITIVE_WHEN_GRANTED', 'USER_SENSITIVE_WHEN_DENIED']);

/** Package-manager preparation only. System UI/app-op/business coverage needs separate acceptance. */
export class AndroidPermissionPreparation {
  private readonly baseline = new Map<PermissionName, AndroidPermissionState>();
  private baselineUid?: number;
  private declaration: NativePermissionRequest[] = [];
  private desired: AndroidPermissionState[] = [];
  private busy = false;
  private unknown = false;
  private readonly executor: ToolExecutor;
  constructor(private readonly options: { deviceId: string; appId: string; adbPath?: string; executor?: ToolExecutor; journal?: AndroidPermissionJournal }) {
    if (!options.deviceId || options.deviceId.startsWith('-') || /[\s\0]/.test(options.deviceId)
      || !/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+$/.test(options.appId)) {
      throw new NativeError('precondition_failed', 'Permission preparation requires an explicit device and application package.');
    }
    this.executor = options.executor ?? executeTool;
  }
  get outcomeUnknown(): boolean { return this.unknown; }
  get hasBaseline(): boolean { return this.baseline.size > 0; }

  /** Managed launcher primitive: stop the selected isolated app, then prove the stop. */
  async stopApp(context: NativeOperationContext): Promise<void> {
    this.assertIdle();
    this.busy = true;
    try {
      await this.assertJournal(context);
      await this.assertPrimaryUser(context);
      // Validate identity and installation before issuing any destructive command.
      const { uid } = appIdentity((await this.run(`dumpsys package ${quoteAndroidShell(this.options.appId)}`, context)).toString('utf8'), this.options.appId);
      this.assertUid(Number(uid));
      await this.checkpoint({ uid: Number(uid), status: 'pending', step: 'stop', restored: false }, context);
      this.unknown = true;
      await this.mutate(`am force-stop --user 0 ${quoteAndroidShell(this.options.appId)}`, context);
      await this.assertStopped(context);
      await this.checkpoint({ uid: Number(uid), status: 'verified', step: 'stopped', restored: !this.baseline.size }, context);
      this.unknown = false;
    } finally { this.busy = false; }
  }

  /** Independent, read-only observation after launch. Does not create a restoration baseline. */
  async inspect(input: readonly string[], context: NativeOperationContext): Promise<AndroidPermissionState[]> {
    this.assertIdle();
    if (!Array.isArray(input) || !input.length || input.length > 2 || new Set(input).size !== input.length
      || input.some(name => !Object.hasOwn(permissions, name))) throw new NativeError('precondition_failed', 'Observe unique camera/microphone permission names.');
    this.busy = true;
    try {
      await this.assertPrimaryUser(context);
      return [...(await this.read([...input] as PermissionName[], context)).values()];
    } finally { this.busy = false; }
  }

  private assertIdle(): void {
    if (this.unknown) throw new NativeError('cleanup_failed', 'Android app preparation outcome is unknown; explicit device recovery is required.');
    if (this.busy) throw new NativeError('precondition_failed', 'Android app preparation or observation is already running.');
  }

  /** Replaces the attempt declaration; omitted permissions return to the captured original state. */
  async prepare(input: readonly NativePermissionRequest[], context: NativeOperationContext): Promise<AndroidPermissionState[]> {
    this.assertIdle();
    const requested = validateRequests(input);
    if (!requested.size && !this.baseline.size) return [];
    this.busy = true;
    let wrote = false;
    try {
      await this.assertJournal(context);
      const uid = await this.assertStopped(context);
      const before = await this.read([...new Set([...this.baseline.keys(), ...requested.keys()])], context, uid);
      // Validate the entire batch before any mutation and capture each baseline only once.
      for (const [name, state] of before) if (!this.baseline.has(name)) this.baseline.set(name, state);
      this.baselineUid ??= uid;
      const desired = new Map<PermissionName, AndroidPermissionState>();
      for (const [name, original] of this.baseline) {
        const declaration = requested.get(name);
        const flags = declaration === undefined ? [...original.flags] : original.flags.filter(flag => !mutableFlags.includes(flag));
        if (declaration === 'denied') flags.push('USER_SET');
        desired.set(name, { permission: name, granted: declaration === undefined ? original.granted : declaration === 'granted',
          userSet: flags.includes('USER_SET'), userFixed: flags.includes('USER_FIXED'), flags: flags.sort() });
      }
      this.declaration = [...requested].map(([permission, state]) => ({ permission, state }));
      this.desired = [...desired.values()];
      await this.checkpoint({ uid, status: 'pending', step: 'baseline', restored: false }, context);
      for (const [name, state] of desired) {
        if (sameState(before.get(name)!, state)) continue;
        await this.assertStopped(context);
        const target = `${quoteAndroidShell(this.options.appId)} ${quoteAndroidShell(permissions[name])}`;
        // Mark before dispatch: a lost ADB reply cannot prove the write did not execute.
        wrote = true;
        this.unknown = true;
        await this.checkpoint({ uid, status: 'pending', step: state.granted ? 'grant' : 'revoke', permission: name, restored: false }, context);
        await this.mutate(`pm ${state.granted ? 'grant' : 'revoke'} --user 0 ${target}`, context);
        await this.checkpoint({ uid, status: 'pending', step: 'clear-flags', permission: name, restored: false }, context);
        await this.mutate(`pm clear-permission-flags --user 0 ${target} user-set user-fixed`, context);
        const flags = [state.userSet ? 'user-set' : '', state.userFixed ? 'user-fixed' : ''].filter(Boolean);
        if (flags.length) {
          await this.checkpoint({ uid, status: 'pending', step: 'set-flags', permission: name, restored: false }, context);
          await this.mutate(`pm set-permission-flags --user 0 ${target} ${flags.join(' ')}`, context);
        }
      }
      await this.checkpoint({ uid, status: 'pending', step: 'readback', restored: false }, context);
      await this.assertStopped(context);
      const after = await this.read([...desired.keys()], context, uid);
      for (const [name, expected] of desired) if (!sameState(after.get(name)!, expected)) {
        throw new NativeError('action_outcome_unknown', 'Android permission grant/flags did not match the declared state after preparation.');
      }
      await this.checkpoint({ uid, status: 'verified', step: 'readback', observed: [...after.values()],
        restored: [...this.baseline].every(([name, state]) => sameState(after.get(name)!, state)) }, context);
      this.unknown = false;
      return [...after.values()];
    } catch (error) {
      if (wrote) this.unknown = true;
      throw error;
    } finally { this.busy = false; }
  }

  restore(context: NativeOperationContext): Promise<AndroidPermissionState[]> { return this.prepare([], context); }

  private async assertStopped(context: NativeOperationContext): Promise<number> {
    await this.assertPrimaryUser(context);
    const { user, uid } = appIdentity((await this.run(`dumpsys package ${quoteAndroidShell(this.options.appId)}`, context)).toString('utf8'), this.options.appId);
    this.assertUid(Number(uid));
    if (!/\bstopped=true\b/.test(user)) {
      throw new NativeError('precondition_failed', 'The target app must be force-stopped by its managed launcher before permission preparation.');
    }
    const processes = parseAndroidProcessInventory((await this.run('ps -A -o UID,PID,NAME', context)).toString('utf8'));
    // Manifest process names need not start with the package name. Check the isolated UID.
    if (processes.some(item => item.uid === Number(uid))) {
      throw new NativeError('precondition_failed', 'Stop every process of the managed app before preparing or restoring Android permissions.');
    }
    return Number(uid);
  }

  private async assertPrimaryUser(context: NativeOperationContext): Promise<void> {
    if ((await this.run('am get-current-user', context)).toString('utf8').trim() !== '0') {
      throw new NativeError('unsupported_capability', 'Permission preparation currently requires the primary Android user.');
    }
  }

  private async read(names: PermissionName[], context: NativeOperationContext, expectedUid?: number): Promise<Map<PermissionName, AndroidPermissionState>> {
    const output = (await this.run(`dumpsys package ${quoteAndroidShell(this.options.appId)}`, context)).toString('utf8');
    const { uid } = appIdentity(output, this.options.appId);
    this.assertUid(Number(uid));
    if (expectedUid !== undefined && Number(uid) !== expectedUid) throw new NativeError('device_mismatch', 'Android permission application UID changed during observation.');
    const states = new Map(names.map(name => [name, parseAndroidPermissionState(output, this.options.appId, name)]));
    for (const name of names) {
      const appOp = name === 'camera' ? 'CAMERA' : 'RECORD_AUDIO';
      const value = (await this.run(`cmd appops get --user 0 ${quoteAndroidShell(this.options.appId)} ${appOp}`, context)).toString('utf8').trim();
      // Custom or UID-wide app-op policy cannot be restored through package permission flags.
      if (value !== 'No operations.' && !new RegExp(`^${appOp}: default(?:;[^\\n]*)?$`).test(value)) {
        throw new NativeError('unsupported_capability', 'Permission preparation requires default package app-op policy; custom and UID modes need a separately verified baseline.');
      }
    }
    return states;
  }
  private assertUid(uid: number): void {
    if (this.baselineUid !== undefined && uid !== this.baselineUid) throw new NativeError('device_mismatch', 'Android permission baseline belongs to a different application UID.');
  }
  private async assertJournal(context: NativeOperationContext): Promise<void> {
    try { await this.options.journal?.assertOwned(context); }
    catch (cause) {
      this.unknown = true;
      throw new NativeError('cleanup_failed', 'Android permission recovery ownership could not be confirmed; no further preparation is allowed.', { cause });
    }
  }
  private async checkpoint(input: Omit<AndroidPermissionCheckpoint, 'baseline' | 'declaration' | 'desired'>, context: NativeOperationContext): Promise<void> {
    if (!this.options.journal) return;
    try {
      await this.options.journal.checkpoint({ ...input, baseline: [...this.baseline.values()], declaration: this.declaration, desired: this.desired }, context);
    } catch (cause) {
      this.unknown = true;
      throw new NativeError('cleanup_failed', 'Android permission recovery checkpoint could not be confirmed; explicit recovery is required.', { cause });
    }
  }
  private async mutate(command: string, context: NativeOperationContext): Promise<void> {
    if ((await this.run(command, context)).toString('utf8').trim()) {
      throw new NativeError('action_outcome_unknown', 'Android permission mutation did not return its expected acknowledgement.');
    }
  }
  private async run(command: string, context: NativeOperationContext): Promise<Buffer> {
    context.signal.throwIfAborted();
    if (context.deadline <= Date.now()) throw new NativeError('timeout', 'Android permission preparation deadline exceeded.');
    const output = await this.executor(this.options.adbPath ?? defaultAdbPath(), ['-s', this.options.deviceId, 'shell', command], context);
    context.signal.throwIfAborted();
    return output;
  }
}

/** Strictly select the target package and primary user; never infer flags from a different profile. */
export function parseAndroidPermissionState(output: string, appId: string, permission: PermissionName): AndroidPermissionState {
  const { block } = appIdentity(output, appId);
  const sdk = [...block.matchAll(/\btargetSdk=(\d+)\b/g)];
  if (sdk.length !== 1 || Number(sdk[0][1]) < 23 || /\bsharedUser(?:Id)?=(?!null\b)\S/.test(block)) {
    throw new NativeError('unsupported_capability', 'Permission preparation requires a runtime-permission app without a shared UID.');
  }
  const users = [...block.matchAll(/^[ \t]*User (\d+):([^\n]*)/gm)];
  const selectedUsers = users.filter(user => user[1] === '0');
  if (selectedUsers.length !== 1 || !/\binstalled=true\b/.test(selectedUsers[0][2]) || /\b(?:hidden|suspended)=true\b/.test(selectedUsers[0][2])) {
    throw new NativeError('precondition_failed', 'The target app is not installed and available for the primary Android user.');
  }
  const user = selectedUsers[0], nextUser = users.find(item => item.index! > user.index!);
  const userBlock = block.slice(user.index!, nextUser?.index);
  const runtime = /^[ \t]*runtime permissions:[ \t]*$/m.exec(userBlock);
  if (!runtime) throw new NativeError('unsupported_capability', 'Android did not expose runtime permission state for the app.');
  const lines = userBlock.slice(runtime.index + runtime[0].length).split('\n');
  const relevant = lines.filter(line => line.trimStart().startsWith(`${permissions[permission]}:`));
  const parsed = relevant.length === 1 ? /^[ \t]*android\.permission\.[A-Z_]+: granted=(true|false), flags=\[([^\]\n]*)\][ \t]*$/.exec(relevant[0]) : null;
  if (!parsed) throw new NativeError('protocol_mismatch', 'Android did not report an unambiguous permission grant and flags.');
  const flags = parsed[2].split(/[|,\s]+/).filter(Boolean).sort();
  if (flags.some(flag => !ordinaryFlags.has(flag)) || new Set(flags).size !== flags.length) {
    throw new NativeError('unsupported_capability', 'Permission flags require a dedicated restorable baseline; fixed, one-time and unknown flags are not changed.');
  }
  return { permission, granted: parsed[1] === 'true', userSet: flags.includes('USER_SET'), userFixed: flags.includes('USER_FIXED'), flags };
}

export function appIdentity(output: string, appId: string): { block: string; user: string; uid: string } {
  const block = targetPackage(output, appId);
  const ids = [...block.matchAll(/^[ \t]*(?:userId|appId)=(\d+)[ \t]*$/gm)];
  if (ids.length !== 1 || Number(ids[0][1]) < 10000 || Number(ids[0][1]) >= 100000
    || /\bsharedUser(?:Id)?=(?!null\b)\S/.test(block)) {
    throw new NativeError('unsupported_capability', 'Android app preparation requires an unambiguous isolated application UID for user 0.');
  }
  const users = [...block.matchAll(/^[ \t]*User 0:([^\n]*)/gm)];
  if (users.length !== 1 || !/\binstalled=true\b/.test(users[0][1]) || /\b(?:hidden|suspended)=true\b/.test(users[0][1])) {
    throw new NativeError('precondition_failed', 'The target app is not installed and available for the primary Android user.');
  }
  return { block, user: users[0][1], uid: ids[0][1] };
}

function targetPackage(output: string, appId: string): string {
  if (Buffer.byteLength(output) > 1024 * 1024) throw new NativeError('protocol_mismatch', 'Android package permission output exceeds its size limit.');
  const packages = [...output.matchAll(/^[ \t]*Package \[([^\]\n]+)\][^\n]*:/gm)];
  const matches = packages.filter(match => match[1] === appId);
  if (matches.length !== 1) throw new NativeError('protocol_mismatch', 'Android did not report exactly one target package.');
  const selected = matches[0], next = packages.find(match => match.index! > selected.index!);
  return output.slice(selected.index!, next?.index);
}

function sameState(a: AndroidPermissionState, b: AndroidPermissionState): boolean {
  return a.granted === b.granted && a.userSet === b.userSet && a.userFixed === b.userFixed && a.flags.join('|') === b.flags.join('|');
}
function validateRequests(input: readonly NativePermissionRequest[]): Map<PermissionName, NativePermissionRequest['state']> {
  try { return new Map(parseAndroidPermissionDeclarations(input).map(item => [item.permission, item.state])); }
  catch (cause) { throw new NativeError('precondition_failed', 'Permission declarations must be unique camera/microphone states.', { cause }); }
}
