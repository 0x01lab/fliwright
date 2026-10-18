import { expect, it, vi } from 'vitest';
import { EndpointLeaseManager } from '@fliwright/core';
import { TddRuntime } from '../../src/runtime/TddRuntime.js';

it('releases the control lease before a fixture acquires the same endpoint', async () => {
  const endpoint = `ws://tdd-handoff-${process.pid}/ws`;
  const leases = new EndpointLeaseManager();
  const driver = { connect: vi.fn(async () => {}), dispose: vi.fn(async () => {}) };
  const executor = { boot: vi.fn(async () => {}), dispose: vi.fn(async () => {}), rerun: vi.fn(async () => {
    const lease = await leases.acquire(endpoint, { signal: AbortSignal.timeout(1000) });
    try { return { status: 'green' as const }; } finally { await lease.release(); }
  }) };
  const baseline = { version: 1, reset: vi.fn(async () => {
    // A different async scope cannot enter control work while reset is active.
    expect(driver.connect).toHaveBeenCalled();
    return { version: 1, applied: [], unsupported: [] };
  }) };
  const runtime = new TddRuntime({ driverFactory: () => driver, executor, baseline });
  await runtime.start({ configRoot: '/tmp', vmServiceUrl: endpoint });
  await runtime.focus('x.test.ts');
  try { expect((await runtime.cycle()).status).toBe('green'); await runtime.whenIdle(); }
  finally { await runtime.stop(); }
});
