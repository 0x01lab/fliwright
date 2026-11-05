import type { ToolExecutor } from '../../src/ToolExecutor.js';

/** Deterministic platform observations, never an assertion that a real device was verified. */
export function androidDeviceIdentity(serial: string, avdName = 'dedicated-test') {
  const state = { serial, avdName, bootId: '11111111-1111-4111-8111-111111111111',
    fingerprint: 'test/android/device:35/build/version:userdebug/test-keys', sdk: '35' };
  const calls: string[][] = [];
  const executor: ToolExecutor = async (_program, args, context) => {
    context.signal.throwIfAborted(); calls.push([...args]);
    if (args[0] !== '-s' || args[1] !== serial) throw Error('Unexpected device identity target');
    const command = args.slice(2).join(' ');
    if (command === 'get-serialno') return Buffer.from(`${state.serial}\n`);
    if (command === 'emu avd name') return Buffer.from(`${state.avdName}\nOK\n`);
    if (command === 'shell cat /proc/sys/kernel/random/boot_id') return Buffer.from(`${state.bootId}\n`);
    if (command === 'shell getprop ro.build.fingerprint') return Buffer.from(`${state.fingerprint}\n`);
    if (command === 'shell getprop ro.build.version.sdk') return Buffer.from(`${state.sdk}\n`);
    throw Error('Unexpected device identity query');
  };
  return { state, executor, calls };
}
