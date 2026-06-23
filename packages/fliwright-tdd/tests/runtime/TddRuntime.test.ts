import { describe, expect, it, vi } from 'vitest';
import { TddRuntime } from '../../src/runtime/TddRuntime.js';

describe('TddRuntime', () => {
  it('starts in attach mode, focuses, resets baseline, and reruns the focused test', async () => {
    const driver = {
      connect: vi.fn(async () => {}),
      dispose: vi.fn(async () => {}),
      reloadSources: vi.fn(async () => ({})),
      page: { resetToHome: vi.fn(async () => {}) },
      mock: { clear: vi.fn(async () => {}), clearCalls: vi.fn(async () => {}) },
    };
    const executor = {
      boot: vi.fn(async () => {}),
      rerun: vi.fn(async () => ({ status: 'green' as const, testName: 'alpha passes' })),
      dispose: vi.fn(async () => {}),
    };
    const runtime = new TddRuntime({
      driverFactory: () => driver,
      executor,
    });

    const snapshot = await runtime.start({
      configRoot: '/tmp/vitest.config.ts',
      vmServiceUrl: 'ws://vm/ws',
    });
    await runtime.focus('/tmp/sample.test.ts', 'alpha passes');
    const result = await runtime.cycle();

    expect(snapshot.connected).toBe(true);
    expect(snapshot.launchMode).toBe('attach');
    expect(snapshot.fixtureDriverSharing).toBe('vm-service-url');
    expect(driver.connect).toHaveBeenCalledWith('ws://vm/ws');
    expect(executor.boot).toHaveBeenCalledWith(expect.objectContaining({
      configRoot: '/tmp/vitest.config.ts',
      vmServiceUrl: 'ws://vm/ws',
    }));
    expect(driver.page.resetToHome).toHaveBeenCalledWith({ homeRoute: '/' });
    expect(executor.rerun).toHaveBeenCalledWith('/tmp/sample.test.ts', 'alpha passes');
    expect(result.status).toBe('green');
    expect(result.baselineVersion).toBe(1);
  });
});
