import { describe, expect, it, vi } from 'vitest';
import { createServerState } from '../src/state.js';
import { handleTddCycle, handleTddFocus, handleTddStart, handleTddStop } from '../src/tools/tdd.js';

describe('TDD MCP handlers', () => {
  it('starts, focuses, cycles, and stops a lazy runtime', async () => {
    const state = createServerState();
    const runtime = {
      start: vi.fn(async () => ({ connected: true, daemonStatus: 'running' as const, supportsRestart: false, launchMode: 'attach' as const, restartCapable: false, driverConnections: 1, fixtureDriverSharing: 'vm-service-url' as const, baselineVersion: 0 })),
      focus: vi.fn(async () => {}),
      cycle: vi.fn(async () => ({ status: 'green' as const, file: 'a.test.ts', durationMs: 1, lastSync: 'none' as const, baselineVersion: 1 })),
      stop: vi.fn(async () => {}),
      snapshot: vi.fn(() => ({ connected: false, daemonStatus: 'stopped' as const, supportsRestart: false, launchMode: 'attach' as const, restartCapable: false, driverConnections: 1, fixtureDriverSharing: 'vm-service-url' as const, baselineVersion: 1 })),
    } as any;

    const start = await handleTddStart({
      configRoot: '/tmp/vitest.config.ts',
      vmServiceUrl: 'ws://vm/ws',
    }, state, () => runtime);
    const focus = await handleTddFocus({ file: 'a.test.ts', testName: 'alpha' }, state);
    const cycle = await handleTddCycle({ sync: 'none' }, state);
    const stop = await handleTddStop({ keepAppAlive: true }, state);

    expect(start.connected).toBe(true);
    expect(focus.connected).toBe(false);
    expect(cycle.status).toBe('green');
    expect(stop.connected).toBe(false);
    expect(state.getTddRuntime()).toBeNull();
  });
});
