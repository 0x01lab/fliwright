import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: mock.spawn }));
import { SubprocessDaemonTransport } from '../../src/daemon/SubprocessDaemonTransport.js';
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it.each([true, false])('waits for confirmed process exit after escalation (%s)', async exits => {
  vi.useFakeTimers();
  const child = Object.assign(new EventEmitter(), { pid: 12345, stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), exitCode: null, signalCode: null });
  mock.spawn.mockReturnValue(child);
  const kill = vi.spyOn(process, 'kill').mockImplementation((_pid, signal) => {
    if (signal === 'SIGKILL' && exits) setTimeout(() => child.emit('exit', null, signal), 25);
    return true;
  });
  const transport = new SubprocessDaemonTransport();
  await transport.connect();
  const launch = transport.request('app.start').catch(()=>undefined);
  const dispose = transport.dispose();
  const outcome = exits ? expect(dispose).resolves.toBeUndefined() : expect(dispose).rejects.toThrow(/termination.*confirmed/i);
  await vi.advanceTimersByTimeAsync(5000);
  await outcome;
  await launch;
  expect(kill.mock.calls.map(call=>call[1])).toEqual(['SIGTERM','SIGKILL']);
  expect(transport.dispose()).toBe(dispose);
});
