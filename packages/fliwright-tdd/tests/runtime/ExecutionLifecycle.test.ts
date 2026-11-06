import { describe, expect, it, vi } from 'vitest';
import { TddRuntime } from '../../src/runtime/TddRuntime.js';

function fixture() {
  const drivers: Array<{ disposed: boolean; reset: ReturnType<typeof vi.fn> }> = [];
  const executor = { boot: vi.fn(async (_opts: unknown) => {}), dispose: vi.fn(async () => {}), rerun: vi.fn(async () => ({ status: 'green' as const })) };
  const runtime = new TddRuntime({ executor, driverFactory: () => {
    const state = { disposed: false, reset: vi.fn(async () => { if (state.disposed) throw Error('old driver'); }) };
    drivers.push(state);
    return { connect: async () => {}, dispose: async () => { state.disposed = true; },
      page: { resetToHome: state.reset }, mock: { clear: async () => {}, clearCalls: async () => {} } };
  } });
  return { runtime, drivers, executor };
}

describe('execution lifecycle', () => {
  it('resets through the new driver after reconnect', async () => {
    const { runtime, drivers } = fixture();
    try {
      await runtime.start({ configRoot: '/tmp', vmServiceUrl: 'ws://fake/ws' });
      await runtime.focus('proof.test.ts');
      await runtime.reconnect();
      expect(await runtime.cycle()).toMatchObject({ status: 'green', unsupportedState: [] });
      expect(drivers[0].reset).not.toHaveBeenCalled();
      expect(drivers[1].reset).toHaveBeenCalledOnce();
    } finally { await runtime.stop(); }
  });

  it('rejects reconfiguration of the named default scenario during start', async () => {
    const { runtime } = fixture();
    try {
      await runtime.start({ configRoot: '/tmp', vmServiceUrl: 'ws://fake/ws', defaultScenario: 'member' });
      await expect(runtime.start({ configRoot: '/tmp', vmServiceUrl: 'ws://fake/ws', defaultScenario: 'guest' })).rejects.toThrow(/different options/);
    } finally { await runtime.stop(); }
  });

  it('changes the worker scenario by name without a second scenario application path', async () => {
    const { runtime, executor, drivers } = fixture();
    try {
      await runtime.start({ configRoot: '/tmp', vmServiceUrl: 'ws://fake/ws' });
      await runtime.setDefaultScenario('guest');
      await runtime.focus('proof.test.ts');
      await runtime.cycle();
      expect(executor.boot).toHaveBeenLastCalledWith(expect.objectContaining({ defaultScenario: 'guest' }));
      expect(drivers[0].reset).not.toHaveBeenCalled();
    } finally { await runtime.stop(); }
  });
});
