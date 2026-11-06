import { afterEach, expect, it } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  existsSync,
  readFileSync,
  mkdirSync,
  readdirSync,
  chmodSync,
  symlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WorkerAgent, type WorkerDependencies } from '../src/WorkerAgent.js';
import type { ExecutionLease, Outcome } from '@fliwright/cloud-protocol';
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

it('reclaims checkout, dependencies, raw runs and uploaded bundles only after finish is acknowledged', async () => {
  const { worker, root, deps } = setup();
  const attempt = join(root, 'spool', 'attempt');
  deps.execute = async () => {
    for (const path of ['checkout/node_modules/pkg', 'checkout/build', 'runs', 'bundle']) {
      mkdirSync(join(attempt, path), { recursive: true });
      writeFileSync(join(attempt, path, 'data'), 'large generated content');
    }
    writeFileSync(join(attempt, 'executor.log'), 'diagnostics');
    return { verdict: 'failed', bundleDir: join(attempt, 'bundle') };
  };
  deps.finish = async () => {
    expect(existsSync(join(attempt, 'checkout'))).toBe(true);
    expect(existsSync(join(attempt, 'bundle'))).toBe(true);
  };
  await worker.runOnce();
  expect(existsSync(join(attempt, 'checkout'))).toBe(false);
  expect(existsSync(join(attempt, 'runs'))).toBe(false);
  expect(existsSync(join(attempt, 'bundle'))).toBe(false);
  expect(readFileSync(join(attempt, 'executor.log'), 'utf8')).toBe('diagnostics');
  expect(existsSync(join(attempt, 'worker-timeline.jsonl'))).toBe(true);
});

it('keeps the retry bundle but drops frozen checkouts without traversing external symlinks', async () => {
  const { worker, root, deps } = setup({ publish: async () => { throw new Error('offline'); } });
  const attempt = join(root, 'spool', 'attempt');
  const outside = join(root, 'shared-cache');
  mkdirSync(outside);
  writeFileSync(join(outside, 'keep'), 'shared');
  deps.execute = async () => {
    mkdirSync(join(attempt, 'checkout', 'nested'), { recursive: true });
    symlinkSync(outside, join(attempt, 'checkout', 'nested', 'external'));
    chmodSync(join(attempt, 'checkout', 'nested'), 0o555);
    chmodSync(join(attempt, 'checkout'), 0o555);
    mkdirSync(join(attempt, 'bundle'));
    writeFileSync(join(attempt, 'bundle', 'run.json'), '{}');
    mkdirSync(join(attempt, 'runs'));
    return { verdict: 'failed', bundleDir: join(attempt, 'bundle') };
  };
  await worker.runOnce();
  expect(existsSync(join(attempt, 'checkout'))).toBe(false);
  expect(existsSync(join(attempt, 'runs'))).toBe(false);
  expect(existsSync(join(attempt, 'bundle', 'run.json'))).toBe(true);
  expect(readFileSync(join(outside, 'keep'), 'utf8')).toBe('shared');
});

it.each(['finish', 'reset', 'stopOwned'] as const)('preserves the working directory when %s fails and the slot needs recovery', async failure => {
  const { worker, root, deps } = setup();
  const checkout = join(root, 'spool', 'attempt', 'checkout');
  deps.execute = async () => {
    mkdirSync(checkout);
    writeFileSync(join(checkout, 'evidence'), 'keep');
    return { verdict: 'unknown' };
  };
  deps[failure] = async () => { throw new Error('unconfirmed cleanup'); };
  await expect(worker.runOnce()).rejects.toThrow();
  expect(existsSync(join(root, 'slot.lock'))).toBe(true);
  expect(readFileSync(join(checkout, 'evidence'), 'utf8')).toBe('keep');
});

it('bounds retained attempts during idle startup and after each completion', async () => {
  const { worker, root, deps, lease } = setup();
  worker.options.spoolRetention = { maxAttempts: 2 };
  const spool = join(root, 'spool');
  for (let i = 0; i < 5; i++) {
    const directory = join(spool, `legacy-${i}`);
    mkdirSync(join(directory, 'checkout'), { recursive: true });
    writeFileSync(join(directory, 'job.json'), '{}');
    writeFileSync(join(directory, 'retention.json'), JSON.stringify({ completedAt: Date.now() - (5 - i) * 1000, published: false }));
  }
  deps.claim = async () => null;
  expect(await worker.runOnce()).toBe(false);
  expect(readdirSync(spool).sort()).toEqual(['legacy-3', 'legacy-4']);
  expect(existsSync(join(spool, 'legacy-4', 'checkout'))).toBe(false);
  deps.claim = async () => lease;
  await worker.runOnce();
  expect(readdirSync(spool).sort()).toEqual(['attempt', 'legacy-4']);
});

it.each([
  { maxAgeHours: 1 },
  { maxBytes: 100 },
  { maxFiles: 2 },
])('evicts expired or oversized retained evidence with %j', async limits => {
  const { worker, root, deps } = setup();
  worker.options.spoolRetention = limits;
  const directory = join(root, 'spool', 'old');
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'retention.json'), JSON.stringify({ completedAt: Date.now() - 7200000, published: false }));
  writeFileSync(join(directory, 'executor.log'), 'x'.repeat(101));
  writeFileSync(join(directory, 'result.json'), '{}');
  deps.claim = async () => null;
  await worker.runOnce();
  expect(existsSync(directory)).toBe(false);
});

it('keeps raw evidence when artifact export left an incomplete bundle', async () => {
  const { worker, root, deps } = setup();
  const attempt = join(root, 'spool', 'attempt');
  deps.execute = async () => {
    mkdirSync(join(attempt, 'runs'), { recursive: true });
    mkdirSync(join(attempt, 'bundle'));
    writeFileSync(join(attempt, 'runs', 'evidence'), 'not exported');
    return { verdict: 'unknown' };
  };
  await worker.runOnce();
  expect(readFileSync(join(attempt, 'runs', 'evidence'), 'utf8')).toBe('not exported');
});

it('leaves active or unrecovered attempts untouched even when they exceed retention limits', async () => {
  const { worker, root } = setup();
  worker.options.spoolRetention = { maxFiles: 1 };
  const attempt = join(root, 'spool', 'active');
  mkdirSync(attempt, { recursive: true });
  writeFileSync(join(attempt, 'evidence'), 'keep');
  writeFileSync(join(root, 'slot.lock'), JSON.stringify({ pid: 0, directory: attempt, stage: 'running' }));
  await expect(worker.runOnce()).rejects.toThrow(/lock|recover/i);
  expect(readFileSync(join(attempt, 'evidence'), 'utf8')).toBe('keep');
});

it('compacts legacy attempts only after confirming their owned processes stopped', async () => {
  const { worker, root, deps } = setup();
  const attempt = join(root, 'spool', 'legacy');
  mkdirSync(join(attempt, 'checkout'), { recursive: true });
  writeFileSync(join(attempt, 'job.json'), '{}');
  deps.claim = async () => null;
  deps.stopOwned = async directory => {
    expect(directory).toBe(attempt);
    throw new Error('ambiguous process');
  };
  await expect(worker.runOnce()).rejects.toThrow('ambiguous process');
  expect(existsSync(join(attempt, 'checkout'))).toBe(true);
  deps.stopOwned = async () => {};
  await worker.recover();
  expect(existsSync(join(attempt, 'checkout'))).toBe(false);
  expect(existsSync(join(root, 'slot.lock'))).toBe(false);
});

it('holds the slot lock during recovery before any historical pruning', async () => {
  const { worker, root, deps } = setup();
  deps.reset = async () => {
    expect(existsSync(join(root, 'slot.lock'))).toBe(true);
    await expect(worker.runOnce()).rejects.toThrow(/lock|recover/i);
  };
  await worker.recover();
  expect(existsSync(join(root, 'slot.lock'))).toBe(false);
});

it('enforces the combined file budget across retained attempts', async () => {
  const { worker, root, deps } = setup();
  worker.options.spoolRetention = { maxFiles: 6 };
  for (let i = 0; i < 3; i++) {
    const attempt = join(root, 'spool', `attempt-${i}`);
    mkdirSync(attempt, { recursive: true });
    writeFileSync(join(attempt, 'retention.json'), JSON.stringify({ completedAt: Date.now() - (3 - i) * 1000, published: false }));
    writeFileSync(join(attempt, 'evidence'), 'keep within budget');
  }
  deps.claim = async () => null;
  await worker.runOnce();
  expect(readdirSync(join(root, 'spool')).sort()).toEqual(['attempt-1', 'attempt-2']);
});

it('records publication and device cleanup independently after a failed test run', async () => {
  const { worker, root } = setup();
  await worker.runOnce();
  const events = readFileSync(join(root, 'spool', 'attempt', 'worker-timeline.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  expect(events.filter(event => event.payload.type === 'span.started').map(event => event.payload.phase)).toEqual([
    'processes.stop', 'report.publish', 'device.reset.after',
  ]);
  expect(events.filter(event => event.payload.type === 'span.finished').map(event => event.payload.status)).toEqual(['succeeded', 'succeeded', 'succeeded']);
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

it.each(['cancelled', 'lost'] as const)('reacts to a pushed %s notification without waiting for a heartbeat', async (reason) => {
  let notify: (reason: 'lost' | 'cancelled') => void = () => {};
  let detached = false;
  let outcome: Outcome | undefined;
  const { worker, root, calls, deps } = setup({
    watchLease: (_lease, listener) => { notify = listener; return () => { detached = true; }; },
    execute: async (_lease, _directory, signal) => {
      const stopped = new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
      notify(reason);
      await stopped;
      return { verdict: 'interrupted' };
    },
    heartbeat: async () => { throw new Error('must react before scheduled heartbeat'); },
    finish: async (_lease, result) => { outcome = result; },
  });
  worker.options.heartbeatMs = 60000;
  if (reason === 'lost') {
    await expect(worker.runOnce()).rejects.toThrow(/ownership lost/i);
    expect(existsSync(join(root, 'slot.lock'))).toBe(true);
    expect(outcome).toBeUndefined();
  } else {
    // Finalization still confirms the cancellation with a heartbeat.
    deps.heartbeat = async () => ({ cancelRequested: true });
    await worker.runOnce();
    expect(outcome).toMatchObject({ verdict: 'interrupted', cleanup: 'clean' });
    expect(existsSync(join(root, 'slot.lock'))).toBe(false);
  }
  expect(calls).toContain('reset');
  expect(detached).toBe(true);
});
