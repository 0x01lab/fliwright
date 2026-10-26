import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExecutionLease, WorkerTimelinePayload } from '@fliwright/cloud-protocol';
import { WorkerTimelineChannel } from '../src/WorkerTimelineChannel.js';

const mocks = vi.hoisted(() => ({ command: vi.fn(), run: vi.fn(), export: vi.fn(), health: vi.fn(), channel: undefined as WorkerTimelineChannel | undefined, acquire: vi.fn() }));
vi.mock('../src/worker-timeline-ipc.js', () => ({ executorTimeline: () => ({ channel: mocks.channel, dispose() {} }) }));
vi.mock('../src/processes.js', () => ({ runCommandProcess: mocks.command }));
vi.mock('@fliwright/core', async original => ({ ...await original<object>(), waitForVmServiceEndpoint: mocks.health }));
vi.mock('@fliwright/cli/run', async original => ({ ...await original<object>(), runCommand: mocks.run, artifactsExportCommand: mocks.export }));
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
  mocks.acquire.mockResolvedValue({ url: 'ws://localhost:1234/test/ws', source: 'worker', scope: 'execution-worker' });
  mocks.health.mockResolvedValue({ status: 'ok', checkedAt: new Date().toISOString(), bridgeCapabilities: {} });
  mocks.run.mockResolvedValue({ status: 'failed', passed: false, artifacts: { runId: 'run' } });
  mocks.export.mockImplementation(async ({ output }) => { mkdirSync(output); writeFileSync(join(output, 'run.json'), JSON.stringify({ tests: [] })); });
  lease = { workerId: 'mac', slotId: 'ios', attemptId: 'execution', generation: 1, deviceId: 'phone', expiresAt: Date.now() + 30000,
    request: { id: 'request', input: { commit: 'a'.repeat(40), suite: 'smoke', scenario: 'clean' },
      target: { repository: '/registered/repository', projectPath: '.', entry: 'lib/main.dart', flutterArgs: [], install: [], requiredCapabilities: [], suites: { smoke: '*.test.ts' } } } } as unknown as ExecutionLease;
});
afterEach(() => { rmSync(directory, { recursive: true, force: true }); });
async function execute() {
  const path = join(directory, 'job.json');
  writeFileSync(path, JSON.stringify({ lease, directory, flutterBin: 'flutter', resetCommands: [] }));
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
