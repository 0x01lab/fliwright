import { describe, expect, it, vi } from 'vitest';
import type { NativeOperationContext } from '@fliwright/core';
import type { ToolExecutor } from '../../src/ToolExecutor.js';
import { AndroidPermissionPreparation, parseAndroidPermissionState } from '../../src/android/AndroidPermissionPreparation.js';

function dump(camera = 'granted=false, flags=[ USER_SENSITIVE_WHEN_GRANTED|USER_SENSITIVE_WHEN_DENIED]', microphone = 'granted=true, flags=[ USER_SET]') {
  return `Packages:
  Package [example.app] (123):
    userId=10123
    versionCode=1 minSdk=24 targetSdk=35
    requested permissions:
      android.permission.CAMERA
      android.permission.RECORD_AUDIO
    User 0: installed=true hidden=false stopped=true
      runtime permissions:
        android.permission.CAMERA: ${camera}
        android.permission.RECORD_AUDIO: ${microphone}
    User 10: installed=true hidden=false
      runtime permissions:
        android.permission.CAMERA: granted=true, flags=[ USER_FIXED]
`;
}
const context = (): NativeOperationContext => ({ requestId: 'test', deadline: Date.now() + 1000, signal: AbortSignal.timeout(1000) });

function fixture() {
  const state = { camera: { granted: false, flags: [] as string[] }, microphone: { granted: true, flags: ['USER_SET'] } };
  let running = false, stopped = true, appOps = 'No operations.', failMutation = false, changeReadback = false, ignoreStop = false;
  const commands: string[] = [];
  const executor: ToolExecutor = vi.fn(async (_program, args, request) => {
    request.signal.throwIfAborted();
    expect(args.slice(0, 3)).toEqual(['-s', 'emulator-owned', 'shell']);
    const command = args[3]; commands.push(command);
    if (command === 'am get-current-user') return Buffer.from('0\n');
    if (command === 'ps -A -o UID,PID,NAME') return Buffer.from(`UID PID NAME\n0 1 init\n${running ? '10123 45 custom.camera.process\n' : ''}`);
    if (command.startsWith('dumpsys package ')) {
      const describe = (item: typeof state.camera) => `granted=${item.granted}, flags=[ ${item.flags.join('|')}]`;
      return Buffer.from(dump(describe(state.camera), describe(state.microphone)).replace('stopped=true', `stopped=${stopped}`));
    }
    if (command.startsWith('cmd appops get ')) return Buffer.from(appOps);
    if (command.startsWith('am force-stop ')) {
      if (failMutation) throw new Error('ADB disconnected after stop');
      if (!ignoreStop) { running = false; stopped = true; }
      return Buffer.alloc(0);
    }
    if (command.startsWith('pm ')) {
      if (failMutation) throw new Error('ADB disconnected after write');
      const permission = command.includes('android.permission.CAMERA') ? state.camera : state.microphone;
      if (!changeReadback) {
        if (command.startsWith('pm grant ')) permission.granted = true;
        else if (command.startsWith('pm revoke ')) permission.granted = false;
        else if (command.startsWith('pm clear-permission-flags ')) permission.flags = [];
        else if (command.startsWith('pm set-permission-flags ')) permission.flags = [
          ...(command.includes('user-set') ? ['USER_SET'] : []), ...(command.includes('user-fixed') ? ['USER_FIXED'] : []),
        ];
        else throw new Error('Unexpected mutation');
      }
      return Buffer.alloc(0);
    }
    throw new Error(`Unexpected command ${command}`);
  });
  return { state, commands, executor, preparation: new AndroidPermissionPreparation({ deviceId: 'emulator-owned', appId: 'example.app', executor }),
    setRunning: () => { running = true; }, setAppOps: (value: string) => { appOps = value; },
    setNotStopped: () => { stopped = false; },
    ignoreStop: () => { ignoreStop = true; },
    failMutation: () => { failMutation = true; }, ignoreMutations: () => { changeReadback = true; } };
}

describe('Android permission manager preparation', () => {
  it('parses only the target package and current user, refusing unknown or non-restorable states', () => {
    expect(parseAndroidPermissionState(dump(), 'example.app', 'camera')).toMatchObject({ granted: false, userSet: false, userFixed: false });
    expect(parseAndroidPermissionState(dump(), 'example.app', 'microphone')).toMatchObject({ granted: true, userSet: true });
    for (const value of [dump().replace('targetSdk=35', 'targetSdk=22'), dump().replace('installed=true', 'installed=false'),
      dump('granted=false, flags=[ SYSTEM_FIXED]'), dump('granted=true, flags=[ ONE_TIME]'),
      dump().replace('Package [example.app]', 'Package [other.app]'), dump().replace('User 0:', 'User 1:'),
      dump().replace('granted=false', 'granted=maybe'), dump().replace('userId=10123', 'sharedUser=SharedUserSetting{shared}')]) {
      expect(() => parseAndroidPermissionState(value, 'example.app', 'camera')).toThrow();
    }
  });

  it('prepares grant, first prompt and prior denial separately and restores the initial state between tasks', async () => {
    const f = fixture();
    await f.preparation.prepare([{ permission: 'camera', state: 'granted' }], context());
    expect(f.state.camera).toEqual({ granted: true, flags: [] });
    await f.preparation.prepare([{ permission: 'camera', state: 'denied' }], context());
    expect(f.state.camera).toEqual({ granted: false, flags: ['USER_SET'] });
    await f.preparation.prepare([{ permission: 'camera', state: 'prompt' }, { permission: 'microphone', state: 'denied' }], context());
    expect(f.state.camera).toEqual({ granted: false, flags: [] });
    expect(f.state.microphone).toEqual({ granted: false, flags: ['USER_SET'] });
    await f.preparation.prepare([], context());
    expect(f.state.microphone).toEqual({ granted: true, flags: ['USER_SET'] });
    expect(f.state.camera).toEqual({ granted: false, flags: [] });
    const before = f.commands.length;
    await f.preparation.restore(context());
    expect(f.commands.slice(before).filter(command => command.startsWith('pm '))).toEqual([]);
  });

  it('validates the whole request and requires a stopped app and ordinary app-op modes before writing', async () => {
    for (const reason of ['duplicate', 'unknown', 'running', 'not-stopped', 'appops', 'uid-appops']) {
      const f = fixture();
      if (reason === 'running') f.setRunning();
      if (reason === 'not-stopped') f.setNotStopped();
      if (reason === 'appops') f.setAppOps('CAMERA: ignore');
      if (reason === 'uid-appops') f.setAppOps('Uid mode: CAMERA: allow');
      const input = [{ permission: 'camera', state: 'granted' as const },
        ...(reason === 'duplicate' ? [{ permission: 'camera', state: 'denied' as const }] : []),
        ...(reason === 'unknown' ? [{ permission: 'photos', state: 'granted' as const }] : [])];
      await expect(f.preparation.prepare(input, context())).rejects.toThrow();
      expect(f.commands.filter(command => command.startsWith('pm '))).toEqual([]);
      expect(f.preparation.outcomeUnknown).toBe(false);
    }
  });

  it('does not replay unknown writes or restore over an unconfirmed preparation', async () => {
    for (const fault of ['disconnect', 'readback']) {
      const f = fixture();
      if (fault === 'disconnect') f.failMutation(); else f.ignoreMutations();
      await expect(f.preparation.prepare([{ permission: 'camera', state: 'granted' }], context())).rejects.toThrow();
      expect(f.preparation.outcomeUnknown).toBe(true);
      const count = f.commands.length;
      await expect(f.preparation.prepare([], context())).rejects.toThrow(/unknown|unconfirmed/i);
      await expect(f.preparation.restore(context())).rejects.toThrow(/unknown|unconfirmed/i);
      expect(f.commands).toHaveLength(count);
    }
  });

  it.each([
    ['duplicate PID', 'UID PID NAME\n0 1 init\n1000 7 system.server\n2000 7 other.process\n'],
    ['unsafe UID', 'UID PID NAME\n0 1 init\n9007199254740992 7 other.process\n'],
    ['unsafe PID', 'UID PID NAME\n0 1 init\n1000 9007199254740992 other.process\n'],
    ['extra column', 'UID PID NAME\n0 1 init\n1000 7 other.process unexpected\n'],
    ['missing init', 'UID PID NAME\n1000 7 other.process\n'],
  ])('rejects %s instead of treating the UID as stopped', async (_name, inventory) => {
    for (const operation of ['prepare', 'stop', 'restore'] as const) {
      const f = fixture();
      if (operation === 'restore') await f.preparation.prepare([{ permission: 'camera', state: 'granted' }], context());
      const execute = vi.mocked(f.executor).getMockImplementation()!;
      vi.mocked(f.executor).mockImplementation(async (program, args, request) => {
        if (args[3] === 'ps -A -o UID,PID,NAME') return Buffer.from(inventory);
        return execute(program, args, request);
      });
      const before = f.commands.length;
      const result = operation === 'stop' ? f.preparation.stopApp(context())
        : operation === 'restore' ? f.preparation.restore(context())
          : f.preparation.prepare([{ permission: 'camera', state: 'granted' }], context());
      await expect(result, operation).rejects.toMatchObject({ code: 'protocol_mismatch' });
      expect(f.commands.slice(before).filter(command => command.startsWith('pm '))).toEqual([]);
      // A dispatched force-stop without valid readback remains unknown and cannot be replayed.
      expect(f.preparation.outcomeUnknown).toBe(operation === 'stop');
    }
  });

  it('compares process UIDs numerically before declaring the managed app stopped', async () => {
    const f = fixture(), execute = vi.mocked(f.executor).getMockImplementation()!;
    vi.mocked(f.executor).mockImplementation(async (program, args, request) => args[3] === 'ps -A -o UID,PID,NAME'
      ? Buffer.from('UID PID NAME\n0 1 init\n010123 7 custom.worker\n') : execute(program, args, request));
    await expect(f.preparation.prepare([{ permission: 'camera', state: 'granted' }], context()))
      .rejects.toMatchObject({ code: 'precondition_failed' });
    expect(f.commands.some(command => command.startsWith('pm '))).toBe(false);
  });

  it('force-stops only the validated app and confirms its entire UID has exited before preparation', async () => {
    const f = fixture(); f.setRunning(); f.setNotStopped();
    await f.preparation.stopApp(context());
    expect(f.commands.filter(command => command.startsWith('am force-stop'))).toEqual(["am force-stop --user 0 'example.app'"]);
    expect(f.preparation.outcomeUnknown).toBe(false);
    await f.preparation.prepare([{ permission: 'camera', state: 'granted' }], context());
    expect(f.state.camera.granted).toBe(true);
    for (const fault of ['lost-reply', 'still-running']) {
      const broken = fixture(); broken.setRunning(); broken.setNotStopped();
      if (fault === 'lost-reply') broken.failMutation(); else broken.ignoreStop();
      await expect(broken.preparation.stopApp(context())).rejects.toThrow();
      expect(broken.preparation.outcomeUnknown).toBe(true);
      const count = broken.commands.length;
      await expect(broken.preparation.stopApp(context())).rejects.toThrow(/unknown/i);
      await expect(broken.preparation.prepare([], context())).rejects.toThrow(/unknown/i);
      expect(broken.commands).toHaveLength(count);
    }
  });

  it('observes launched app permission state independently without changing permissions or capturing a restore baseline', async () => {
    const f = fixture(); f.setRunning(); f.setNotStopped();
    const states = await f.preparation.inspect(['camera', 'microphone'], context());
    expect(states).toMatchObject([{ permission: 'camera', granted: false }, { permission: 'microphone', granted: true, userSet: true }]);
    expect(f.commands.some(command => command.startsWith('pm ') || command.startsWith('am force-stop'))).toBe(false);
    const count = f.commands.length;
    await f.preparation.restore(context());
    expect(f.commands).toHaveLength(count);
    await expect(f.preparation.inspect(['camera', 'camera'], context())).rejects.toThrow();
    await expect(f.preparation.inspect(['photos'], context())).rejects.toThrow();
    expect(f.commands).toHaveLength(count);
  });

  it('refuses to force-stop an unavailable or ambiguous package before dispatching a mutation', async () => {
    for (const output of [dump().replace('Package [example.app]', 'Package [other.app]'),
      dump().replace('userId=10123', 'userId=1000'), dump().replace('userId=10123', 'userId=10123\n    appId=10124'),
      dump().replace('userId=10123', 'userId=10123\n    sharedUserId=example.shared'),
      dump().replace('installed=true', 'installed=false'), dump().replace('hidden=false', 'hidden=true'),
      dump().replace('User 0:', 'User 1:')]) {
      const commands: string[] = [];
      const preparation = new AndroidPermissionPreparation({ deviceId: 'emulator-owned', appId: 'example.app',
        executor: async (_program, args) => {
          commands.push(args[3]);
          if (args[3] === 'am get-current-user') return Buffer.from('0');
          if (args[3].startsWith('dumpsys package')) return Buffer.from(output);
          throw new Error('Unexpected dispatch');
        } });
      await expect(preparation.stopApp(context())).rejects.toThrow();
      expect(commands.some(command => command.startsWith('am force-stop') || command.startsWith('pm '))).toBe(false);
      expect(preparation.outcomeUnknown).toBe(false);
    }
  });

  it('treats a successful stop reply with a surviving custom UID process as unconfirmed', async () => {
    const commands: string[] = [];
    const preparation = new AndroidPermissionPreparation({ deviceId: 'emulator-owned', appId: 'example.app',
      executor: async (_program, args) => {
        const command = args[3]; commands.push(command);
        if (command === 'am get-current-user') return Buffer.from('0');
        if (command.startsWith('dumpsys package')) return Buffer.from(dump());
        if (command.startsWith('am force-stop')) return Buffer.alloc(0);
        if (command.startsWith('ps ')) return Buffer.from('UID PID NAME\n0 1 init\n10123 99 custom.worker\n');
        throw new Error('Unexpected command');
      } });
    await expect(preparation.stopApp(context())).rejects.toThrow(/every process/i);
    expect(preparation.outcomeUnknown).toBe(true);
    const count = commands.length;
    await expect(preparation.restore(context())).rejects.toThrow(/unknown/i);
    expect(commands).toHaveLength(count);
  });
});
