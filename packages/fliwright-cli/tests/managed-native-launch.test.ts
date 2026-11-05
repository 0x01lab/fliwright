import { beforeEach, expect, it, vi } from 'vitest';
import { CommandRegistry } from '../src/CommandRegistry.js';
import { executeCli } from '../src/index.js';
import { registerFinite } from '../src/registry/finite.js';
import { prepareManagedAppAttempt } from '@fliwright/core';

const mocks = vi.hoisted(() => ({ prepare: vi.fn(), prepareAttempt: vi.fn(), release: vi.fn(), start: vi.fn(), launch: vi.fn(), stop: vi.fn(), dispose: vi.fn(), run: vi.fn(), verify: vi.fn() }));
vi.mock('../src/ManagedNativeRun.js', () => ({ prepareNativeRun: mocks.prepare }));
vi.mock('../src/commands/run.js', () => ({ runCommand: mocks.run }));
vi.mock('@fliwright/core', async original => ({ ...await original<object>(), waitForVmServiceEndpoint: mocks.verify }));
vi.mock('@fliwright/tdd', async original => ({ ...await original<object>(),
  SubprocessDaemonTransport: class {},
  FlutterDaemonController: class {
    start = mocks.start; startApp = mocks.launch; stop = mocks.stop; dispose = mocks.dispose;
  },
}));
const delegation = { rootDir: '/lease', key: 'a'.repeat(64), token: 'b'.repeat(64) };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.prepare.mockResolvedValue({ delegation, dispose: mocks.release, prepareAttempt: mocks.prepareAttempt });
  mocks.launch.mockResolvedValue({ appId: 'app', wsUri: 'ws://localhost/app/ws' });
  mocks.run.mockResolvedValue({ passed: true });
});
function invoke(...args: string[]) {
  const registry = new CommandRegistry(); registerFinite(registry);
  return executeCli(['run', '--json', ...args], registry);
}

it('retains device ownership without launching Flutter when the runner requests no attempts', async () => {
  const response = await invoke('--device-id', 'phone');
  expect(response.exitCode, response.stdout).toBe(0);
  expect(mocks.start).not.toHaveBeenCalled();
  expect(mocks.launch).not.toHaveBeenCalled();
  expect(mocks.verify).not.toHaveBeenCalled();
  expect(mocks.prepareAttempt).not.toHaveBeenCalled();
  expect(mocks.run).toHaveBeenCalledWith(expect.objectContaining({ vmUrl: undefined, nativeDelegation: delegation, scenarioMode: 'managed-start' }));
  expect(mocks.dispose.mock.invocationCallOrder[0]).toBeLessThan(mocks.release.mock.invocationCallOrder[0]);
  expect(mocks.release).toHaveBeenCalledWith({ cleanupConfirmed: true });
  expect(response.stdout).not.toContain(delegation.token);
});

it('passes the installed owner control directly to the runner without constructing a Flutter relaunch path', async () => {
  const managedAppControl = { url: 'http://127.0.0.1:12345', token: 'd'.repeat(64), sessionId: 'owner-control', timeoutMs: 600000 };
  mocks.prepare.mockResolvedValue({ delegation, managedAppControl, dispose: mocks.release, prepareAttempt: mocks.prepareAttempt });
  expect((await invoke('--device-id', 'phone', '--target', 'lib/native.dart', '--flutter-args', '["--flavor=qa"]')).exitCode).toBe(0);
  expect(mocks.run).toHaveBeenCalledWith(expect.objectContaining({ vmUrl: undefined, managedAppControl, nativeDelegation: delegation, scenarioMode: 'managed-start' }));
  expect(mocks.prepare).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ launch: expect.objectContaining({ target: 'lib/native.dart', flutterArgs: ['--flavor=qa'] }) }));
  expect(mocks.launch).not.toHaveBeenCalled(); expect(mocks.verify).not.toHaveBeenCalled();
  expect(mocks.prepareAttempt).not.toHaveBeenCalled();
  expect(mocks.release).toHaveBeenCalledWith({ cleanupConfirmed: true });
});

it('does not launch Flutter if the native device is unavailable', async () => {
  mocks.prepare.mockRejectedValue(new Error('device quarantined'));
  expect((await invoke('--device-id', 'phone')).exitCode).not.toBe(0);
  expect(mocks.start).not.toHaveBeenCalled();
  expect(mocks.run).not.toHaveBeenCalled();
});

it('prepares the explicitly selected scenario before managed launch', async () => {
  expect((await invoke('--device-id', 'phone', '--scenario', 'camera')).exitCode).toBe(0);
  expect(mocks.prepare).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ scenario: 'camera' }));
});

it('quarantines unconfirmed Flutter cleanup and releases ownership after a launch failure', async () => {
  mocks.run.mockImplementation(async options => {
    await prepareManagedAppAttempt(options.managedAppControl, { attemptKey: 'first' });
    throw new Error('test body must not run');
  });
  mocks.launch.mockRejectedValue(new Error('launch failed'));
  mocks.dispose.mockRejectedValue(new Error('Flutter did not stop'));
  expect((await invoke('--device-id', 'phone')).exitCode).not.toBe(0);
  expect(mocks.release).toHaveBeenCalledWith({ cleanupConfirmed: false });
});

it('leaves attach ownership to the task fixture', async () => {
  expect((await invoke('--vm-url', 'ws://localhost/app/ws')).exitCode).toBe(0);
  expect(mocks.prepare).not.toHaveBeenCalled();
  expect(mocks.start).not.toHaveBeenCalled();
  expect(mocks.run).toHaveBeenCalledWith(expect.objectContaining({ nativeDelegation: undefined, scenarioMode: 'attach' }));
});

it('uses its retained device owner between stopping the old app and launching the attempt app', async () => {
  mocks.run.mockImplementation(async options => {
    expect(mocks.launch).not.toHaveBeenCalled();
    for (const attemptKey of ['first', 'retry']) await prepareManagedAppAttempt(options.managedAppControl, { attemptKey });
    return { passed: true };
  });
  expect((await invoke('--device-id', 'phone')).exitCode).toBe(0);
  expect(mocks.prepareAttempt).toHaveBeenCalledWith({ attemptKey: 'first', scenarioName: undefined, scenarioFingerprint: undefined }, expect.any(AbortSignal));
  expect(mocks.launch).toHaveBeenCalledTimes(2);
  expect(mocks.prepare.mock.invocationCallOrder[0]).toBeLessThan(mocks.prepareAttempt.mock.invocationCallOrder[0]);
  expect(mocks.prepareAttempt.mock.invocationCallOrder[0]).toBeLessThan(mocks.launch.mock.invocationCallOrder[0]);
  expect(mocks.launch.mock.calls.map(call => call[1])).toEqual([{ debugPortTimeoutMs: 120000 }, { debugPortTimeoutMs: 120000 }]);
  expect(mocks.stop.mock.invocationCallOrder[0]).toBeLessThan(mocks.prepareAttempt.mock.invocationCallOrder[1]);
  expect(mocks.prepareAttempt.mock.invocationCallOrder[1]).toBeLessThan(mocks.launch.mock.invocationCallOrder[1]);
  expect(mocks.prepare).toHaveBeenCalledOnce();
});

it('keeps the ordinary managed Flutter launch when native integration is disabled', async () => {
  mocks.prepare.mockResolvedValue(undefined);
  expect((await invoke('--device-id', 'phone')).exitCode).toBe(0);
  expect(mocks.launch).toHaveBeenCalledOnce();
  expect(mocks.verify.mock.invocationCallOrder[0]).toBeLessThan(mocks.run.mock.invocationCallOrder[0]);
  expect(mocks.run).toHaveBeenCalledWith(expect.objectContaining({ vmUrl: 'ws://localhost/app/ws', managedAppControl: undefined }));
});

it('does not run the body or retry launch after attempt endpoint verification fails', async () => {
  const body = vi.fn();
  const secret = 'ws://localhost/private-vm-token/ws /private/host secret-value';
  mocks.verify.mockRejectedValue(new Error(secret));
  let failure: unknown;
  mocks.run.mockImplementation(async options => {
    failure = await prepareManagedAppAttempt(options.managedAppControl, { attemptKey: 'first' }).then(body).catch(error => error);
    await expect(prepareManagedAppAttempt(options.managedAppControl, { attemptKey: 'retry' })).rejects.toThrow();
    return { passed: false };
  });
  expect((await invoke('--device-id', 'phone')).exitCode).not.toBe(0);
  expect(failure).toBeInstanceOf(Error);
  expect((failure as Error).message).toContain('preparation failed during verify-endpoint');
  expect((failure as Error).message).not.toMatch(/private-vm-token|private\/host|secret-value/);
  expect(body).not.toHaveBeenCalled();
  expect(mocks.launch).toHaveBeenCalledOnce();
  expect(mocks.prepareAttempt).toHaveBeenCalledOnce();
});
