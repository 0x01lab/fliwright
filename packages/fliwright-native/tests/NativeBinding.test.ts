import { describe, expect, it, vi } from 'vitest';
import { verifyNativeAppProcess } from '../src/NativeBinding.js';
import type { ToolExecutor } from '../src/ToolExecutor.js';

const config = { enabled: true, platform: 'android' as const, deviceId: 'chosen-device', targetAppId: 'example.app' };
describe('VM process and native device binding', () => {
  it('checks the current VM PID against the exact app process on the selected Android device', async () => {
    const executor = vi.fn<ToolExecutor>(async () => Buffer.from('PID NAME\n4242 example.app\n55 other.app\n'));
    await verifyNativeAppProcess(config, 4242, { executor });
    expect(executor.mock.calls[0][1]).toEqual(['-s', 'chosen-device', 'shell', 'ps -A -o PID,NAME']);
    await expect(verifyNativeAppProcess(config, 55, { executor })).rejects.toMatchObject({ code: 'device_mismatch' });
    await expect(verifyNativeAppProcess(config, undefined, { executor })).rejects.toMatchObject({ code: 'device_mismatch' });
    expect(executor).toHaveBeenCalledTimes(2);
  });
  it('requires an exact iOS application label and matching host PID on the chosen Simulator', async () => {
    const executor = vi.fn<ToolExecutor>(async () => Buffer.from('4242 0 application.example.app.ABC\n55 0 application.example.app.other.ABC\n'));
    const ios = { ...config, platform: 'ios' as const };
    await verifyNativeAppProcess(ios, 4242, { executor });
    expect(executor.mock.calls[0][1]).toEqual(['simctl', 'spawn', 'chosen-device', 'launchctl', 'list']);
    await expect(verifyNativeAppProcess(ios, 55, { executor })).rejects.toMatchObject({ code: 'device_mismatch' });
  });
  it('binds the actual iOS 26 UIKitApplication label without accepting another app, stale PID or malformed label', async () => {
    const ios = { ...config, platform: 'ios' as const, targetAppId: 'dev.fliwright.formDemo' };
    const executor = vi.fn<ToolExecutor>(async () => Buffer.from('PID\tStatus\tLabel\n9758\t0\tUIKitApplication:dev.fliwright.formDemo[15c4][rb-legacy]\n'));
    await verifyNativeAppProcess(ios, 9758, { executor });
    await expect(verifyNativeAppProcess(ios, 9757, { executor })).rejects.toMatchObject({ code: 'device_mismatch' });
    for (const label of ['UIKitApplication:dev.fliwright.formDemo.other[15c4][rb-legacy]',
      'UIKitApplication:dev.fliwright.formDemo[15c4][rb-legacy]extra',
      'UIKitApplication:dev.fliwright.formDemo[15c4]', 'UIKitApplication:dev.fliwright.formDemo[][rb-legacy]']) {
      await expect(verifyNativeAppProcess(ios, 9758, { executor: async () => Buffer.from(`9758\t0\t${label}\n`) })).rejects.toMatchObject({ code: 'device_mismatch' });
    }
  });
  it('preserves transport failures instead of accepting stale workspace metadata', async () => {
    await expect(verifyNativeAppProcess(config, 4242, { executor: async () => { throw new Error('disconnected'); } })).rejects.toThrow('disconnected');
  });
});
