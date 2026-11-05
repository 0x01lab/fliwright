import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { NativeError, type DeviceCapabilities, type NativeCommand, type NativeIdentity, type NativeOperationContext,
  type NativeSessionAdapter, type NativeSnapshot, type NativeNode, type NativeConfig } from '@fliwright/core';
import { executeTool, quoteAndroidShell, type ToolExecutor } from '../ToolExecutor.js';
import { parseAndroidSnapshot } from './AndroidSnapshot.js';

export interface AdbSessionOptions {
  deviceId: string;
  appId: string;
  kind: 'physical' | 'simulator';
  adbPath?: string;
  fingerprints?: NativeConfig['fingerprints'];
  /** Internal test seam for bounded platform execution. */
  executor?: ToolExecutor;
  /** Revalidate owner-bound device identity immediately before each ADB dispatch. */
  beforeCommand?: (context: NativeOperationContext) => Promise<void>;
}

/** Device-bound ADB adapter. Construct through createNativeSession to acquire a device lease. */
export class AdbSession implements NativeSessionAdapter {
  readonly identity: NativeIdentity;
  private readonly executor: ToolExecutor;
  private readonly adbPath: string;
  private latest?: NativeSnapshot;
  private closed = false;
  private readonly pendingFiles = new Set<string>();
  private readonly activeSnapshots = new Set<Promise<NativeSnapshot>>();

  constructor(private readonly options: AdbSessionOptions) {
    if (!options.deviceId || options.deviceId.startsWith('-') || /[\s\0]/.test(options.deviceId)
      || !/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+$/.test(options.appId)) {
      throw new NativeError('precondition_failed', 'An explicit device serial and application package ID are required.');
    }
    const fingers = options.fingerprints;
    if (fingers && (![fingers.enrolledId, fingers.unenrolledId].every(value => Number.isSafeInteger(value) && value >= 1 && value <= 10)
      || fingers.enrolledId === fingers.unenrolledId || Object.keys(fingers).some(key => !['enrolledId', 'unenrolledId'].includes(key)))) throw new NativeError('precondition_failed', 'Use distinct fingerprint IDs in the supported 1–10 range.');
    this.identity = { platform: 'android', deviceId: options.deviceId, appId: options.appId, backend: 'adb', generation: randomUUID() };
    this.executor = options.executor ?? executeTool;
    this.adbPath = options.adbPath ?? defaultAdbPath();
  }

  async capabilities(_context: NativeOperationContext): Promise<DeviceCapabilities> {
    this.checkOpen();
    const backend = this.identity.backend;
    const supported = { support: 'supported' as const, ready: true, backend };
    const unsupported = { support: 'unsupported' as const, ready: false, backend };
    const biometric = this.options.kind === 'physical' ? { ...unsupported, reason: 'Real biometric sensors require a human.' }
      : { support: 'unverified' as const, ready: false, backend, reason: 'Device-bound enrollment, challenge and baseline recovery have not been verified.' };
    return {
      ...Object.fromEntries(['native.query', 'native.click', 'native.fill.basic', 'native.swipe', 'native.back', 'screen.capture'].map(key => [key, supported])),
      'native.fill.unicode': { ...unsupported, reason: 'ADB text injection does not reliably replace Unicode text.' },
      'biometrics.match': biometric, 'biometrics.reject': biometric,
      'biometrics.enrollment': { ...unsupported, reason: 'Prepare enrollment on a dedicated emulator baseline.' },
    };
  }

  snapshot(context: NativeOperationContext): Promise<NativeSnapshot> {
    const work = this.captureSnapshot(context);
    this.activeSnapshots.add(work);
    void work.finally(() => this.activeSnapshots.delete(work)).catch(() => undefined);
    return work;
  }

  private async captureSnapshot(context: NativeOperationContext): Promise<NativeSnapshot> {
    this.checkOpen();
    const remote = `/data/local/tmp/fliwright-${randomUUID()}.xml`;
    this.pendingFiles.add(remote);
    try {
      const size = (await this.shell('wm size', context)).toString('utf8');
      const density = (await this.shell('wm density', context)).toString('utf8');
      const sizes = [...size.matchAll(/(?:Physical|Override) size:\s*(\d+)x(\d+)/g)];
      const densities = [...density.matchAll(/(?:Physical|Override) density:\s*(\d+)/g)];
      if (!sizes.length || !densities.length) throw new NativeError('protocol_mismatch', 'ADB did not report valid display size and density.');
      const lastSize = sizes.at(-1)!;
      const scale = Number(densities.at(-1)![1]) / 160;
      const dumped = (await this.shell(`uiautomator dump ${quoteAndroidShell(remote)}`, context)).toString('utf8');
      if (/ERROR:|could not|failed to/i.test(dumped)) throw new NativeError('runner_unavailable', 'Android could not dump an idle accessibility hierarchy.');
      const xml = (await this.shell(`cat ${quoteAndroidShell(remote)}`, context)).toString('utf8');
      this.latest = parseAndroidSnapshot(xml, this.identity, { width: Number(lastSize[1]), height: Number(lastSize[2]), scale });
      return this.latest;
    } finally {
      // Cleanup gets its own small budget even when the request has already timed out.
      await this.removeDump(remote).catch(() => undefined);
    }
  }

  async execute(command: NativeCommand, context: NativeOperationContext): Promise<unknown> {
    this.checkOpen();
    if (command.kind === 'click' || command.kind === 'fill') {
      const node = this.validateTarget(command.node, command.snapshotId);
      if (command.kind === 'fill') return this.fill(node, command.text, context);
      const point = this.center(node);
      await this.shell(`input tap ${point.x} ${point.y}`, context);
      return { acknowledged: true };
    }
    if (command.kind === 'back') { await this.shell('input keyevent KEYCODE_BACK', context); return { acknowledged: true }; }
    if (command.kind === 'swipe') {
      if (!this.latest) await this.snapshot(context);
      const scale = this.latest!.screen.scale;
      const values = [command.from.x * scale, command.from.y * scale, command.to.x * scale, command.to.y * scale, command.durationMs];
      if (!values.every(Number.isFinite) || command.durationMs <= 0) throw new NativeError('precondition_failed', 'Invalid swipe geometry.');
      await this.shell(`input swipe ${values.map(Math.round).join(' ')}`, context);
      return { acknowledged: true };
    }
    if (command.kind === 'biometric') {
      const capability = (await this.capabilities(context))[`biometrics.${command.result}`];
      if (capability.support !== 'supported') throw new NativeError('unsupported_capability', capability.reason!);
      if (!capability.ready) throw new NativeError('precondition_failed', capability.reason!);
      const finger = command.result === 'match' ? this.options.fingerprints!.enrolledId : this.options.fingerprints!.unenrolledId;
      const result = (await this.run(['emu', 'finger', 'touch', String(finger)], context)).toString('utf8');
      if (/KO:|ERROR/i.test(result)) throw new NativeError('precondition_failed', 'The emulator rejected the fingerprint event.');
      return { acknowledged: true, eventId: context.requestId };
    }
    throw new NativeError('unsupported_capability', `${command.kind} is not available through this ADB session.`);
  }

  async screenshot(context: NativeOperationContext): Promise<Buffer> {
    this.checkOpen();
    const png = await this.run(['exec-out', 'screencap', '-p'], context);
    if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new NativeError('protocol_mismatch', 'Android screenshot is not a PNG.');
    return png;
  }

  private validateTarget(node: NativeNode, snapshotId: string): NativeNode {
    const current = this.latest?.nodes.find(item => item.id === node.id);
    if (!current || snapshotId !== this.latest?.id || JSON.stringify(current) !== JSON.stringify(node)) {
      throw new NativeError('precondition_failed', 'Native target does not belong to the latest snapshot.');
    }
    if (!current.enabled || !current.visible) throw new NativeError('not_interactable', 'Native target is disabled or off screen.');
    return current;
  }
  private center(node: NativeNode): { x: number; y: number } {
    const { frame } = node;
    const { scale, width, height } = this.latest!.screen;
    // Use the visible intersection when a partially visible node spans outside the display.
    const left = Math.max(0, frame.x), top = Math.max(0, frame.y);
    const right = Math.min(width, frame.x + frame.width), bottom = Math.min(height, frame.y + frame.height);
    if (right <= left || bottom <= top) throw new NativeError('not_interactable', 'Native target has no visible screen area.');
    return { x: Math.round((left + right) / 2 * scale), y: Math.round((top + bottom) / 2 * scale) };
  }
  private async fill(node: NativeNode, text: string, context: NativeOperationContext): Promise<void> {
    if (node.password || !node.className?.endsWith('EditText') || /[^\x20-\x7e]/.test(text) || text.includes('%s')
      || text.length > 1024 || (node.text?.length ?? 0) > 1024) {
      throw new NativeError('unsupported_capability', 'ADB fill supports bounded ASCII non-password EditText values only; literal %s is unsupported.');
    }
    const point = this.center(node);
    await this.shell(`input tap ${point.x} ${point.y}`, context);
    await this.shell('input keyevent KEYCODE_MOVE_END', context);
    if (node.text?.length) await this.shell(`input keyevent ${Array(node.text.length).fill('KEYCODE_DEL').join(' ')}`, context);
    if (text) await this.shell(`input text ${quoteAndroidShell(text.replaceAll(' ', '%s'))}`, context);
    const readback = await this.snapshot(context);
    const candidates = readback.nodes.filter(item => item.appId === node.appId && item.resourceId === node.resourceId && item.className === node.className);
    if (candidates.length !== 1 || candidates[0].text !== text) throw new NativeError('action_outcome_unknown', 'Native input could not be verified after replacement; it will not be repeated.');
  }
  private shell(command: string, context: NativeOperationContext): Promise<Buffer> { return this.run(['shell', command], context); }
  private run(args: string[], context: NativeOperationContext): Promise<Buffer> {
    context.signal.throwIfAborted();
    return Promise.resolve(this.options.beforeCommand?.(context)).then(() => {
      context.signal.throwIfAborted();
      return this.executor(this.adbPath, ['-s', this.options.deviceId, ...args], context);
    });
  }
  private checkOpen(): void { if (this.closed) throw new NativeError('cancelled', 'ADB session has closed.'); }
  async dispose(): Promise<void> {
    this.closed = true;
    await Promise.allSettled([...this.activeSnapshots]);
    await Promise.allSettled([...this.pendingFiles].map(path => this.removeDump(path)));
    this.latest = undefined;
    if (this.pendingFiles.size) throw new NativeError('cleanup_failed', 'Owned Android accessibility dumps could not be removed.');
  }
  private async removeDump(path: string): Promise<void> {
    await this.shell(`rm -f ${quoteAndroidShell(path)}`, {
      requestId: `cleanup-${randomUUID()}`, deadline: Date.now() + 2000, signal: AbortSignal.timeout(2000),
    });
    this.pendingFiles.delete(path);
  }
}

export function defaultAdbPath(): string {
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || (process.platform === 'darwin'
    ? join(homedir(), 'Library', 'Android', 'sdk') : process.platform === 'win32'
      ? join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'Android', 'Sdk') : join(homedir(), 'Android', 'Sdk'));
  const path = join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
  return existsSync(path) ? path : 'adb';
}
