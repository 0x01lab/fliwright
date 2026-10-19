import { afterEach, expect, it } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  existsSync,
  readFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WorkerAgent, type WorkerDependencies } from '../src/WorkerAgent.js';
import type { ExecutionLease, Outcome } from '../src/contracts.js';
const dirs: string[] = [];
afterEach(() =>
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })),
);
function setup(overrides: Partial<WorkerDependencies> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'worker-'));
  dirs.push(root);
  const calls: string[] = [];
  const lease = {
    workerId: 'mac',
    slotId: 'ios',
    attemptId: 'attempt',
    generation: 1,
    expiresAt: Date.now() + 30000,
    deviceId: 'device',
    request: { id: 'request', target: { timeoutMs: 1000 } },
  } as ExecutionLease;
  const deps: WorkerDependencies = {
    claim: async () => lease,
    heartbeat: async () => ({ cancelRequested: false }),
    execute: async (_lease, _dir, _signal, onStage) => {
      calls.push('execute');
      onStage('running');
      return { verdict: 'failed', bundleDir: join(root, 'bundle') };
    },
    stopOwned: async () => {
      calls.push('stop');
    },
    reset: async () => {
      calls.push('reset');
    },
    publish: async () => {
      calls.push('publish');
      return 'bundle';
    },
    finish: async (_lease, outcome) => {
      calls.push('finish');
      return outcome;
    },
    recover: async () => {},
    ...overrides,
  };
  const worker = new WorkerAgent(
    {
      workerId: 'mac',
      slotId: 'ios',
      deviceId: 'device',
      root,
      heartbeatMs: 5,
    },
    deps,
  );
  return { root, calls, lease, deps, worker };
}
it('preserves business failure when upload fails and resets before releasing', async () => {
  let outcome: Outcome | undefined;
  const { worker, calls } = setup({
    publish: async () => {
      throw new Error('disk full');
    },
    finish: async (_l, o) => {
      outcome = o;
      calls.push('finish');
    },
  });
  await worker.runOnce();
  expect(outcome).toMatchObject({
    verdict: 'failed',
    publication: 'publish_failed',
    cleanup: 'clean',
  });
  expect(calls.indexOf('reset')).toBeLessThan(calls.indexOf('finish'));
});
it('aborts on cancellation, waits for owned termination and quarantines on reset failure', async () => {
  let outcome: Outcome | undefined;
  const { worker, calls } = setup({
    heartbeat: async () => ({ cancelRequested: true }),
    execute: async (_l, _d, signal) => {
      await new Promise<void>((resolve) =>
        signal.addEventListener('abort', () => resolve(), { once: true }),
      );
      return { verdict: 'interrupted' };
    },
    reset: async () => {
      throw new Error('reset failed');
    },
    finish: async (_l, o) => {
      outcome = o;
    },
  });
  await expect(worker.runOnce()).rejects.toThrow(/cleanup failed/);
  expect(calls).toContain('stop');
  expect(outcome).toMatchObject({ verdict: 'interrupted', cleanup: 'failed' });
});
it('never finishes or claims again after heartbeat ownership is lost; recovery is explicit', async () => {
  const { worker, root } = setup({
    heartbeat: async () => {
      throw new Error('lease lost');
    },
    execute: async (_l, _d, signal) => {
      await new Promise<void>((resolve) =>
        signal.addEventListener('abort', () => resolve(), { once: true }),
      );
      return { verdict: 'interrupted' };
    },
    finish: async () => {
      throw new Error('must not finish');
    },
  });
  await expect(worker.runOnce()).rejects.toThrow(/lease|ownership/i);
  expect(existsSync(join(root, 'slot.lock'))).toBe(true);
  await expect(worker.runOnce()).rejects.toThrow(/recover|lock/i);
});
it('keeps local spool and ownership journal when completion cannot be acknowledged', async () => {
  const { worker, root } = setup({
    finish: async () => {
      throw new Error('offline');
    },
  });
  await expect(worker.runOnce()).rejects.toThrow(/offline/);
  expect(existsSync(join(root, 'slot.lock'))).toBe(true);
  const state = JSON.parse(readFileSync(join(root, 'slot.lock'), 'utf8'));
  expect(state.lease.attemptId).toBe('attempt');
});
