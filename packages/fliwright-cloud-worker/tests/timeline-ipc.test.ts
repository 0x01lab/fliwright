import { afterEach, expect, it, vi } from 'vitest';
import { executorTimeline } from '../src/worker-timeline-ipc.js';
const originalConnected = Object.getOwnPropertyDescriptor(process, 'connected');
const originalSend = Object.getOwnPropertyDescriptor(process, 'send');
afterEach(() => {
  if (originalConnected) Object.defineProperty(process, 'connected', originalConnected); else delete process.connected;
  if (originalSend) Object.defineProperty(process, 'send', originalSend); else delete process.send;
  vi.useRealTimers();
});
it('waits for durable supervisor ACK before running an operation', async () => {
  let message: { timeline: { id: string } };
  Object.defineProperty(process, 'connected', { configurable: true, value: true });
  Object.defineProperty(process, 'send', { configurable: true, value: (value: typeof message) => { message = value; } });
  const telemetry = executorTimeline();
  const action = vi.fn(async () => 42);
  try {
    const work = telemetry.channel.run('app.launch', action);
    expect(action).not.toHaveBeenCalled();
    process.emit('message', { timelineAck: message!.timeline.id, recorded: true });
    await vi.waitFor(() => expect(action).toHaveBeenCalledOnce());
    process.emit('message', { timelineAck: message!.timeline.id, recorded: true });
    expect(await work).toBe(42);
  } finally { telemetry.dispose(); }
});
it('degrades without throwing when IPC closes while waiting for ACK', async () => {
  vi.useFakeTimers();
  Object.defineProperty(process, 'connected', { configurable: true, value: true });
  const send = vi.fn();
  Object.defineProperty(process, 'send', { configurable: true, value: send });
  const telemetry = executorTimeline();
  try {
    const work = telemetry.channel.run('app.launch', async () => 42);
    Object.defineProperty(process, 'connected', { configurable: true, value: false });
    await vi.advanceTimersByTimeAsync(2001);
    expect(await work).toBe(42);
    expect(send).toHaveBeenCalledTimes(1);
  } finally { telemetry.dispose(); }
});
