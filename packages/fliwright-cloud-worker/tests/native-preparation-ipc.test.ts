import { afterEach, expect, it, vi } from 'vitest';
import { NativePreparationIpc } from '../src/NativePreparationIpc.js';

afterEach(() => vi.useRealTimers());
const request = (id = 'first', project = '/project') => ({ nativePreparation: { id, project, request: { attemptKey: id } } });

it('only dispatches the current project and refuses concurrent, replayed and extra-field requests', async () => {
  let finish!: () => void;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const prepare = vi.fn(async () => gate), send = vi.fn();
  const relay = new NativePreparationIpc({ project: '/project', prepare, send });
  relay.handle(request('wrong', '/other'));
  relay.handle({ nativePreparation: { ...request().nativePreparation, command: 'arbitrary' } });
  expect(prepare).not.toHaveBeenCalled();
  relay.handle(request());
  await vi.waitFor(() => expect(prepare).toHaveBeenCalledOnce());
  relay.handle(request('concurrent'));
  expect(send).toHaveBeenCalledWith({ nativePreparationReply: { id: 'concurrent', ok: false } });
  finish();
  await vi.waitFor(() => expect(send).toHaveBeenCalledWith({ nativePreparationReply: { id: 'first', ok: true } }));
  relay.handle(request());
  expect(send.mock.calls.at(-1)?.[0]).toEqual({ nativePreparationReply: { id: 'first', ok: false } });
  expect(prepare).toHaveBeenCalledOnce();
  relay.dispose();
});

it('cancels the matching preparation, keeps underlying work fenced and never acknowledges a late success', async () => {
  let finish!: () => void, preparationSignal!: AbortSignal;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const prepare = vi.fn(async (_project, _request, signal: AbortSignal) => { preparationSignal = signal; await gate; });
  const send = vi.fn(), relay = new NativePreparationIpc({ project: '/project', prepare, send });
  relay.handle(request());
  await vi.waitFor(() => expect(prepare).toHaveBeenCalledOnce());
  relay.handle({ nativePreparationCancel: { id: 'other' } });
  expect(preparationSignal.aborted).toBe(false);
  relay.handle({ nativePreparationCancel: { id: 'first' } });
  expect(preparationSignal.aborted).toBe(true);
  await vi.waitFor(() => expect(send).toHaveBeenCalledWith({ nativePreparationReply: { id: 'first', ok: false } }));
  relay.handle(request('after-cancel'));
  expect(prepare).toHaveBeenCalledOnce();
  finish();
  await Promise.resolve(); await Promise.resolve();
  expect(send.mock.calls.some(([value]) => value.nativePreparationReply.ok)).toBe(false);
  relay.dispose();
});

it('bounds preparation and cancels it when the executor channel closes', async () => {
  vi.useFakeTimers();
  const signals: AbortSignal[] = [], send = vi.fn();
  const prepare = vi.fn(async (_project, _request, signal: AbortSignal) => {
    signals.push(signal);
    await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
  });
  const relay = new NativePreparationIpc({ project: '/project', prepare, send });
  relay.handle(request());
  await vi.advanceTimersByTimeAsync(120001);
  expect(signals[0].aborted).toBe(true);
  expect(send).toHaveBeenCalledWith({ nativePreparationReply: { id: 'first', ok: false } });
  relay.dispose();
  const next = new NativePreparationIpc({ project: '/project', prepare, send });
  next.handle(request('next'));
  await vi.advanceTimersByTimeAsync(0);
  next.dispose();
  expect(signals[1].aborted).toBe(true);
});
