import { afterEach, expect, it, vi } from 'vitest';
import { requestNativeOwnership, requestNativePreparation } from '../src/native-ownership-ipc.js';

const connected = Object.getOwnPropertyDescriptor(process, 'connected');
const send = Object.getOwnPropertyDescriptor(process, 'send');
afterEach(() => {
  if (connected) Object.defineProperty(process, 'connected', connected); else Reflect.deleteProperty(process, 'connected');
  if (send) Object.defineProperty(process, 'send', send); else Reflect.deleteProperty(process, 'send');
  vi.useRealTimers();
});
function setup() {
  const send = vi.fn();
  Object.defineProperty(process, 'connected', { configurable: true, value: true });
  Object.defineProperty(process, 'send', { configurable: true, value: send });
  return send;
}
it('requires the matching supervisor response and removes request listeners', async () => {
  const send = setup(), listeners = process.listenerCount('message');
  const work = requestNativeOwnership('/project', new AbortController().signal);
  const { id } = send.mock.calls[0][0].nativeOwnership;
  const delegation = { rootDir: '/lease', key: 'a'.repeat(64), token: 'b'.repeat(64) };
  process.emit('message', { nativeOwnershipReply: { id: 'other', ok: false } });
  process.emit('message', { nativeOwnershipReply: { id, ok: true, grant: { delegation } } });
  expect(await work).toEqual({ delegation });
  expect(process.listenerCount('message')).toBe(listeners);
  expect(JSON.stringify(send.mock.calls)).not.toContain(delegation.token);
});
it('fails on cancellation and supervisor disconnect instead of launching without ownership', async () => {
  setup();
  const abort = new AbortController();
  const work = requestNativeOwnership('/project', abort.signal);
  const failure = expect(work).rejects.toThrow('cancelled'); abort.abort(); await failure;
  const disconnected = requestNativeOwnership('/project', new AbortController().signal);
  const lost = expect(disconnected).rejects.toThrow('disconnected'); process.emit('disconnect'); await lost;
});
it('transports only a validated private grant and refuses malformed installed controls without falling back', async () => {
  const send = setup();
  const delegation = { rootDir: '/lease', key: 'a'.repeat(64), token: 'b'.repeat(64) };
  const managedAppControl = { url: 'http://127.0.0.1:1234', token: 'c'.repeat(64), sessionId: 'owner', timeoutMs: 600000 };
  const work = requestNativeOwnership('/project', new AbortController().signal);
  process.emit('message', { nativeOwnershipReply: { id: send.mock.calls.at(-1)![0].nativeOwnership.id, ok: true, grant: { delegation, managedAppControl } } });
  expect(await work).toEqual({ delegation, managedAppControl });
  for (const grant of [{ managedAppControl }, { delegation, managedAppControl: { ...managedAppControl, url: 'https://external.example' } }, { delegation: { ...delegation, token: 'bad' } }, { delegation, command: 'flutter run' }]) {
    const invalid = requestNativeOwnership('/project', new AbortController().signal);
    const failed = expect(invalid).rejects.toThrow(/grant/i);
    process.emit('message', { nativeOwnershipReply: { id: send.mock.calls.at(-1)![0].nativeOwnership.id, ok: true, grant } });
    await failed;
  }
});
it('bounds a missing supervisor response', async () => {
  setup(); vi.useFakeTimers();
  const work = requestNativeOwnership('/project', new AbortController().signal);
  const failure = expect(work).rejects.toThrow('120 second');
  await vi.advanceTimersByTimeAsync(120_001); await failure;
});

it('sends only attempt identity for preparation and notifies supervisor when cancelled without replay', async () => {
  const send = setup(), listeners = process.listenerCount('message');
  const abort = new AbortController();
  const work = requestNativePreparation('/project', { attemptKey: 'first' }, abort.signal);
  const { id } = send.mock.calls[0][0].nativePreparation;
  expect(send.mock.calls[0][0]).toEqual({ nativePreparation: { id, project: '/project', request: { attemptKey: 'first' } } });
  const failed = expect(work).rejects.toThrow(/cancelled/);
  abort.abort(); await failed;
  expect(send.mock.calls[1][0]).toEqual({ nativePreparationCancel: { id } });
  expect(send).toHaveBeenCalledTimes(2);
  process.emit('message', { nativePreparationReply: { id, ok: true } });
  expect(process.listenerCount('message')).toBe(listeners);
});

it('accepts only the matching successful preparation reply and bounds missing replies', async () => {
  const send = setup();
  const work = requestNativePreparation('/project', { attemptKey: 'first' }, new AbortController().signal);
  const { id } = send.mock.calls[0][0].nativePreparation;
  process.emit('message', { nativePreparationReply: { id: 'other', ok: true } });
  process.emit('message', { nativePreparationReply: { id, ok: true } });
  await work;
  vi.useFakeTimers();
  const missing = requestNativePreparation('/project', { attemptKey: 'retry' }, new AbortController().signal);
  const failed = expect(missing).rejects.toThrow(/120 second/);
  await vi.advanceTimersByTimeAsync(121001); await failed;
  expect(send.mock.calls.at(-1)?.[0]).toHaveProperty('nativePreparationCancel');
});
