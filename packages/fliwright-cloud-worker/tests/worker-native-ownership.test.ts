import { afterEach, expect, it, vi } from 'vitest';
import { WorkerNativeOwnership } from '../src/WorkerNativeOwnership.js';
afterEach(() => vi.useRealTimers());

it('quiesces the retained app before reset and releases ownership only after reset finishes', async () => {
  const events: string[] = [];
  const owner = new WorkerNativeOwnership(async () => ({ delegation: { rootDir: '/lease', key: 'a'.repeat(64), token: 'b'.repeat(64) },
    prepareAttempt: vi.fn(), quiesce: async () => { events.push('app-stopped-and-restored'); },
    dispose: async () => { events.push('released'); } }));
  await owner.acquire('/project', { deviceId: 'phone', signal: new AbortController().signal });
  await owner.reset(async () => { events.push('reset'); });
  expect(events).toEqual(['app-stopped-and-restored', 'reset', 'released']);
});

it('refuses reset and reuse after failed app quiescence, retaining both cleanup errors', async () => {
  const cleanup = new Error('app cleanup unconfirmed'), release = new Error('release failed');
  const action = vi.fn(async () => {}), quiesce = vi.fn(async () => { throw cleanup; });
  const dispose = vi.fn(async () => { throw release; });
  const owner = new WorkerNativeOwnership(async () => ({ delegation: { rootDir: '/lease', key: 'a'.repeat(64), token: 'b'.repeat(64) }, prepareAttempt: vi.fn(), quiesce, dispose }));
  await owner.acquire('/project', { deviceId: 'phone', signal: new AbortController().signal });
  const failure = await owner.reset(action).catch(error => error);
  expect(failure).toBeInstanceOf(AggregateError);
  expect(failure.errors).toEqual([cleanup, release]);
  expect(action).not.toHaveBeenCalled();
  expect(dispose).toHaveBeenCalledWith({ cleanupConfirmed: false });
  await expect(owner.acquire('/project', { deviceId: 'phone', signal: new AbortController().signal })).rejects.toThrow(/recovery/);
});

it('holds the device until supervisor reset completes, beyond the executor lifetime', async () => {
  const dispose = vi.fn(async () => {}), delegation = { rootDir: '/lease', key: 'a'.repeat(64), token: 'b'.repeat(64) };
  const prepare = vi.fn(async () => ({ delegation, prepareAttempt: vi.fn(), quiesce: vi.fn(async () => {}), dispose }));
  const owner = new WorkerNativeOwnership(prepare);
  expect(await owner.acquire('/project', { deviceId: 'phone', signal: new AbortController().signal })).toEqual({ delegation });
  expect(dispose).not.toHaveBeenCalled();
  await expect(owner.acquire('/project', { deviceId: 'phone', signal: new AbortController().signal })).rejects.toThrow('already requested');
  await owner.reset(async () => { expect(dispose).not.toHaveBeenCalled(); });
  expect(dispose).toHaveBeenCalledWith({ cleanupConfirmed: true });
});

it('keeps build configuration with the supervisor and returns its ephemeral control only in the grant', async () => {
  const delegation = { rootDir: '/lease', key: 'a'.repeat(64), token: 'b'.repeat(64) };
  const managedAppControl = { url: 'http://127.0.0.1:1234', token: 'c'.repeat(64), sessionId: 'owner', timeoutMs: 600000 };
  const prepare = vi.fn(async () => ({ delegation, managedAppControl, prepareAttempt: vi.fn(), quiesce: vi.fn(async () => {}), dispose: vi.fn(async () => {}) }));
  const owner = new WorkerNativeOwnership(prepare);
  const launch = { target: 'lib/native.dart', flutterBin: '/owned/flutter', flutterArgs: ['--flavor=qa'] };
  expect(await owner.acquire('/project', { deviceId: 'phone', signal: new AbortController().signal, launch })).toEqual({ delegation, managedAppControl });
  expect(prepare).toHaveBeenCalledWith('/project', expect.objectContaining({ launch }), { onPhase: undefined });
  await owner.reset(async () => {});
});

it('bounds unresponsive app quiescence without running reset or replaying cleanup', async () => {
  vi.useFakeTimers();
  let finish!: () => void;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const action = vi.fn(async () => {}), quiesce = vi.fn(async () => gate), dispose = vi.fn(async () => {});
  const owner = new WorkerNativeOwnership(async () => ({ delegation: { rootDir: '/lease', key: 'a'.repeat(64), token: 'b'.repeat(64) }, prepareAttempt: vi.fn(), quiesce, dispose }));
  await owner.acquire('/project', { deviceId: 'phone', signal: new AbortController().signal });
  const closing = owner.reset(action), failed = expect(closing).rejects.toThrow(/did not stop/);
  await vi.advanceTimersByTimeAsync(15001); await failed;
  expect(action).not.toHaveBeenCalled(); expect(quiesce).toHaveBeenCalledOnce();
  expect(dispose).toHaveBeenCalledWith({ cleanupConfirmed: false });
  finish(); await vi.advanceTimersByTimeAsync(0);
  expect(action).not.toHaveBeenCalled();
  await expect(owner.acquire('/project', { deviceId: 'phone', signal: new AbortController().signal })).rejects.toThrow(/recovery/);
});

it('quarantines owner cleanup when the supervisor reset fails', async () => {
  const dispose = vi.fn(async () => {});
  const owner = new WorkerNativeOwnership(async () => ({ delegation: { rootDir: '/lease', key: 'a'.repeat(64), token: 'b'.repeat(64) }, prepareAttempt: vi.fn(), quiesce: vi.fn(async () => {}), dispose }));
  await owner.acquire('/project', { deviceId: 'phone', signal: new AbortController().signal });
  await expect(owner.reset(async () => { throw new Error('reset failed'); })).rejects.toThrow('reset failed');
  expect(dispose).toHaveBeenCalledWith({ cleanupConfirmed: false });
});

it('waits for an in-flight acquisition before resetting and releasing', async () => {
  let resolve!: (value: undefined) => void;
  const prepare = vi.fn(() => new Promise<undefined>(done => { resolve = done; }));
  const owner = new WorkerNativeOwnership(prepare);
  const opening = owner.acquire('/project', { deviceId: 'phone', signal: new AbortController().signal });
  const cancelled = expect(opening).rejects.toThrow(/cancelled/);
  const reset = vi.fn(async () => {});
  const closing = owner.reset(reset);
  expect(reset).not.toHaveBeenCalled();
  resolve(undefined); await cancelled; await closing;
  expect(reset).toHaveBeenCalledOnce();
});

it('routes attempt preparation to its retained owner and validates project ownership', async () => {
  const prepareAttempt = vi.fn(async () => {}), dispose = vi.fn(async () => {});
  const owner = new WorkerNativeOwnership(async () => ({ delegation: { rootDir: '/lease', key: 'a'.repeat(64), token: 'b'.repeat(64) }, prepareAttempt, quiesce: vi.fn(async () => {}), dispose }));
  const signal = new AbortController().signal, request = { attemptKey: 'first' };
  await expect(owner.prepareAttempt('/project', request, signal)).rejects.toThrow(/owner|ownership/i);
  await owner.acquire('/project', { deviceId: 'phone', signal });
  await expect(owner.prepareAttempt('/other', request, signal)).rejects.toThrow(/project/i);
  expect(prepareAttempt).not.toHaveBeenCalled();
  await owner.prepareAttempt('/project', request, signal);
  expect(prepareAttempt).toHaveBeenCalledWith(request, expect.any(AbortSignal));
  await owner.reset(async () => {});
  await expect(owner.prepareAttempt('/project', { attemptKey: 'late' }, signal)).rejects.toThrow(/owner|ownership/i);
});

it('cancels and waits for in-flight preparation before final reset without dropping either cleanup failure', async () => {
  let entered!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const events: string[] = [];
  const prepareAttempt = vi.fn(async (_request, signal: AbortSignal) => {
    entered();
    await new Promise<void>(resolve => signal.addEventListener('abort', () => { events.push('preparation-stopped'); resolve(); }, { once: true }));
  });
  const release = new Error('owner release failed'), reset = new Error('reset failed');
  const owner = new WorkerNativeOwnership(async () => ({ delegation: { rootDir: '/lease', key: 'a'.repeat(64), token: 'b'.repeat(64) }, prepareAttempt,
    quiesce: vi.fn(async () => {}), dispose: async () => { events.push('owner-disposed'); throw release; } }));
  await owner.acquire('/project', { deviceId: 'phone', signal: new AbortController().signal });
  const work = owner.prepareAttempt('/project', { attemptKey: 'first' }, new AbortController().signal);
  await ready;
  const closing = owner.reset(async () => { events.push('reset'); throw reset; });
  await work;
  const failure = await closing.catch(error => error);
  expect(events).toEqual(['preparation-stopped', 'reset', 'owner-disposed']);
  expect(failure).toBeInstanceOf(AggregateError);
  expect(failure.errors).toEqual([reset, release]);
});

it('refuses reset and reuse while cancelled platform preparation remains unresolved', async () => {
  vi.useFakeTimers();
  let finish!: () => void;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const dispose = vi.fn(async () => {}), action = vi.fn(async () => {});
  const owner = new WorkerNativeOwnership(async () => ({ delegation: { rootDir: '/lease', key: 'a'.repeat(64), token: 'b'.repeat(64) },
    prepareAttempt: async () => gate, quiesce: vi.fn(async () => {}), dispose }));
  await owner.acquire('/project', { deviceId: 'phone', signal: new AbortController().signal });
  const work = owner.prepareAttempt('/project', { attemptKey: 'first' }, new AbortController().signal);
  const reset = owner.reset(action);
  const failed = expect(reset).rejects.toThrow(/did not stop/);
  await vi.advanceTimersByTimeAsync(15001); await failed;
  expect(action).not.toHaveBeenCalled();
  expect(dispose).toHaveBeenCalledWith({ cleanupConfirmed: false });
  await expect(owner.acquire('/project', { deviceId: 'phone', signal: new AbortController().signal })).rejects.toThrow(/recovery/);
  finish(); await work;
});

it('bounds reset during unresolved acquisition and disposes a late device grant without adopting it', async () => {
  vi.useFakeTimers();
  let finish!: (value: any) => void, acquisitionSignal!: AbortSignal;
  const gate = new Promise<any>(resolve => { finish = resolve; });
  const dispose = vi.fn(async () => {}), action = vi.fn(async () => {});
  const owner = new WorkerNativeOwnership(async (_project, options) => { acquisitionSignal = options.signal!; return gate; });
  const opening = owner.acquire('/project', { deviceId: 'phone', signal: new AbortController().signal });
  const rejected = expect(opening).rejects.toThrow(/cancelled|reset/i);
  const reset = owner.reset(action);
  const failed = expect(reset).rejects.toThrow(/did not stop/);
  await vi.advanceTimersByTimeAsync(15001); await failed;
  expect(acquisitionSignal.aborted).toBe(true);
  expect(action).not.toHaveBeenCalled();
  finish({ delegation: { rootDir: '/lease', key: 'a'.repeat(64), token: 'b'.repeat(64) }, prepareAttempt: vi.fn(), dispose });
  await rejected;
  expect(dispose).toHaveBeenCalledWith({ cleanupConfirmed: false });
  await expect(owner.acquire('/project', { deviceId: 'phone', signal: new AbortController().signal })).rejects.toThrow(/recovery/);
});
