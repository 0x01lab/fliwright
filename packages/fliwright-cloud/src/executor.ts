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
} from '@fliwright/core';
import {
  runCommand,
  RunFinalizationError,
  artifactsExportCommand,
  type CliRunResult,
} from '@fliwright/cli/run';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import {
  mkdirSync,
  readFileSync,
  existsSync,
  readdirSync,
  realpathSync,
  copyFileSync,
  writeFileSync,
  appendFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, isAbsolute } from 'node:path';
import { runCommandProcess } from './processes.js';
import { writeJournal, type ExecutionResult } from './WorkerAgent.js';
import type { ExecutionLease } from './contracts.js';

/** Flutter's machine process inherits the executor's durable, owned process group. */
class OwnedFlutterTransport implements DaemonTransport {
  private child?: ChildProcessWithoutNullStreams;
  private buffer = '';
  private sequence = 1;
  private listeners = new Set<(message: DaemonMessage) => void>();
  private pending = new Map<
    number,
    { resolve: (value: any) => void; reject: (reason: Error) => void }
  >();
  private launchResolve?: (value: any) => void;
  private launchReject?: (reason: Error) => void;
  private app?: Record<string, unknown>;
  constructor(
    private bin: string,
    private cwd: string,
    private log: string,
    private signal: AbortSignal,
  ) {}
  async connect() {}
  async request<T>(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<T> {
    this.signal.throwIfAborted();
    if (method === 'app.start')
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
            String(params.target),
            ...((params.flutterArgs as string[]) ?? []),
          ],
          { cwd: this.cwd, stdio: 'pipe' },
        );
        this.child.stdout.on('data', (chunk) => {
          this.buffer += String(chunk);
          let index: number;
          while ((index = this.buffer.indexOf('\n')) >= 0) {
            const line = this.buffer.slice(0, index);
            this.buffer = this.buffer.slice(index + 1);
            for (const message of parseDaemonLines(line))
              this.dispatch(message);
          }
        });
        this.child.stderr.on('data', (chunk) =>
          appendFileSync(this.log, chunk, { mode: 0o600 }),
        );
        this.child.on('error', () =>
          this.fail(new Error('Flutter launch failed')),
        );
        this.child.on('exit', () =>
          this.fail(new Error('Flutter machine process exited')),
        );
      });
    if (!this.child) throw new Error('Flutter not running');
    const id = this.sequence++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child!.stdin.write(`${JSON.stringify([{ id, method, params }])}\n`);
    });
  }
  private dispatch(message: DaemonMessage) {
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
  async dispose() {
    this.child?.kill('SIGTERM');
    this.fail(new Error('Flutter disposed'));
  }
}
interface Job {
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
  const command = (program: string, args: string[], cwd = directory) =>
    runCommandProcess({ program, args }, cwd, log, signal);
  let daemon: FlutterDaemonController | undefined;
  let result: CliRunResult | undefined;
  let finalizationFailed = false;
  let outcome: ExecutionResult = { verdict: 'unknown' };
  try {
    stage('checkout');
    await command('git', [
      'clone',
      '--no-checkout',
      '--no-hardlinks',
      '--',
      target.repository,
      checkout,
    ]);
    await command(
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
    );
    await command(
      'git',
      [
        '-c',
        'core.hooksPath=/dev/null',
        'checkout',
        '--detach',
        lease.request.input.commit,
      ],
      checkout,
    );
    if (
      (await command('git', ['rev-parse', 'HEAD'], checkout)) !==
      lease.request.input.commit
    )
      throw new Error('Checkout identity mismatch');
    const project = resolve(checkout, target.projectPath),
      actual = realpathSync(project),
      rel = relative(realpathSync(checkout), actual);
    if (isAbsolute(rel) || rel === '..' || rel.startsWith('../'))
      throw new Error('Project escapes registered checkout');
    stage('install');
    for (const cmd of target.install)
      await runCommandProcess(cmd, project, log, signal);
    stage('reset_before');
    for (const cmd of job.resetCommands)
      await runCommandProcess(
        {
          ...cmd,
          args: cmd.args.map((a) => a.replaceAll('{deviceId}', lease.deviceId)),
        },
        directory,
        log,
        signal,
      );
    stage('launch');
    daemon = new FlutterDaemonController(
      new OwnedFlutterTransport(job.flutterBin, project, log, signal),
    );
    const source = new FlutterDaemonEndpointSource({
      controller: daemon,
      deviceId: lease.deviceId,
      projectId: project,
      target: target.entry,
      flutterArgs: target.flutterArgs,
      scope: 'execution-worker',
    });
    const resolver = new VmServiceEndpointResolver([source], {
      persistWorkspaceCache: false,
      verify: (endpoint: VmServiceEndpoint) =>
        waitForVmServiceEndpoint(endpoint, { signal, timeoutMs: 30000 }),
    });
    const endpoint = await resolver.acquire({
      scope: 'execution-worker',
      deviceId: lease.deviceId,
      requiredCapabilities: target.requiredCapabilities,
    });
    stage('running');
    try {
      result = await runCommand({
        cwd: project,
        vmUrl: endpoint.url,
        testPattern: target.suites[lease.request.input.suite],
        scenario: lease.request.input.scenario,
        scenarioMode: 'managed-start',
        runsRoot,
        print: false,
        signal,
        processGroup: 'inherit',
      });
    } catch (e) {
      if (e instanceof RunFinalizationError) {
        result = e.runnerResult;
        finalizationFailed = true;
      } else throw e;
    }
    await endpoint.dispose();
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
    stage('export');
    const runId =
      result.artifacts?.runId ??
      readdirSync(runsRoot, { withFileTypes: true }).find((d) =>
        d.isDirectory(),
      )?.name;
    if (runId)
      try {
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
      } catch {
        outcome.error = 'Artifact export failed; original verdict retained';
      }
  } catch {
    outcome = {
      verdict: signal.aborted ? 'interrupted' : 'unknown',
      infrastructure: 'permanent',
      error:
        'Preparation, launch or execution failed; inspect Worker diagnostics',
    };
  } finally {
    await daemon?.dispose();
    writeJournal(join(directory, 'result.json'), outcome);
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
