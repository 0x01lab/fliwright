import { describe, expect, it, vi } from 'vitest';
import { AdbSession } from '../src/android/AdbSession.js';
import type { ToolExecutor } from '../src/ToolExecutor.js';
import type { NativeOperationContext } from '@fliwright/core';

const context = (): NativeOperationContext => ({ requestId: 'request', deadline: Date.now() + 5000, signal: new AbortController().signal });
const xml = '<hierarchy rotation="0"><node package="example.app" text="Go" resource-id="example.app:id/go" class="android.widget.EditText" enabled="true" bounds="[20,40][100,80]"/></hierarchy>';
function setup() {
  const run = vi.fn<ToolExecutor>(async (_bin, args) => {
    const cmd = args.join(' ');
    if (cmd.includes('wm size')) return Buffer.from('Physical size: 400x800');
    if (cmd.includes('wm density')) return Buffer.from('Physical density: 320');
    if (cmd.includes('cat ')) return Buffer.from(xml);
    if (cmd.includes('screencap')) return Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    return Buffer.from('');
  });
  const session = new AdbSession({ deviceId: 'emulator-5580', appId: 'example.app', kind: 'simulator', executor: run });
  return { run, session };
}
describe('ADB native adapter', () => {
  it('retries only its own failed dump cleanup and refuses clean disposal while files remain', async () => {
    const { session, run } = setup();
    const normal = run.getMockImplementation()!;
    let canRemove = false;
    run.mockImplementation(async (...args) => {
      if (args[1].join(' ').includes('rm -f') && !canRemove) throw new Error('disconnected during cleanup');
      return normal(...args);
    });
    await session.snapshot(context());
    await expect(session.dispose()).rejects.toMatchObject({ code: 'cleanup_failed' });
    canRemove = true;
    await session.dispose();
    const files = run.mock.calls.filter(([, args]) => args.join(' ').includes('rm -f')).map(([, args]) => args.at(-1));
    expect(new Set(files).size).toBe(1);
  });
  it('uses explicit serials and per-request files, parses XML and removes its dump', async () => {
    const { session, run } = setup();
    const snapshot = await session.snapshot(context());
    expect(snapshot.nodes[0].frame).toEqual({ x: 10, y: 20, width: 40, height: 20 });
    expect(run.mock.calls.every(([, args]) => args[0] === '-s' && args[1] === 'emulator-5580')).toBe(true);
    const commands = run.mock.calls.map(([, args]) => args.join(' '));
    expect(commands.some(cmd => /uiautomator.*fliwright-.*\.xml/.test(cmd))).toBe(true);
    expect(commands.at(-1)).toContain('rm ');
  });
  it('revalidates device identity before each command in a multi-command operation', async () => {
    const { run } = setup();
    let checks = 0;
    const session = new AdbSession({ deviceId: 'emulator-5580', appId: 'example.app', kind: 'simulator', executor: run,
      beforeCommand: async () => {
        checks += 1;
        if (checks === 2) throw new Error('boot identity changed');
      } });
    await expect(session.snapshot(context())).rejects.toThrow('boot identity changed');
    expect(checks).toBeGreaterThanOrEqual(2);
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1][1].join(' ')).toContain('rm ');
    await session.dispose();
  });
  it('cleans a dump after parse failure and preserves the original error', async () => {
    const { session, run } = setup();
    run.mockImplementation(async (_bin, args) => {
      const cmd = args.join(' ');
      if (cmd.includes('wm size')) return Buffer.from('Physical size: 400x800');
      if (cmd.includes('wm density')) return Buffer.from('Physical density: 320');
      if (cmd.includes('cat ')) return Buffer.from('invalid');
      return Buffer.from('');
    });
    await expect(session.snapshot(context())).rejects.toMatchObject({ code: 'protocol_mismatch' });
    expect(run.mock.calls.at(-1)?.[1].join(' ')).toContain('rm ');
  });
  it('converts logical click coordinates to physical input and refuses old snapshots', async () => {
    const { session, run } = setup();
    const first = await session.snapshot(context());
    await session.execute({ kind: 'click', node: first.nodes[0], snapshotId: first.id }, context());
    expect(run.mock.calls.at(-1)?.[1]).toContain("input tap 60 60");
    await session.snapshot(context());
    await expect(session.execute({ kind: 'click', node: first.nodes[0], snapshotId: first.id }, context())).rejects.toMatchObject({ code: 'precondition_failed' });
  });
  it('refuses Unicode and password fields before any input command', async () => {
    const { session, run } = setup();
    const snapshot = await session.snapshot(context());
    const before = run.mock.calls.length;
    await expect(session.execute({ kind: 'fill', node: snapshot.nodes[0], snapshotId: snapshot.id, text: '你好' }, context())).rejects.toMatchObject({ code: 'unsupported_capability' });
    expect(run.mock.calls.length).toBe(before);
  });
  it('does not declare unconfigured or physical-device biometrics ready', async () => {
    const { session } = setup();
    expect((await session.capabilities(context()))['biometrics.match']).toMatchObject({ ready: false });
    const physical = new AdbSession({ deviceId: 'usb-phone', appId: 'example.app', kind: 'physical' });
    expect((await physical.capabilities(context()))['biometrics.match']).toMatchObject({ support: 'unsupported' });
  });
  it('requires a distinct configured enrolled and unenrolled fingerprint ID', () => {
    expect(() => new AdbSession({ deviceId: 'emulator-5580', appId: 'example.app', kind: 'simulator',
      fingerprints: { enrolledId: 1, unenrolledId: 1 } })).toThrow();
  });
  it('does not treat caller-declared fingerprint IDs or a boolean as a verified enrollment baseline', async () => {
    const executor = vi.fn();
    const session = new AdbSession({ deviceId: 'emulator-5580', appId: 'example.app', kind: 'simulator',
      fingerprints: { enrolledId: 1, unenrolledId: 2 }, executor });
    for (const result of ['match', 'reject'] as const) {
      expect((await session.capabilities(context()))[`biometrics.${result}`]).toMatchObject({ support: 'unverified', ready: false });
      await expect(session.execute({ kind: 'biometric', result }, context())).rejects.toMatchObject({ code: 'unsupported_capability' });
    }
    expect(executor).not.toHaveBeenCalled();
    expect(() => new AdbSession({ deviceId: 'emulator-5580', appId: 'example.app', kind: 'simulator', executor,
      fingerprints: { enrolledId: 1, unenrolledId: 2, baselineVerified: true } as unknown as NonNullable<ConstructorParameters<typeof AdbSession>[0]['fingerprints']>,
    })).toThrow();
  });

});
