import { describe, expect, it, vi } from 'vitest';
import { TddRuntime } from '../../src/runtime/TddRuntime.js';
import type { TddCycleResult, TddRepairPlannerLike } from '../../src/types.js';

function attachDriver() {
  return {
    connect: vi.fn(async () => {}),
    dispose: vi.fn(async () => {}),
    page: { resetToHome: vi.fn(async () => {}) },
    mock: { clear: vi.fn(async () => {}), clearCalls: vi.fn(async () => {}) },
  };
}

/** Builds a red TddCycleResult matching what performCycle returns for the focused test. */
function redResult(file: string, testName: string, message = 'No widget found matching selector'): TddCycleResult {
  return expect.objectContaining({ status: 'red', file, testName, failure: { message } }) as unknown as TddCycleResult;
}

describe('TddRuntime repair closed loop', () => {
  it('safe-apply flips a red test to green within the iteration cap', async () => {
    const driver = attachDriver();
    let rerunCalls = 0;
    const executor = {
      boot: vi.fn(async () => {}),
      // Red on the initial cycle and the first repair re-cycle; green on the second repair re-cycle.
      rerun: vi.fn(async () => {
        rerunCalls += 1;
        if (rerunCalls <= 2) return { status: 'red' as const, testName: 'alpha', failure: { message: 'No widget found' } };
        return { status: 'green' as const, testName: 'alpha' };
      }),
      dispose: vi.fn(async () => {}),
    };
    const applied = vi.fn(async () => ({ accepted: true, action: { kind: 'dismissModal' } }));
    const repair: TddRepairPlannerLike = { propose: vi.fn(async () => ({ mode: 'safe-apply', diff: 'd', proposals: [], applied: [await applied()] })) };
    const runtime = new TddRuntime({ driverFactory: () => driver, executor, repair });

    await runtime.start({ configRoot: '/tmp/vitest.config.ts', vmServiceUrl: 'ws://vm/ws' });
    await runtime.focus('/tmp/sample.test.ts', 'alpha');

    const result = await runtime.cycle(undefined, { sync: 'none', repair: { mode: 'safe-apply', iterations: 3 } });

    expect(result.status).toBe('green');
    expect((result as any).repair).toBeDefined();
    // Initial red + 2 repair re-cycles = 3 reruns; planner called twice (once per red iteration).
    expect(executor.rerun).toHaveBeenCalledTimes(3);
    expect(repair.propose).toHaveBeenCalledTimes(2);
    expect((result as any).repair.capped).toBe(false);
    expect((result as any).repair.steps).toHaveLength(2);
  });

  it('stops at the iteration cap still red and marks the trace capped', async () => {
    const driver = attachDriver();
    const executor = {
      boot: vi.fn(async () => {}),
      rerun: vi.fn(async () => ({ status: 'red' as const, testName: 'alpha', failure: { message: 'No widget found' } })),
      dispose: vi.fn(async () => {}),
    };
    const repair: TddRepairPlannerLike = {
      propose: vi.fn(async () => ({ mode: 'safe-apply', diff: 'd', proposals: [], applied: [{ accepted: true, action: { kind: 'dismissModal' } }] })),
    };
    const runtime = new TddRuntime({ driverFactory: () => driver, executor, repair });

    await runtime.start({ configRoot: '/tmp/vitest.config.ts', vmServiceUrl: 'ws://vm/ws' });
    await runtime.focus('/tmp/sample.test.ts', 'alpha');

    const result = await runtime.cycle(undefined, { sync: 'none', repair: { mode: 'safe-apply', iterations: 2 } });

    expect(result.status).toBe('red');
    expect((result as any).repair.capped).toBe(true);
    // Initial cycle + 2 repair re-cycles = 3 reruns; planner called twice (cap reached).
    expect(executor.rerun).toHaveBeenCalledTimes(3);
    expect(repair.propose).toHaveBeenCalledTimes(2);
  });

  it('safe-apply stops early when no safe repair can be applied (no infinite loop)', async () => {
    const driver = attachDriver();
    const executor = {
      boot: vi.fn(async () => {}),
      rerun: vi.fn(async () => ({ status: 'red' as const, testName: 'alpha', failure: { message: 'No widget found' } })),
      dispose: vi.fn(async () => {}),
    };
    // Planner proposes but nothing safe is applied → loop must terminate after one proposal.
    const repair: TddRepairPlannerLike = {
      propose: vi.fn(async () => ({ mode: 'safe-apply', diff: 'd', proposals: [{ proposal: { kind: 'codePatch', patch: 'p' }, safe: false }] })),
    };
    const runtime = new TddRuntime({ driverFactory: () => driver, executor, repair });

    await runtime.start({ configRoot: '/tmp/vitest.config.ts', vmServiceUrl: 'ws://vm/ws' });
    await runtime.focus('/tmp/sample.test.ts', 'alpha');

    const result = await runtime.cycle(undefined, { sync: 'none', repair: { mode: 'safe-apply', iterations: 5 } });

    expect(result.status).toBe('red');
    expect((result as any).repair.capped).toBe(false);
    // Only the initial cycle ran; planner called once; no re-cycle because nothing was applied.
    expect(executor.rerun).toHaveBeenCalledTimes(1);
    expect(repair.propose).toHaveBeenCalledTimes(1);
  });

  it('suggest mode emits the diff once and does not loop or apply', async () => {
    const driver = attachDriver();
    const executor = {
      boot: vi.fn(async () => {}),
      rerun: vi.fn(async () => ({ status: 'red' as const, testName: 'alpha', failure: { message: 'No widget found' } })),
      dispose: vi.fn(async () => {}),
    };
    const repair: TddRepairPlannerLike = {
      propose: vi.fn(async () => ({ mode: 'suggest', diff: '# proposed patch\n- dismiss modal', proposals: [{ proposal: { kind: 'dismissModal' }, safe: true }] })),
    };
    const runtime = new TddRuntime({ driverFactory: () => driver, executor, repair });

    await runtime.start({ configRoot: '/tmp/vitest.config.ts', vmServiceUrl: 'ws://vm/ws' });
    await runtime.focus('/tmp/sample.test.ts', 'alpha');

    const result = await runtime.cycle(undefined, { sync: 'none', repair: { mode: 'suggest' } });

    // suggest returns the original red result with the diff in the trace; nothing applied, no loop.
    expect(result.status).toBe('red');
    expect((result as any).repair.steps[0].plan.diff).toContain('proposed patch');
    expect((result as any).repair.steps[0].applied).toBeUndefined();
    expect((result as any).repair.capped).toBe(false);
    expect(executor.rerun).toHaveBeenCalledTimes(1);
    expect(repair.propose).toHaveBeenCalledTimes(1);
  });

  it('is byte-for-byte identical to today when no repair planner is wired (result has no repair field)', async () => {
    const driver = attachDriver();
    const executor = {
      boot: vi.fn(async () => {}),
      rerun: vi.fn(async () => ({ status: 'red' as const, testName: 'alpha', failure: { message: 'No widget found' } })),
      dispose: vi.fn(async () => {}),
    };
    // No repair in deps.
    const runtime = new TddRuntime({ driverFactory: () => driver, executor });

    await runtime.start({ configRoot: '/tmp/vitest.config.ts', vmServiceUrl: 'ws://vm/ws' });
    await runtime.focus('/tmp/sample.test.ts', 'alpha');

    const result = await runtime.cycle(undefined, { sync: 'none', repair: { mode: 'safe-apply' } });

    // Even though repair was requested, no planner is wired → plain TddCycleResult, no loop.
    expect(result.status).toBe('red');
    expect(result).not.toHaveProperty('repair');
    expect(executor.rerun).toHaveBeenCalledTimes(1);
  });

  it('does not run the repair loop when the initial cycle is already green', async () => {
    const driver = attachDriver();
    const executor = {
      boot: vi.fn(async () => {}),
      rerun: vi.fn(async () => ({ status: 'green' as const, testName: 'alpha' })),
      dispose: vi.fn(async () => {}),
    };
    const repair: TddRepairPlannerLike = { propose: vi.fn(async () => ({ mode: 'safe-apply', diff: 'd', proposals: [] })) };
    const runtime = new TddRuntime({ driverFactory: () => driver, executor, repair });

    await runtime.start({ configRoot: '/tmp/vitest.config.ts', vmServiceUrl: 'ws://vm/ws' });
    await runtime.focus('/tmp/sample.test.ts', 'alpha');

    const result = await runtime.cycle(undefined, { sync: 'none', repair: { mode: 'safe-apply' } });

    expect(result.status).toBe('green');
    expect(result).not.toHaveProperty('repair');
    expect(repair.propose).not.toHaveBeenCalled();
  });

  it('serializes the repair loop (no reentrancy / no overlapping reruns)', async () => {
    const driver = attachDriver();
    let active = 0;
    let peak = 0;
    let rerunCalls = 0;
    const executor = {
      boot: vi.fn(async () => {}),
      rerun: vi.fn(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await Promise.resolve();
        await Promise.resolve();
        rerunCalls += 1;
        active -= 1;
        // Red for the first two reruns, green after — drives a 2-iteration repair loop.
        return rerunCalls <= 2
          ? { status: 'red' as const, testName: 'alpha', failure: { message: 'No widget found' } }
          : { status: 'green' as const, testName: 'alpha' };
      }),
      dispose: vi.fn(async () => {}),
    };
    const repair: TddRepairPlannerLike = {
      propose: vi.fn(async () => ({ mode: 'safe-apply', diff: 'd', proposals: [], applied: [{ accepted: true, action: { kind: 'dismissModal' } }] })),
    };
    const runtime = new TddRuntime({ driverFactory: () => driver, executor, repair });

    await runtime.start({ configRoot: '/tmp/vitest.config.ts', vmServiceUrl: 'ws://vm/ws' });
    await runtime.focus('/tmp/sample.test.ts', 'alpha');

    // Two repair cycles in flight concurrently — must serialize, never overlap reruns.
    const [a, b] = await Promise.all([
      runtime.cycle(undefined, { sync: 'none', repair: { mode: 'safe-apply', iterations: 3 } }),
      runtime.cycle(undefined, { sync: 'none', repair: { mode: 'safe-apply', iterations: 3 } }),
    ]);

    expect(peak).toBe(1);
    expect(a.status).toBe('green');
    expect(b.status).toBe('green');
  });
});
