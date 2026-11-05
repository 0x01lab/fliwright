import { afterEach, describe, expect, it, vi } from 'vitest';
import { BiometricTestController } from '../src/BiometricTestController.js';
import { RunSession } from '../src/RunSession.js';
import { NativeRuntime } from '../src/native/NativeRuntime.js';
import type { NativeSessionAdapter } from '../src/native/types.js';
import { EndpointLeaseManager } from '../src/EndpointLease.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function app() {
  let generation = '';
  let attempt = 0;
  const pending = new Set<string>();
  const results = new Map<string, string>();
  const rejections = new Map<string, number>();
  const status = () => ({ schemaVersion: 1, surface: 'app-test-seam', generation,
    pendingChallenges: [...pending], results: Object.fromEntries(results), rejections: Object.fromEntries(rejections) });
  const invoke = vi.fn(async (_capability: string, method: string, input?: unknown) => {
    const value = (input ?? {}) as Record<string, unknown>;
    if (value.generation !== undefined && value.generation !== generation) throw new Error('stale generation');
    if (method === 'reset') {
      generation = `attempt-${++attempt}`;
      pending.clear(); results.clear(); rejections.clear();
    } else if (method !== 'getStatus') throw new Error('Unknown remote method');
    return status();
  });
  return { invoke, status, reject(id: string) {
    if (!pending.has(id)) throw new Error('challenge is not pending');
    rejections.set(id, (rejections.get(id) ?? 0) + 1);
  }, begin(id: string) { pending.add(id); }, complete(id: string, result: string) {
    if (!pending.delete(id)) throw new Error('challenge is not pending');
    results.set(id, result);
  }, app: { listCapabilities: async () => [{ name: 'biometricTest', methods: ['reset', 'getStatus'] }], invoke } };
}

describe('BiometricTestController', () => {
  const controllers: BiometricTestController[] = [];
  afterEach(async () => {
    await Promise.allSettled(controllers.splice(0).map(controller => controller.dispose()));
    vi.useRealTimers();
  });
  async function create(options: Parameters<typeof BiometricTestController.create>[1] = {}) {
    const seam = app();
    const controller = await BiometricTestController.create(seam.app, { pollIntervalMs: 1, ...options });
    controllers.push(controller);
    return { ...seam, controller };
  }

  it('observes app-local challenge callbacks through a read-only status capability', async () => {
    const { controller, begin, complete, invoke } = await create();
    begin('sign-in');
    expect(await controller.waitForChallenge('sign-in')).toEqual({ challengeId: 'sign-in' });
    complete('sign-in', 'match');
    expect(await controller.waitForResult('sign-in')).toBe('match');
    expect(invoke.mock.calls.every(call => ['reset', 'getStatus'].includes(call[1]))).toBe(true);
  });

  it('sends one event only after a pending challenge and asserts the actual callback', async () => {
    const { controller, begin, complete } = await create();
    const event = vi.fn(async () => { complete('unlock', 'match'); return { acknowledged: true }; });
    const exercise = controller.exerciseChallenge('unlock', event, 'match');
    expect(event).not.toHaveBeenCalled();
    begin('unlock');
    await expect(exercise).resolves.toEqual({ event: { acknowledged: true }, result: 'match' });
    expect(event).toHaveBeenCalledOnce();
    await expect(controller.exerciseChallenge('unlock', event, 'match')).rejects.toThrow(/already/i);
    expect(event).toHaveBeenCalledOnce();
  });

  it('observes repeated rejection callbacks while pending, then allows a match on the same challenge', async () => {
    const { controller, begin, complete, reject } = await create();
    begin('unlock');
    for (let sequence = 1; sequence <= 2; sequence++) {
      await expect(controller.exerciseRejection('unlock', async () => { reject('unlock'); return { acknowledged: true }; }))
        .resolves.toMatchObject({ rejectionSequence: sequence });
      expect(await controller.getStatus()).toMatchObject({ pendingChallenges: ['unlock'], results: {} });
    }
    await expect(controller.exerciseChallenge('unlock', async () => { complete('unlock', 'match'); }, 'match'))
      .resolves.toMatchObject({ result: 'match' });
  });

  it('does not pass a rejection observation when the app instead reaches lockout', async () => {
    const { controller, begin, complete } = await create();
    begin('unlock');
    await expect(controller.exerciseRejection('unlock', async () => { complete('unlock', 'lockout'); }))
      .rejects.toThrow(/lockout/i);
    await expect(controller.waitForResult('unlock')).resolves.toBe('lockout');
  });

  it('rejects a result mismatch even after an acknowledged event', async () => {
    const { controller, begin, complete } = await create();
    begin('unlock');
    await expect(controller.exerciseChallenge('unlock', async () => { complete('unlock', 'reject'); return { acknowledged: true }; }, 'match'))
      .rejects.toThrow(/reported 'reject'.*expected 'match'/i);
  });

  it('does not dispatch for an already completed or missing challenge', async () => {
    vi.useFakeTimers();
    const { controller, begin, complete } = await create();
    begin('unlock'); complete('unlock', 'cancel');
    const event = vi.fn();
    await expect(controller.exerciseChallenge('unlock', event, 'match')).rejects.toThrow(/completed/i);
    const missing = expect(controller.exerciseChallenge('missing', event, 'match', { timeoutMs: 20 })).rejects.toThrow(/timeout/i);
    await vi.advanceTimersByTimeAsync(21);
    await missing;
    expect(event).not.toHaveBeenCalled();
  });

  it('never replays an event whose response was lost', async () => {
    const { controller, begin, complete } = await create();
    begin('unlock');
    const event = vi.fn(async () => { throw new Error('event response lost'); });
    await expect(controller.exerciseChallenge('unlock', event, 'match')).rejects.toThrow(/response lost/);
    await expect(controller.exerciseChallenge('unlock', event, 'match')).rejects.toThrow(/already/i);
    expect(event).toHaveBeenCalledOnce();
    complete('unlock', 'cancel');
  });

  it('blocks further events when acknowledgement is followed by no app callback', async () => {
    vi.useFakeTimers();
    const { controller, begin, complete } = await create();
    begin('unlock');
    const first = expect(controller.exerciseChallenge('unlock', async () => ({ acknowledged: true }), 'match', { timeoutMs: 20 }))
      .rejects.toThrow(/timeout/i);
    await vi.advanceTimersByTimeAsync(21);
    await first;
    begin('second');
    const event = vi.fn();
    await expect(controller.exerciseChallenge('second', event, 'match')).rejects.toThrow(/unknown/i);
    expect(event).not.toHaveBeenCalled();
    complete('unlock', 'cancel'); complete('second', 'cancel');
    await expect(controller.dispose()).rejects.toThrow(/not confirmed/i);
  });

  it('distinguishes an app-reported lockout from rejection or cancellation', async () => {
    const { controller, begin, complete } = await create();
    begin('lockout');
    complete('lockout', 'lockout');
    await expect(controller.waitForResult('lockout')).resolves.toBe('lockout');
  });

  it('uses one deadline for a slow status request, the event and result observation', async () => {
    vi.useFakeTimers();
    const { controller, begin, complete } = await create({ timeoutMs: 200 });
    begin('unlock');
    const event = vi.fn(async (_options: { signal: AbortSignal; timeout: number }) => new Promise<void>(() => {}));
    const exercise = expect(controller.exerciseChallenge('unlock', event, 'match', { timeoutMs: 20 })).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(21);
    await exercise;
    expect(event.mock.calls[0][0].signal.aborted).toBe(true);
    complete('unlock', 'error');
  });

  it('counts queue waiting against the deadline and cancels queued work before it can dispatch', async () => {
    vi.useFakeTimers();
    const { controller } = await create();
    const first = expect(controller.waitForChallenge('first', { timeoutMs: 50 })).rejects.toThrow(/timeout/i);
    const event = vi.fn();
    const queued = expect(controller.exerciseChallenge('second', event, 'match', { timeoutMs: 10 })).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(51);
    await Promise.all([first, queued]);
    expect(event).not.toHaveBeenCalled();
  });

  it('cancels polling on either the fixture signal or per-call signal without dispatching', async () => {
    for (const viaFixture of [false, true]) {
      const cancellation = new AbortController();
      const { controller } = await create(viaFixture ? { signal: cancellation.signal } : {});
      const event = vi.fn();
      const pending = expect(controller.exerciseChallenge('missing', event, 'match', viaFixture ? {} : { signal: cancellation.signal }))
        .rejects.toThrow('test cancelled');
      cancellation.abort(new Error('test cancelled'));
      await pending;
      expect(event).not.toHaveBeenCalled();
      await expect(controller.dispose()).resolves.toBeUndefined();
    }
  });

  it('applies the caller deadline to an unresponsive status read', async () => {
    vi.useFakeTimers();
    const { controller, invoke } = await create();
    invoke.mockImplementationOnce(async () => new Promise(() => {}));
    const pending = expect(controller.waitForChallenge('missing', { timeoutMs: 10 })).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(11);
    await pending;
  });

  it('resets unresolved challenges on disposal, reports failure and invalidates old controllers', async () => {
    const { controller, begin, status } = await create();
    const generation = status().generation;
    begin('unlock');
    await expect(controller.dispose()).rejects.toThrow(/unresolved/);
    expect(status().generation).not.toBe(generation);
    expect(status().pendingChallenges).toEqual([]);
    await expect(controller.getStatus()).rejects.toThrow(/closed/i);
  });

  it('rejects stale generations and malformed contradictory status before sending events', async () => {
    const { controller, invoke, status } = await create();
    for (const malformed of [
      { ...status(), generation: 'other' },
      { ...status(), pendingChallenges: ['a', 'a'] },
      { ...status(), pendingChallenges: ['a'], results: { a: 'match' } },
      { ...status(), results: { a: { toString: () => 'match' } } },
      { ...status(), pendingChallenges: ['/host/path'] },
      { ...status(), ready: true },
      { ...status(), rejections: { missing: 1 } },
      { ...status(), pendingChallenges: ['unlock'], rejections: { unlock: -1 } },
      { ...status(), pendingChallenges: ['unlock'], rejections: { unlock: 33 } },
    ]) {
      invoke.mockResolvedValueOnce(malformed as ReturnType<typeof status>);
      await expect(controller.getStatus()).rejects.toThrow(/protocol|generation/i);
    }
  });

  it('runs a device event on the same session and records a distinct assertion of the app callback', async () => {
    const root = await mkdtemp(join(tmpdir(), 'biometric-endpoint-'));
    const seam = app();
    const session = new RunSession({ runId: 'r', testId: 't', testName: 'biometric callback', recordingMode: 'standard' });
    session.configureEndpointLease(new EndpointLeaseManager({ rootDir: root }), 'ws://127.0.0.1:9123/ws');
    const adapter: NativeSessionAdapter = {
      identity: { platform: 'android', deviceId: 'test-device', appId: 'test.app', backend: 'test', generation: 'g1' },
      capabilities: async () => ({ 'biometrics.match': { support: 'supported', ready: true, backend: 'test' } }),
      execute: vi.fn(async () => { seam.complete('unlock', 'match'); return { acknowledged: true }; }),
      snapshot: async () => { throw new Error('Unexpected snapshot'); },
      screenshot: async () => { throw new Error('Unexpected screenshot'); },
      dispose: async () => {},
    };
    const runtime = new NativeRuntime(adapter, { runSession: session });
    const controller = await BiometricTestController.create(seam.app, { runSession: session, timeoutMs: 1000 });
    try {
      seam.begin('unlock');
      await expect(controller.exerciseChallenge('unlock', options => runtime.device.biometrics.match(options), 'match'))
        .resolves.toMatchObject({ result: 'match', event: { acknowledged: true } });
      expect(adapter.execute).toHaveBeenCalledOnce();
      expect(session.snapshot().operations).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'action', metadata: expect.objectContaining({ surface: 'native', action: 'biometrics.match' }) }),
        expect.objectContaining({ kind: 'assertion', outcome: 'passed', metadata: expect.objectContaining({
          surface: 'flutter', coverage: 'app-test-seam', challengeId: 'unlock', expected: 'match', result: 'match',
        }) }),
      ]));
    } finally {
      await controller.dispose();
      await runtime.dispose();
      await rm(root, { recursive: true, force: true });
    }
  });
});
