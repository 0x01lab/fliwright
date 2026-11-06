import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { ExecutionLease } from '@fliwright/cloud-protocol';
import { WorkerTimelineChannel } from '../src/WorkerTimelineChannel.js';
import { fingerprintScenario, prepareManagedAppAttempt, ScenarioResolver } from '@fliwright/core';

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), command: vi.fn(), run: vi.fn(), health: vi.fn(), native: vi.fn() }));
vi.mock('node:child_process', async original => ({ ...await original<object>(), spawn: mocks.spawn }));
vi.mock('../src/processes.js', () => ({ runCommandProcess: mocks.command }));
vi.mock('../src/worker-timeline-ipc.js', () => ({ executorTimeline: () => ({ channel: new WorkerTimelineChannel(async () => true), dispose() {} }) }));
vi.mock('@fliwright/core', async original => ({ ...await original<object>(), waitForVmServiceEndpoint: mocks.health }));
vi.mock('@fliwright/cli/run', async original => ({ ...await original<object>(), runCommand: mocks.run, prepareNativeRun: mocks.native }));
import { executeJob } from '../src/executor.js';

let directory: string, checkout: string;
beforeEach(() => {
  vi.clearAllMocks();
  directory = realpathSync(mkdtempSync(join(tmpdir(), 'executor-launch-')));
  checkout = join(directory, 'checkout');
  mkdirSync(checkout);
  mkdirSync(join(directory, 'runs'));
  mocks.command.mockResolvedValue('a'.repeat(40));
  mocks.health.mockResolvedValue({ status: 'ok', checkedAt: new Date().toISOString(), bridgeCapabilities: {} });
  mocks.run.mockResolvedValue({ status: 'passed', passed: true });
  mocks.native.mockResolvedValue(undefined);
  mocks.spawn.mockImplementation((_bin: string, args: string[], { cwd }: { cwd: string }) => {
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(),
      exitCode: null as number | null, signalCode: null as string | null, kill: vi.fn() });
    child.kill.mockImplementation((signal = 'SIGTERM') => {
      setTimeout(() => { child.signalCode = signal; child.emit('exit', null, signal); }, 10);
      return true;
    });
    child.stdin.on('data', chunk => {
      for (const request of JSON.parse(chunk.toString())) child.stdout.write(JSON.stringify([{ id: request.id, result: true }]) + '\n');
    });
    queueMicrotask(() => {
      // Flutter requires the platform project in its cwd, even when -t names a nested entry.
      if (!existsSync(join(cwd, 'ios/Runner/Info.plist')) || !existsSync(resolve(cwd, args[args.indexOf('-t') + 1]!))) {
        child.stderr.write('No application found for TargetPlatform.ios.\nIs your project missing an ios/Runner/Info.plist?\n');
        child.emit('exit', 1);
        return;
      }
      for (const message of [
        { event: 'app.start', params: { appId: 'app', deviceId: 'phone' } },
        { event: 'app.debugPort', params: { appId: 'app', wsUri: 'ws://localhost:1234/test/ws' } },
        { event: 'app.started', params: { appId: 'app' } },
      ]) child.stdout.write(`${JSON.stringify([message])}\n`);
    });
    return child;
  });
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

function file(path: string, content = '') {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}
async function execute(projectPath: string, entry: string) {
  const lease = { deviceId: 'phone', request: { input: { commit: 'a'.repeat(40), suite: 'smoke' },
    target: { repository: '/registered/repository', projectPath, entry, flutterArgs: [], install: [], requiredCapabilities: [], suites: { smoke: '.fliwright/tests/*.test.ts' } },
  } } as unknown as ExecutionLease;
  const path = join(directory, 'job.json');
  writeFileSync(path, JSON.stringify({ lease, directory, flutterBin: 'flutter', resetCommands: [] }));
  return executeJob(path, new AbortController().signal);
}

it('launches a nested Flutter app from its package while running repository tests from the configured project', async () => {
  file(join(checkout, 'pubspec.yaml'), 'name: workspace\nworkspace:\n  - apps/exio_app\n');
  file(join(checkout, 'apps/exio_app/pubspec.yaml'), 'name: exio_app\n');
  file(join(checkout, 'apps/exio_app/lib/main_fliwright.dart'));
  file(join(checkout, 'apps/exio_app/ios/Runner/Info.plist'));
  const result = await execute('.', 'apps/exio_app/lib/main_fliwright.dart');
  expect(existsSync(join(directory, 'commands.log')) ? readFileSync(join(directory, 'commands.log'), 'utf8') : '').not.toContain('No application found for TargetPlatform.ios.');
  expect(result).toMatchObject({ verdict: 'passed' });
  expect(mocks.spawn).toHaveBeenCalledWith('flutter', ['run', '--machine', '-d', 'phone', '-t', 'lib/main_fliwright.dart'], expect.objectContaining({ cwd: join(checkout, 'apps/exio_app') }));
  expect(mocks.run).toHaveBeenCalledWith(expect.objectContaining({ cwd: checkout, testPattern: '.fliwright/tests/*.test.ts' }));
});

it('launches an app whose configured project already is the Flutter package', async () => {
  file(join(checkout, 'app/pubspec.yaml'), 'name: app\n');
  file(join(checkout, 'app/lib/main.dart'));
  file(join(checkout, 'app/ios/Runner/Info.plist'));
  expect(await execute('app', 'lib/main.dart')).toMatchObject({ verdict: 'passed' });
  expect(mocks.spawn).toHaveBeenCalledWith('flutter', expect.arrayContaining(['-t', 'lib/main.dart']), expect.objectContaining({ cwd: join(checkout, 'app') }));
});

it.each(['missing.dart', '.', '../outside.dart', 'lib/main.dart'])('rejects an invalid entry before launching Flutter: %s', async entry => {
  file(join(directory, 'outside.dart'));
  file(join(checkout, 'lib/main.dart'));
  // The lib entry exists but has no owning pubspec in the configured project.
  expect(await execute('.', entry)).toMatchObject({ verdict: 'unknown', infrastructure: 'permanent' });
  expect(mocks.spawn).not.toHaveBeenCalled();
  expect(mocks.run).not.toHaveBeenCalled();
});

it('confirms each old Flutter process exits before starting the next managed device attempt', async () => {
  file(join(checkout, 'pubspec.yaml'), 'name: app\n'); file(join(checkout,'lib/main.dart'));
  file(join(checkout, 'ios/Runner/Info.plist'));
  const scenario = { name: 'device', layers: [{ kind:'device' as const }] };
  file(join(checkout, 'fliwright.config.ts'), `export default {scenarios:{device:${JSON.stringify(scenario)}}};`);
  mocks.native.mockResolvedValue({ delegation:{},dispose:async()=>{},prepareAttempt:async()=>{} });
  const original = mocks.spawn.getMockImplementation()!;
  let previous: { signalCode: string | null } | undefined;
  mocks.spawn.mockImplementation((...args) => {
    if(previous) expect(previous.signalCode).not.toBeNull();
    previous = original(...args) as { signalCode: string | null }; return previous;
  });
  mocks.run.mockImplementation(async options => {
    expect(mocks.spawn).not.toHaveBeenCalled();
    for(const attemptKey of ['first','retry']) await prepareManagedAppAttempt(options.managedAppControl, {
      attemptKey,scenarioName:'device',scenarioFingerprint:fingerprintScenario(new ScenarioResolver({device:scenario}).resolve('device')),
    });
    return {status:'passed',passed:true};
  });
  const result = await execute('.', 'lib/main.dart');
  expect(result,readFileSync(join(directory,'commands.log'),'utf8')).toMatchObject({verdict:'passed'});
  expect(mocks.spawn).toHaveBeenCalledTimes(2);
  expect(previous!.signalCode).not.toBeNull();
});
