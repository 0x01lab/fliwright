import {
  FlutterDaemonController,
  FlutterDaemonEndpointSource,
  parseDaemonLines,
  type DaemonTransport,
  type DaemonMessage,
} from '@fliwright/tdd';
import {
  VmServiceEndpointResolver,
  waitForVmServiceEndpoint,
  type VmServiceEndpoint,
  type VmServiceEndpointLease,
  type VmServiceAcquisitionRequest,
  type ManagedAppControl,
} from '@fliwright/core';
import {
  runCommand,
  RunFinalizationError,
  artifactsExportCommand,
  prepareNativeRun,
  startManagedAppControl,
  type ManagedNativeRun,
  type CliRunResult,
} from '@fliwright/cli/run';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import {
  mkdirSync,
  readFileSync,
  existsSync,
  statSync,
  readdirSync,
  realpathSync,
  copyFileSync,
  writeFileSync,
  appendFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, isAbsolute } from 'node:path';
import { runCommandProcess } from './processes.js';
import { writeJournal, type ExecutionResult } from './WorkerAgent.js';
import { workerPhaseStage, type ExecutionLease, type WorkerPhase } from '@fliwright/cloud-protocol';
import { executorTimeline } from './worker-timeline-ipc.js';
import { secureCatalogCheckout } from './catalog-scanner.js';
import { redactDiagnostic } from '@fliwright/cloud-protocol';
import { requestNativeOwnership, requestNativePreparation } from './native-ownership-ipc.js';

/** Flutter's machine process inherits the executor's durable, owned process group. */
class OwnedFlutterTransport implements DaemonTransport {
  private child?: ChildProcessWithoutNullStreams;
  private buffer = '';
  private stderrBuffer = '';
  private sequence = 1;
  private listeners = new Set<(message: DaemonMessage) => void>();
  private pending = new Map<
    number,
    { resolve: (value: any) => void; reject: (reason: Error) => void }
  >();
  private launchResolve?: (value: any) => void;
  private launchReject?: (reason: Error) => void;
  private app?: Record<string, unknown>;
  private exited?: Promise<void>;
  private closing?: Promise<void>;
  constructor(
    private bin: string,
    private cwd: string,
    private log: string,
    private signal: AbortSignal,
    private observe?: (message: DaemonMessage) => void,
  ) {}
  async connect() {}
  async request<T>(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<T> {
    this.signal.throwIfAborted();
    if (method === 'app.start') {
      const launch = resolveFlutterLaunch(this.cwd, String(params.target));
      return new Promise<T>((resolve, reject) => {
        this.launchResolve = resolve;
        this.launchReject = reject;
        this.child = spawn(
          this.bin,
          [
            'run',
            '--machine',
            '-d',
            String(params.deviceId),
            '-t',
            launch.target,
            ...((params.flutterArgs as string[]) ?? []),
          ],
          { cwd: launch.directory, stdio: 'pipe' },
        );
        this.exited = new Promise(resolve => { this.child!.once('exit', () => resolve()); });
        this.child.stdout.on('data', (chunk) => {
          this.buffer += String(chunk);
          let index: number;
          while ((index = this.buffer.indexOf('\n')) >= 0) {
            const line = this.buffer.slice(0, index);
            this.buffer = this.buffer.slice(index + 1);
            // Redact complete lines, including secrets split across stdout chunks.
            appendFileSync(this.log, redactDiagnostic(line) + '\n', { mode: 0o600 });
            for (const message of parseDaemonLines(line))
              this.dispatch(message);
          }
        });
        this.child.stderr.on('data', chunk => {
          this.stderrBuffer += String(chunk);
          let index: number;
          while ((index = this.stderrBuffer.indexOf('\n')) >= 0) {
            appendFileSync(this.log, redactDiagnostic(this.stderrBuffer.slice(0, index)) + '\n', { mode: 0o600 });
            this.stderrBuffer = this.stderrBuffer.slice(index + 1);
          }
        });
        this.child.on('error', () =>
          this.fail(new Error('Flutter launch failed')),
        );
        this.child.on('exit', () => {
          if (this.stderrBuffer) appendFileSync(this.log, redactDiagnostic(this.stderrBuffer) + '\n', { mode: 0o600 });
          if (this.buffer) appendFileSync(this.log, redactDiagnostic(this.buffer) + '\n', { mode: 0o600 });
          this.fail(new Error('Flutter machine process exited'));
        });
      });
    }
    if (!this.child) throw new Error('Flutter not running');
    const id = this.sequence++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child!.stdin.write(`${JSON.stringify([{ id, method, params }])}\n`);
    });
  }
  private dispatch(message: DaemonMessage) {
    this.observe?.(message);
    if (message.id !== undefined) {
      const p = this.pending.get(Number(message.id));
      this.pending.delete(Number(message.id));
      if (message.error) p?.reject(new Error('Flutter machine request failed'));
      else p?.resolve(message.result);
    }
    if (message.event === 'app.start') this.app = message.params;
    if (
      message.event === 'app.started' &&
      this.app?.appId === message.params?.appId
    ) {
      this.launchResolve?.(this.app);
      this.launchResolve = undefined;
    }
    for (const listener of this.listeners) listener(message);
  }
  private fail(e: Error) {
    this.launchReject?.(e);
    for (const p of this.pending.values()) p.reject(e);
    this.pending.clear();
  }
  onEvent(handler: (message: DaemonMessage) => void) {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }
  dispose(): Promise<void> {
    return this.closing ??= (async () => {
      this.fail(new Error('Flutter disposed'));
      const child = this.child;
      if (!child) return;
      const wait = async () => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          return await Promise.race([this.exited!.then(() => true), new Promise<boolean>(resolve => {
            timer = setTimeout(() => resolve(false), 2000);
          })]);
        } finally { clearTimeout(timer); }
      };
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
        if (!await wait()) {
          child.kill('SIGKILL');
          if (!await wait()) throw new Error('Owned Flutter process termination could not be confirmed.');
        }
      }
      this.child = undefined;
    })();
  }
}

/** Test/config roots can be workspace roots; Flutter must run in the entry's package. */
function resolveFlutterLaunch(project: string, entry: string) {
  const root = realpathSync(project), target = realpathSync(resolve(project, entry));
  const location = relative(root, target);
  if (isAbsolute(location) || location === '..' || location.startsWith('../'))
    throw new Error('Flutter entry escapes configured project');
  if (!statSync(target).isFile()) throw new Error('Flutter entry is not a file');
  let directory = dirname(target);
  while (true) {
    if (existsSync(join(directory, 'pubspec.yaml')))
      return { directory, target: relative(directory, target) };
    if (directory === root) break;
    directory = dirname(directory);
  }
  throw new Error('Flutter entry has no package inside the configured project');
}
interface Job {
  nativeSupervisor?: boolean;
  lease: ExecutionLease;
  directory: string;
  flutterBin: string;
  resetCommands: Array<{
    program: string;
    args: string[];
    acceptExitCodes?: number[];
  }>;
}
export async function executeJob(
  path: string,
  signal: AbortSignal,
): Promise<ExecutionResult> {
  const job = JSON.parse(readFileSync(path, 'utf8')) as Job,
    { lease, directory } = job,
    target = lease.request.target;
  const log = join(directory, 'commands.log'),
    checkout = join(directory, 'checkout'),
    runsRoot = join(directory, 'runs');
  const stage = (value: string) => process.send?.({ stage: value });
  const telemetry = executorTimeline(), timeline = telemetry.channel;
  const phase = <T>(name: WorkerPhase, action: (spanId?: string) => Promise<T>) => {
    stage(workerPhaseStage(name));
    return timeline.run(name, action, { signal });
  };
  const command = (program: string, args: string[], cwd = directory) =>
    runCommandProcess({ program, args }, cwd, log, signal);
  let daemon: FlutterDaemonController | undefined;
  let nativeRun: ManagedNativeRun | undefined;
  let nativeDelegation: ManagedNativeRun['delegation'] | undefined;
  let installedControl: ManagedAppControl | undefined;
  let managedApp: Awaited<ReturnType<typeof startManagedAppControl>> | undefined;
  let endpoint: VmServiceEndpointLease | undefined;
  const releaseEndpoint = async () => {
    await endpoint?.dispose();
    endpoint = undefined;
  };
  let result: CliRunResult | undefined;
  let finalizationFailed = false;
  let outcome: ExecutionResult = { verdict: 'unknown' };
  try {
    const project = await phase('repository.checkout', async parentSpanId => {
    await timeline.run('repository.checkout', () => command('git', [
      'clone',
      '--no-checkout',
      '--no-hardlinks',
      '--',
      target.repository,
      checkout,
    ]), { parentSpanId, operation: 'clone', signal });
    await timeline.run('repository.checkout', () => command(
      'git',
      [
        '-c',
        'core.hooksPath=/dev/null',
        'fetch',
        '--no-tags',
        'origin',
        lease.request.input.commit,
      ],
      checkout,
    ), { parentSpanId, operation: 'fetch', signal });
    await timeline.run('repository.checkout', () => command(
      'git',
      [
        '-c',
        'core.hooksPath=/dev/null',
        'checkout',
        '--detach',
        lease.request.input.commit,
      ],
      checkout,
    ), { parentSpanId, operation: 'checkout', signal });
    await timeline.run('repository.checkout', async () => {
    if ((await command('git', ['rev-parse', 'HEAD'], checkout)) !==
      lease.request.input.commit
    ) throw new Error('Checkout identity mismatch');
    }, { parentSpanId, operation: 'verify_sha', signal });
    await secureCatalogCheckout(checkout);
    const project = resolve(checkout, target.projectPath),
      actual = realpathSync(project),
      rel = relative(realpathSync(checkout), actual);
    if (isAbsolute(rel) || rel === '..' || rel.startsWith('../'))
      throw new Error('Project escapes registered checkout');
    return project;
    });
    if (target.install.length) await phase('dependencies.install', async parentSpanId => {
      for (const [commandIndex, cmd] of target.install.entries())
        await timeline.run('dependencies.install', () => runCommandProcess(cmd, project, log, signal), { parentSpanId, operation: 'command', commandIndex, signal });
    });
    if (job.nativeSupervisor) {
      const grant = await requestNativeOwnership(project, signal);
      nativeDelegation = grant?.delegation; installedControl = grant?.managedAppControl;
    }
    else {
      // Direct in-process embedding has no supervisor and owns its own cleanup.
      nativeRun = await prepareNativeRun(project, { deviceId: lease.deviceId, signal, scenario: lease.request.input.scenario ?? null,
        launch: { target: target.entry, flutterArgs: target.flutterArgs, requiredCapabilities: target.requiredCapabilities, flutterBin: job.flutterBin } });
      nativeDelegation = nativeRun?.delegation;
      installedControl = nativeRun?.managedAppControl;
    }
    if (job.resetCommands.length) await phase('device.reset.before', async parentSpanId => {
    for (const [commandIndex, cmd] of job.resetCommands.entries())
      await timeline.run('device.reset.before', () => runCommandProcess(
        {
          ...cmd,
          args: cmd.args.map((a) => a.replaceAll('{deviceId}', lease.deviceId)),
        },
        directory,
        log,
        signal,
      ), { parentSpanId, operation: 'command', commandIndex, signal });
    });
    let launchSpanId: string | undefined;
    const createDaemon = () => new FlutterDaemonController(
      new OwnedFlutterTransport(job.flutterBin, project, log, signal, message => {
        if (message.event === 'app.start') void timeline.milestone('app.process_started', launchSpanId);
        if (message.event === 'app.started') void timeline.milestone('app.started', launchSpanId);
        if (message.event === 'app.debugPort') void timeline.milestone('vm.endpoint_observed', launchSpanId);
      }),
    );
    daemon = createDaemon();
    const createSource = () => new FlutterDaemonEndpointSource({
      controller: daemon!,
      deviceId: lease.deviceId,
      projectId: project,
      target: target.entry,
      flutterArgs: target.flutterArgs,
      scope: 'execution-worker',
    });
    let source = createSource();
    let acquisitionSignal = signal;
    const resolver = new VmServiceEndpointResolver([{
      name: source.name,
      acquire: (request: VmServiceAcquisitionRequest) => phase('app.launch', spanId => {
        launchSpanId = spanId;
        return source.acquire(request);
      }),
    }], {
      persistWorkspaceCache: false,
      verify: (endpoint: VmServiceEndpoint) =>
        phase('app.verify', async () => {
          let lastCheck = '';
          let health;
          try {
          health = await waitForVmServiceEndpoint(endpoint, { signal: acquisitionSignal, timeoutMs: 30000, onCheck: check => {
            const message = JSON.stringify({ event: 'vm.verification', status: check.status, reason: check.reason,
              clientProtocolVersion: check.clientProtocolVersion, bridgeProtocolVersion: check.bridgeProtocolVersion });
            if (message !== lastCheck) { appendFileSync(log, redactDiagnostic(message) + '\n', { mode: 0o600 }); lastCheck = message; }
          } });
          } catch (error) {
            const incompatible = error as { code?: string; health?: { clientProtocolVersion?: number; bridgeProtocolVersion?: number } };
            if (incompatible.code === 'BRIDGE_PROTOCOL_INCOMPATIBLE') {
              const client = incompatible.health?.clientProtocolVersion, bridge = incompatible.health?.bridgeProtocolVersion;
              const safeMessage = `Bridge protocol incompatible (client=${Number.isFinite(client) ? client : 'unknown'}, bridge=${Number.isFinite(bridge) ? bridge : 'unknown'})`;
              appendFileSync(log, JSON.stringify({ event: 'vm.verification_failed', code: incompatible.code, message: safeMessage }) + '\n', { mode: 0o600 });
              throw Object.assign(new Error(safeMessage), { workerDiagnostic: safeMessage });
            }
            appendFileSync(log, JSON.stringify({ event: 'vm.verification_failed', message: redactDiagnostic(error instanceof Error ? error.message : String(error)) }) + '\n', { mode: 0o600 });
            throw error;
          }
          if (health.status !== 'ok' || target.requiredCapabilities.some(capability => health.bridgeCapabilities?.[capability] !== true))
            throw new Error('Required VM Service or Bridge capabilities are unavailable');
          return health;
        }),
    });
    if (!installedControl && nativeDelegation) managedApp = await startManagedAppControl(project, { signal,
      prepareDevice: job.nativeSupervisor
        ? (request, attemptSignal) => requestNativePreparation(project, request, attemptSignal)
        : (request, attemptSignal) => nativeRun!.prepareAttempt(request, attemptSignal),
      onError: error => appendFileSync(log, JSON.stringify({ event: 'app.attempt_preparation_failed', message: redactDiagnostic(error instanceof Error ? error.message : String(error)) }) + '\n', { mode: 0o600 }),
      cancel: async () => { await daemon?.dispose(); },
      async stop(attemptSignal) {
        attemptSignal.throwIfAborted();
        await releaseEndpoint();
        if (source.lastApp) await daemon!.stop(source.lastApp.appId);
        await daemon!.dispose();
      },
      async launch(attemptSignal) {
        attemptSignal.throwIfAborted();
        acquisitionSignal = attemptSignal;
        daemon = createDaemon();
        source = createSource();
        endpoint = await resolver.acquire({ scope: 'execution-worker', deviceId: lease.deviceId, requiredCapabilities: target.requiredCapabilities });
        attemptSignal.throwIfAborted();
        return { url: endpoint.url };
      },
    });
    else if (!installedControl) endpoint = await resolver.acquire({
      scope: 'execution-worker',
      deviceId: lease.deviceId,
      requiredCapabilities: target.requiredCapabilities,
    });
    stage('running');
    const testsSpan = await timeline.startSpan('tests.run');
    try {
      result = await runCommand({
        cwd: project,
        vmUrl: endpoint?.url,
        testPattern: lease.request.selection?.mode === 'case'
          ? lease.request.selection.file!
          : target.suites[lease.request.input.suite],
        ...(lease.request.selection?.mode === 'case'
          ? { caseSelection: { caseId: lease.request.selection.caseId!, file: lease.request.selection.file!, titlePath: lease.request.selection.titlePath!, duplicateIndex: lease.request.selection.duplicateIndex! } }
          : {}),
        scenario: lease.request.input.scenario ?? null,
        scenarioMode: 'managed-start',
        runsRoot,
        print: false,
        signal,
        processGroup: 'inherit',
        nativeDelegation,
        managedAppControl: installedControl ?? managedApp?.control,
      });
    } catch (e) {
      if (e instanceof RunFinalizationError) {
        result = e.runnerResult;
        finalizationFailed = true;
      } else {
        await timeline.finishSpan(testsSpan, signal.aborted ? 'interrupted' : 'failed', {
          reason: signal.aborted ? 'shutdown' : undefined,
          error: { code: 'runner_failed', message: 'Test runner failed' },
        });
        throw e;
      }
    }
    await timeline.finishSpan(testsSpan, result.runnerErrors?.length || finalizationFailed ? 'failed' : 'succeeded', {
      testVerdict: result.status === 'running' ? 'unknown' : result.status ?? (result.passed ? 'passed' : 'failed'),
      runId: result.artifacts?.runId,
      ...(result.runnerErrors?.length || finalizationFailed ? { error: { code: 'runner_failed' as const, message: 'Test runner failed' } } : {}),
    });
    await releaseEndpoint();
    outcome.verdict =
      result.status === 'running'
        ? 'unknown'
        : (result.status ?? (result.passed ? 'passed' : 'failed'));
    if (result.runnerErrors?.length) {
      outcome.infrastructure = 'permanent';
      outcome.error = 'Test runner reported infrastructure errors';
    }
    if (finalizationFailed)
      outcome.error = 'Artifact finalization failed; original verdict retained';
    const runId =
      result.artifacts?.runId ??
      readdirSync(runsRoot, { withFileTypes: true }).find((d) =>
        d.isDirectory(),
      )?.name;
    if (runId)
      try {
        await phase('artifacts.export', async () => {
        const bundle = join(directory, 'bundle');
        await artifactsExportCommand({
          cwd: project,
          runsRoot,
          runId,
          output: bundle,
          allowPartial: true,
        });
        captureSources(bundle, project);
        outcome.bundleDir = bundle;
        });
      } catch {
        outcome.error = 'Artifact export failed; original verdict retained';
      }
  } catch (error) {
    appendFileSync(log, JSON.stringify({ event: 'execution.failed', message: redactDiagnostic(error instanceof Error ? error.message : String(error)),
      stack: redactDiagnostic(error instanceof Error ? error.stack ?? '' : '') }) + '\n', { mode: 0o600 });
    outcome = {
      verdict: signal.aborted ? 'interrupted' : 'unknown',
      infrastructure: 'permanent',
      error:
        'Preparation, launch or execution failed; inspect Worker diagnostics',
    };
  } finally {
    let cleanupConfirmed = false;
    try {
      try { await managedApp?.dispose(); }
      finally {
        try { await releaseEndpoint(); }
        finally { if (daemon) await timeline.run('processes.stop', () => daemon!.dispose()); }
      }
      cleanupConfirmed = true;
    }
    catch { outcome.error ??= 'Flutter process disposal failed; supervisor termination required'; }
    finally {
      try { await nativeRun?.dispose({ cleanupConfirmed }); }
      catch { outcome.infrastructure = 'permanent'; outcome.error ??= 'Native device cleanup failed; explicit recovery required'; }
      telemetry.dispose();
      writeJournal(join(directory, 'result.json'), outcome);
    }
  }
  return outcome;
}
function captureSources(bundle: string, project: string) {
  const manifest = JSON.parse(
    readFileSync(join(bundle, 'run.json'), 'utf8'),
  ) as { tests: Array<{ attempts: Array<{ resultPath: string }> }> };
  for (const test of manifest.tests)
    for (const attempt of test.attempts) {
      const dir = dirname(join(bundle, attempt.resultPath)),
        path = join(dir, 'timeline.json');
      if (!existsSync(path)) continue;
      try {
        const timeline = JSON.parse(readFileSync(path, 'utf8')) as {
          nodes: Array<{ codeRef?: { file?: string; sourcePath?: string } }>;
        };
        for (const node of timeline.nodes ?? []) {
          const ref = node.codeRef;
          if (!ref?.file) continue;
          const source = realpathSync(resolve(project, ref.file)),
            rel = relative(realpathSync(project), source);
          if (
            isAbsolute(rel) ||
            rel.startsWith('..') ||
            !/\.(dart|ts|mjs)$/.test(source)
          )
            continue;
          const bytes = readFileSync(source);
          if (bytes.length > 256 * 1024) continue;
          const dest = join(dir, 'source', rel);
          mkdirSync(dirname(dest), { recursive: true });
          copyFileSync(source, dest);
          ref.sourcePath = relative(dir, dest).split('\\').join('/');
        }
        writeFileSync(path, JSON.stringify(timeline), { mode: 0o600 });
      } catch {
        /* Source snapshots are optional evidence; never change the test verdict. */
      }
    }
}
