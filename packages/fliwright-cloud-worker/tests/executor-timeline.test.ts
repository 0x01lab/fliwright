import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExecutionLease, WorkerTimelinePayload } from '@fliwright/cloud-protocol';
import { WorkerTimelineChannel } from '../src/WorkerTimelineChannel.js';
import { fingerprintScenario, prepareManagedAppAttempt, ScenarioResolver, VmServiceEndpointResolver, type VmServiceEndpointLease } from '@fliwright/core';

const mocks = vi.hoisted(() => ({ command: vi.fn(), run: vi.fn(), export: vi.fn(), health: vi.fn(), channel: undefined as WorkerTimelineChannel | undefined, acquire: vi.fn(), native: vi.fn(), nativeDispose: vi.fn(), prepareAttempt: vi.fn(), ipcAcquire: vi.fn(), ipcPrepare: vi.fn() }));
vi.mock('../src/native-ownership-ipc.js', () => ({ requestNativeOwnership: mocks.ipcAcquire, requestNativePreparation: mocks.ipcPrepare }));
vi.mock('../src/worker-timeline-ipc.js', () => ({ executorTimeline: () => ({ channel: mocks.channel, dispose() {} }) }));
vi.mock('../src/processes.js', () => ({ runCommandProcess: mocks.command }));
vi.mock('@fliwright/core', async original => ({ ...await original<object>(), waitForVmServiceEndpoint: mocks.health }));
vi.mock('@fliwright/cli/run', async original => ({ ...await original<object>(), runCommand: mocks.run, artifactsExportCommand: mocks.export, prepareNativeRun: mocks.native }));
vi.mock('@fliwright/tdd', () => ({
  FlutterDaemonController: class { async dispose() {} },
  FlutterDaemonEndpointSource: class { name = 'worker'; acquire = mocks.acquire; },
  parseDaemonLines: () => [],
}));
import { executeJob } from '../src/executor.js';

let directory: string, events: WorkerTimelinePayload[], lease: ExecutionLease;
beforeEach(() => {
  vi.clearAllMocks();
  directory = mkdtempSync(join(tmpdir(), 'executor-timeline-'));
  mkdirSync(join(directory, 'checkout'));
  events = [];
  mocks.channel = new WorkerTimelineChannel(async payload => { events.push(payload); return true; });
  mocks.command.mockResolvedValue('a'.repeat(40));
  mocks.native.mockResolvedValue(undefined);
  mocks.nativeDispose.mockResolvedValue(undefined);
  mocks.prepareAttempt.mockResolvedValue(undefined);
  mocks.ipcPrepare.mockResolvedValue(undefined);
  mocks.ipcAcquire.mockResolvedValue({ delegation: { rootDir: '/lease', key: 'a'.repeat(64), token: 'b'.repeat(64) } });
  mocks.acquire.mockResolvedValue({ url: 'ws://localhost:1234/test/ws', source: 'worker', scope: 'execution-worker' });
  mocks.health.mockResolvedValue({ status: 'ok', checkedAt: new Date().toISOString(), bridgeCapabilities: {} });
  mocks.run.mockResolvedValue({ status: 'failed', passed: false, artifacts: { runId: 'run' } });
  mocks.export.mockImplementation(async ({ output }) => { mkdirSync(output); writeFileSync(join(output, 'run.json'), JSON.stringify({ tests: [] })); });
  lease = { workerId: 'mac', slotId: 'ios', attemptId: 'execution', generation: 1, deviceId: 'phone', expiresAt: Date.now() + 30000,
    request: { id: 'request', input: { commit: 'a'.repeat(40), suite: 'smoke', scenario: 'clean' },
      target: { repository: '/registered/repository', projectPath: '.', entry: 'lib/main.dart', flutterArgs: [], install: [], requiredCapabilities: [], suites: { smoke: '*.test.ts' } } } } as unknown as ExecutionLease;
});
afterEach(() => { rmSync(directory, { recursive: true, force: true }); });
async function execute(nativeSupervisor = false) {
  const path = join(directory, 'job.json');
  writeFileSync(path, JSON.stringify({ lease, directory, flutterBin: 'flutter', resetCommands: [], nativeSupervisor }));
  return executeJob(path, new AbortController().signal);
}
const phases = () => events.filter((p): p is Extract<WorkerTimelinePayload, { type: 'span.started' }> => p.type === 'span.started' && !p.parentSpanId);
function completion(phase: string) {
  const start = phases().find(p => p.phase === phase);
  return events.find(p => p.type === 'span.finished' && p.spanId === start?.spanId);
}
it('records checkout failure without starting Flutter or inventing later phases', async () => {
  mocks.command.mockRejectedValue(Object.assign(new Error('secret args'), { exitCode: 128 }));
  expect(await execute()).toMatchObject({ verdict: 'unknown', infrastructure: 'permanent' });
  expect(phases().map(p => p.phase)).toEqual(['repository.checkout']);
  expect(completion('repository.checkout')).toMatchObject({ status: 'failed', exitCode: 128 });
  expect(mocks.acquire).not.toHaveBeenCalled();
  expect(JSON.stringify(events)).not.toContain('secret args');
});
it('marks missing required bridge capabilities as verification failure', async () => {
  lease.request.target.requiredCapabilities = ['snap'];
  expect(await execute()).toMatchObject({ verdict: 'unknown', infrastructure: 'permanent' });
  expect(completion('app.verify')).toMatchObject({ status: 'failed', error: { code: 'verification_failed' } });
  expect(mocks.run).not.toHaveBeenCalled();
});
it('retains a safe protocol mismatch diagnosis on the failed phase and in the local executor log', async () => {
  mocks.health.mockRejectedValue(Object.assign(new Error('incompatible'), { code: 'BRIDGE_PROTOCOL_INCOMPATIBLE', health: { clientProtocolVersion: 2, bridgeProtocolVersion: 1 } }));
  await execute();
  expect(completion('app.verify')).toMatchObject({ status: 'failed', error: { message: expect.stringContaining('client=2, bridge=1') } });
  expect(readFileSync(join(directory, 'commands.log'), 'utf8')).toContain('BRIDGE_PROTOCOL_INCOMPATIBLE');
});
it('records successful runner completion with a failed test verdict and the original run identity', async () => {
  expect(await execute()).toMatchObject({ verdict: 'failed', bundleDir: join(directory, 'bundle') });
  expect(completion('tests.run')).toMatchObject({ status: 'succeeded', testVerdict: 'failed', runId: 'run' });
  expect(completion('artifacts.export')).toMatchObject({ status: 'succeeded' });
  expect(phases().map(p => p.phase)).not.toContain('dependencies.install');
  expect(phases().map(p => p.phase)).not.toContain('device.reset.before');
});
it('prunes local-only checkout links before installation and continues executing source tests', async () => {
  const external = join(directory, 'host-file'), link = join(directory, 'checkout', 'local-only');
  writeFileSync(external, 'host content');
  symlinkSync(external, link);
  lease.request.target.install = [{ program: 'install', args: [] }];
  mocks.command.mockImplementation(async (command: { program: string }) => {
    if (command.program === 'install') expect(existsSync(link)).toBe(false);
    return 'a'.repeat(40);
  });
  expect(await execute()).toMatchObject({ verdict: 'failed', bundleDir: join(directory, 'bundle') });
  expect(existsSync(link)).toBe(false);
  expect(readFileSync(external, 'utf8')).toBe('host content');
  expect(mocks.run).toHaveBeenCalled();
});
it('preserves the test verdict when report export fails and records export failure separately', async () => {
  mocks.export.mockRejectedValue(new Error('export failed'));
  expect(await execute()).toMatchObject({ verdict: 'failed', error: 'Artifact export failed; original verdict retained' });
  expect(completion('tests.run')).toMatchObject({ status: 'succeeded', testVerdict: 'failed' });
  expect(completion('artifacts.export')).toMatchObject({ status: 'failed' });
});

it('executes a direct run without selecting a repository default scenario', async () => {
  delete lease.request.input.scenario;
  expect(await execute()).toMatchObject({ verdict: 'failed' });
  expect(mocks.run).toHaveBeenCalledWith(expect.objectContaining({ scenario: null, scenarioMode: 'managed-start' }));
  expect(mocks.native).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ scenario: null }));
});

it('owns native devices before reset and launch, delegates to tests and releases after execution', async () => {
  const delegation = { rootDir: '/private/lease', key: 'a'.repeat(64), token: 'b'.repeat(64) };
  mocks.native.mockResolvedValue({ delegation, dispose: mocks.nativeDispose });
  await execute();
  expect(mocks.native).toHaveBeenCalledWith(join(directory, 'checkout'), expect.objectContaining({ deviceId: 'phone', scenario: 'clean' }));
  expect(mocks.acquire).not.toHaveBeenCalled();
  expect(mocks.health).not.toHaveBeenCalled();
  expect(phases().map(p => p.phase)).not.toContain('app.launch');
  expect(phases().map(p => p.phase)).not.toContain('app.verify');
  expect(mocks.run).toHaveBeenCalledWith(expect.objectContaining({ vmUrl: undefined, nativeDelegation: delegation }));
  expect(mocks.nativeDispose.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.run.mock.invocationCallOrder[0]);
  expect(mocks.nativeDispose).toHaveBeenCalledWith({ cleanupConfirmed: true });
  expect(JSON.stringify(events)).not.toContain(delegation.token);
});

it('refuses launch when native ownership preparation fails', async () => {
  mocks.native.mockRejectedValue(new Error('device busy'));
  expect(await execute()).toMatchObject({ verdict: 'unknown', infrastructure: 'permanent' });
  expect(mocks.acquire).not.toHaveBeenCalled();
  expect(mocks.run).not.toHaveBeenCalled();
});

it.each([false, true])('uses the retained installed-app control without a Flutter daemon or preparation relay (supervisor: %s)', async supervised => {
  const managedAppControl = { url: 'http://127.0.0.1:12345', token: 'd'.repeat(64), sessionId: 'installed-owner', timeoutMs: 600000 };
  const delegation = { rootDir: '/private/lease', key: 'a'.repeat(64), token: 'b'.repeat(64) };
  mocks.native.mockResolvedValue({ delegation, managedAppControl, dispose: mocks.nativeDispose });
  mocks.ipcAcquire.mockResolvedValue({ delegation, managedAppControl });
  expect(await execute(supervised)).toMatchObject({ verdict: 'failed' });
  expect(mocks.run).toHaveBeenCalledWith(expect.objectContaining({ vmUrl: undefined, nativeDelegation: delegation, managedAppControl }));
  expect(mocks.acquire).not.toHaveBeenCalled(); expect(mocks.health).not.toHaveBeenCalled(); expect(mocks.ipcPrepare).not.toHaveBeenCalled();
  if (!supervised) expect(mocks.native).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ launch: {
    target: 'lib/main.dart', flutterBin: 'flutter', flutterArgs: [], requiredCapabilities: [],
  } }));
  expect(JSON.stringify(events)).not.toContain(managedAppControl.token);
  expect(readFileSync(join(directory, 'job.json'), 'utf8')).not.toContain(managedAppControl.token);
});

it.each([false, true])('prepares every relaunch using the retained owner without journaling credentials (supervisor: %s)', async nativeSupervisor => {
  const scenario = { name: 'clean', layers: [{ kind: 'device' as const, requiredCapabilities: ['native.query'] }] };
  writeFileSync(join(directory, 'checkout', 'fliwright.config.ts'), `export default {scenarios:{clean:${JSON.stringify(scenario)}}};`);
  mocks.native.mockResolvedValue({ delegation: {}, dispose: mocks.nativeDispose, prepareAttempt: mocks.prepareAttempt });
  let token: string | undefined;
  mocks.run.mockImplementation(async options => {
    expect(mocks.acquire).not.toHaveBeenCalled();
    expect(options.vmUrl).toBeUndefined();
    token = options.managedAppControl.token;
    for (const attemptKey of ['first', 'retry']) {
      await prepareManagedAppAttempt(options.managedAppControl, { attemptKey, scenarioName: 'clean',
        scenarioFingerprint: fingerprintScenario(new ScenarioResolver({ clean: scenario }).resolve('clean')) });
    }
    return { status: 'passed', passed: true, artifacts: { runId: 'run' } };
  });
  const result = await execute(nativeSupervisor);
  expect(result, existsSync(join(directory,'commands.log')) ? readFileSync(join(directory,'commands.log'),'utf8') : '').toMatchObject({ verdict: 'passed' });
  expect(mocks.acquire).toHaveBeenCalledTimes(2);
  if (nativeSupervisor) {
    expect(mocks.native).not.toHaveBeenCalled();
    expect(mocks.ipcPrepare.mock.calls.map(call => call[1].attemptKey)).toEqual(['first', 'retry']);
    expect(mocks.prepareAttempt).not.toHaveBeenCalled();
  } else {
    expect(mocks.native).toHaveBeenCalledOnce();
    expect(mocks.prepareAttempt.mock.calls.map(call => call[0].attemptKey)).toEqual(['first', 'retry']);
    expect(mocks.ipcPrepare).not.toHaveBeenCalled();
  }
  expect(JSON.stringify(events)).not.toContain(token!);
  expect(readFileSync(join(directory, 'result.json'), 'utf8')).not.toContain(token!);
});

it('reports native release failure as infrastructure failure while retaining the test verdict', async () => {
  mocks.native.mockResolvedValue({ delegation: {}, dispose: mocks.nativeDispose });
  mocks.nativeDispose.mockRejectedValue(new Error('device remains quarantined'));
  expect(await execute()).toMatchObject({ verdict: 'failed', infrastructure: 'permanent', error: 'Native device cleanup failed; explicit recovery required' });
});

it('disposes each attempt endpoint before launching its successor and closes the latest endpoint on runner failure', async () => {
  mocks.native.mockResolvedValue({ delegation: {}, dispose: mocks.nativeDispose, prepareAttempt: mocks.prepareAttempt });
  const endpoints: VmServiceEndpointLease[] = [];
  const acquire = VmServiceEndpointResolver.prototype.acquire;
  const spy = vi.spyOn(VmServiceEndpointResolver.prototype, 'acquire').mockImplementation(async function(this: VmServiceEndpointResolver, request) {
    const endpoint = await acquire.call(this, request);
    endpoints.push(endpoint);
    return endpoint;
  });
  mocks.acquire.mockImplementation(async () => {
    if (endpoints.length) expect(endpoints.at(-1)!.status).toBe('disposed');
    return { url: `ws://localhost:${1234 + endpoints.length}/test/ws`, source: 'worker', scope: 'execution-worker' };
  });
  mocks.run.mockImplementation(async options => {
    for (const attemptKey of ['first', 'retry']) {
      await prepareManagedAppAttempt(options.managedAppControl, { attemptKey });
      expect(endpoints.at(-1)!.status).toBe('active');
    }
    throw new Error('runner stopped unexpectedly');
  });
  try {
    expect(await execute()).toMatchObject({ verdict: 'unknown', infrastructure: 'permanent' });
    expect(endpoints).toHaveLength(2);
    expect(endpoints.map(endpoint => endpoint.status)).toEqual(['disposed', 'disposed']);
    expect(mocks.nativeDispose).toHaveBeenCalledWith({ cleanupConfirmed: true });
  } finally { spy.mockRestore(); }
});

it.each(['launch', 'verify'] as const)('fences later attempts after %s fails without running a body or replaying startup', async phase => {
  mocks.native.mockResolvedValue({ delegation: {}, dispose: mocks.nativeDispose, prepareAttempt: mocks.prepareAttempt });
  if (phase === 'launch') mocks.acquire.mockRejectedValue(new Error('launch unavailable'));
  else mocks.health.mockRejectedValue(new Error('bridge unavailable'));
  const body = vi.fn();
  mocks.run.mockImplementation(async options => {
    await expect(prepareManagedAppAttempt(options.managedAppControl, { attemptKey: 'first' }).then(body)).rejects.toThrow();
    await expect(prepareManagedAppAttempt(options.managedAppControl, { attemptKey: 'retry' }).then(body)).rejects.toThrow();
    return { status: 'failed', passed: false, artifacts: { runId: 'run' } };
  });
  expect(await execute()).toMatchObject({ verdict: 'failed' });
  expect(body).not.toHaveBeenCalled();
  expect(mocks.acquire).toHaveBeenCalledOnce();
  expect(mocks.prepareAttempt).toHaveBeenCalledOnce();
  expect(completion(`app.${phase}`)).toMatchObject({ status: 'failed' });
});
