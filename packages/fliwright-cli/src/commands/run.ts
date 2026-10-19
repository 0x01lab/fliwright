import {
  ensureFliwrightRunsRoot,
  resolveFliwrightProjectRoot,
  FLIWRIGHT_RUNS_ROOT_ENV,
  TIMELINE_FILE_NAME,
  parseTimelineData,
  summarizeTimeline,
  RunArtifactStore,
  projectRunTrace,
  recoverRunProgress,
  restoreRunAttempts,
  mergeFliwrightConfig,
} from '@fliwright/core';
import type { EvidenceStatus, RunError, RunManifest, RunStatus, RunSessionResult, RecoveredRunProgress, ResolvedFliwrightConfig } from '@fliwright/core';
import type { ScenarioExecutionMode, TestScenario } from '@fliwright/core';
import { resolveVmUrl } from '../vm-discovery.js';
import { resolveProjectConfig } from '../config.js';
import { artifactReferences } from '../ArtifactReferences.js';
import { formatPretty, formatJson, formatJunit, type CliFailureEntry, type CliRunResult } from '../reporter.js';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { createJiti } from 'jiti';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve, isAbsolute } from 'node:path';

export interface RunOptions {
  testPattern?: string;
  testName?: string;
  vmUrl?: string;
  reporter?: 'pretty' | 'json' | 'junit';
  timeout?: number;
  screenshot?: 'file' | 'base64' | 'off';
  recordingMode?: 'standard' | 'full' | 'off';
  output?: string;
  junitOutput?: string;
  scenario?: string;
  /** Set by the CLI only when it owns a managed app launch. */
  scenarioMode?: ScenarioExecutionMode;
  cwd?: string;
  print?: boolean;
  runsRoot?: string;
  signal?: AbortSignal;
  /** Inherit only when an external supervisor owns and terminates the whole process group. */
  processGroup?: 'isolated' | 'inherit';
  /** Strict unchanged-candidate verification: assertions must not heal targets. */
  recordingReplay?: boolean;
}

export interface RunDeps {
  resolveVmUrl?: (options: { cliFlag?: string; configUrl?: string; cwd?: string; verify?: boolean }) => Promise<string | null>;
  onVmResolved?: (url: string) => void;
}

/** Artifact persistence failed after the runner produced its business outcome. */
export class RunFinalizationError extends Error {
  readonly runId: string;
  readonly outputDir: string;
  readonly runnerResult: CliRunResult;

  constructor(result: CliRunResult, options: { runId: string; outputDir: string }, cause: unknown) {
    const failures = [
      ...result.results.flatMap((test) => test.error ? [test.error] : []),
      ...(result.runnerErrors ?? []).map((error) => error.message),
    ];
    super(`Run artifacts could not be finalized: ${cause instanceof Error ? cause.message : String(cause)}` +
      (failures.length ? `\nOriginal runner errors:\n${failures.join('\n')}` : ''), { cause });
    this.name = 'RunFinalizationError';
    this.runId = options.runId;
    this.outputDir = options.outputDir;
    this.runnerResult = result;
  }
}

export async function runCommand(options: RunOptions, deps: RunDeps = {}): Promise<CliRunResult> {
  const cwd = resolveFliwrightProjectRoot(options.cwd);
  const config = await resolveProjectConfig(cwd, {
    ...(options.recordingMode ? { recording: { mode: options.recordingMode } } : {}), runsRoot: options.runsRoot, defaultScenario: options.scenario, scenarioMode: options.scenarioMode,
  });
  const shared = mergeFliwrightConfig({ project: config });

  const reporter = options.reporter ?? config.reporter;
  const testPattern = options.testPattern ?? `${shared.paths.tests}/**/*.test.ts`;
  const timeout = options.timeout ?? config.timeout ?? 30000;
  const screenshot = options.screenshot ?? config.screenshot;
  const recordingMode = shared.recording.mode;
  const runId = createRunId();

  const resolver = deps.resolveVmUrl ?? resolveVmUrl;
  const vmUrl = await resolver({
    cliFlag: options.vmUrl,
    configUrl: config.vmServiceUrl,
    cwd,
    verify: true,
  });

  if (!vmUrl) {
    throw new Error(
      'Could not find a running Flutter VM Service.\n\n' +
      '   Start your Flutter app first: flutter run\n' +
      '   Then re-run: fliwright run\n' +
      '   Or specify: fliwright run --vm-url ws://127.0.0.1:8181/ws',
    );
  }

  deps.onVmResolved?.(vmUrl);

  const runsRoot = await ensureFliwrightRunsRoot({
    projectRoot: cwd,
    runsRoot: shared.runsRoot,
  });
  const outputDir = join(runsRoot, runId);
  const reportPath = options.output ? resolve(cwd, options.output) : join(outputDir, 'report.json');

  const vitestResult = await runVitest({
    testPattern,
    testName: options.testName,
    vmUrl,
    cwd,
    timeout,
    screenshot,
    recordingMode,
    runId,
    runsRoot,
    sessionResultsPath: join(outputDir, 'sessions.jsonl'),
    signal: options.signal,
    recordingReplay: options.recordingReplay,
    scenarios: shared.scenarios,
    scenarioMode: shared.scenarioMode,
    sharedConfig: shared,
    processGroup: options.processGroup,
  });
  const withArtifacts = await finalizeRunArtifacts(vitestResult, {
    cwd,
    outputDir,
    reportPath,
    runId,
    runsRoot,
    screenshot,
    recordingMode,
    testPattern,
    testName: options.testName,
  });
  if (options.junitOutput) {
    const path = resolve(cwd, options.junitOutput);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, formatJunit(withArtifacts), 'utf8');
  }
  const formatted = formatOutput(withArtifacts, reporter);

  if (options.print !== false) {
    console.log(formatted);
  }
  return withArtifacts;
}

interface RunVitestOptions {
  processGroup?: 'isolated' | 'inherit';
  recordingReplay?: boolean;
  sharedConfig?: ResolvedFliwrightConfig;
  testPattern: string,
  testName?: string;
  vmUrl: string;
  cwd: string;
  timeout: number;
  screenshot: 'file' | 'base64' | 'off';
  recordingMode?: 'standard' | 'full' | 'off';
  runId?: string;
  runsRoot?: string;
  sessionResultsPath?: string;
  signal?: AbortSignal;
  scenarios?: Record<string, TestScenario>;
  scenarioMode?: ScenarioExecutionMode;
}

export async function runVitest(options: RunVitestOptions): Promise<CliRunResult> {
  // An editor can bundle this module outside the project's dependency tree.
  // Prefer the project's runner and Vitest together; standalone CLI invocations
  // without local packages can still use the CLI installation's dependencies.
  const projectResolver = createJiti(join(options.cwd, 'package.json'));
  const resolveRuntime = (specifier: string) => projectResolver.esmResolve(specifier, { try: true })
    ?? import.meta.resolve(specifier);
  const runnerPath = fileURLToPath(resolveRuntime('@fliwright/vitest/runner'));
  const vitestUrl = resolveRuntime('vitest/node');
  // Use the public Node API and explicit file reports in an isolated child,
  // preserving project configuration and custom runners.
  const isGlob = ['*', '?', '{', '['].some((token) => options.testPattern.includes(token));
  const isFile = !isGlob && await stat(resolve(options.cwd, options.testPattern)).then((entry) => entry.isFile(), () => false);
  const filters = isGlob ? [] : [options.testPattern];
  const reportDirectory = await mkdtemp(join(tmpdir(), 'fliwright-vitest-report-'));
  const rawReportPath = join(reportDirectory, 'report.json');
  const bootstrap = `
    const { readFile, writeFile } = await import('node:fs/promises');
    const { startVitest, JsonReporter } = await import(${JSON.stringify(vitestUrl)});
    class RunReporter extends JsonReporter {
      runnerErrors = [];
      recoveryAttempts = [];
      collectionFailures = new Set();
      onTestModuleCollected(module) {
        if (module.errors().length) this.collectionFailures.add(module.moduleId);
      }
      async onTestRunEnd(modules, unhandledErrors = []) {
        const normalize = (error, phase, file) => ({ phase, message: error.message ?? String(error),
          ...(error.stack ? { stack: error.stack } : {}), ...(file ? { file } : {}) });
        this.runnerErrors = unhandledErrors.map(error => normalize(error, 'unhandled'));
        for (const module of modules) {
          for (const test of module.children.allTests()) this.recoveryAttempts.push(...(test.meta().fliwrightRecovery ?? []));
          const phase = this.collectionFailures.has(module.moduleId) ? 'collection' : 'suite';
          for (const error of module.errors()) this.runnerErrors.push(normalize(error, phase, module.relativeModuleId));
          for (const suite of module.children.allSuites()) {
            for (const error of suite.errors()) this.runnerErrors.push(normalize(error, 'suite', module.relativeModuleId));
          }
        }
        await super.onTestRunEnd(modules);
        const report = JSON.parse(await readFile(${JSON.stringify(rawReportPath)}, 'utf8'));
        await writeFile(${JSON.stringify(rawReportPath)}, JSON.stringify({ ...report,
          runnerErrors: this.runnerErrors, recoveryAttempts: this.recoveryAttempts }));
      }
    }

    const context = await startVitest('test', ${JSON.stringify(filters)}, {
      ${isGlob || isFile ? `include: ${JSON.stringify([options.testPattern])},` : ''}
      run: true, reporters: [new RunReporter({ outputFile: ${JSON.stringify(rawReportPath)} })], testTimeout: ${JSON.stringify(options.timeout)},
      ${options.testName ? `testNamePattern: ${JSON.stringify(options.testName)},` : ''}
    }, { plugins: [{ name: 'fliwright-runner', config(config) {
      return { test: { runner: config.test?.runner ?? ${JSON.stringify(runnerPath)} } };
    } }] });
    await context?.close();
  `;
  const args = ['--input-type=module', '--eval', bootstrap];

  const { stdout, stderr, interrupted, exitCode, exitSignal } = await execNode(
    args,
    {
      ...process.env,
      FLIWRIGHT_PROJECT_ROOT: options.cwd,
      ...(options.sharedConfig ? { FLIWRIGHT_CONFIG: JSON.stringify(options.sharedConfig) } : {}),
      FLIWRIGHT_VM_URL: options.vmUrl,
      FLIWRIGHT_SCREENSHOT_MODE: options.screenshot,
      FLIWRIGHT_RECORDING_MODE: options.recordingMode ?? 'standard',
      FLIWRIGHT_FAILURE_TIMEOUT_MS: String(options.timeout),
      FLIWRIGHT_SCENARIOS: JSON.stringify(options.scenarios ?? {}),
      FLIWRIGHT_SCENARIO_MODE: options.scenarioMode ?? 'attach',
      FLIWRIGHT_RECORDING_REPLAY: options.recordingReplay ? '1' : '',
      ...(options.runId ? { FLIWRIGHT_RUN_ID: options.runId } : {}),
      ...(options.runsRoot ? { [FLIWRIGHT_RUNS_ROOT_ENV]: options.runsRoot } : {}),
      ...(options.sessionResultsPath ? { FLIWRIGHT_SESSION_RESULTS_PATH: options.sessionResultsPath } : {}),
    },
    options.cwd,
    options.signal,
    options.processGroup,
  );

  const reportJson = await readFile(rawReportPath, 'utf8').catch(() => '');
  await rm(reportDirectory, { recursive: true, force: true });
  const result = parseVitestOutput(reportJson);
  if (interrupted) {
    result.runnerErrors = [...(result.runnerErrors ?? []), {
      phase: 'process',
      message: 'Vitest run interrupted by cancellation.',
    }];
  }
  if (interrupted || exitCode !== 0 || exitSignal || result.runnerErrors?.length) result.passed = false;
  const expectedTestFailureExit = exitCode === 1 && result.failedTests > 0;
  if (!interrupted && (exitSignal || (exitCode !== 0 && !expectedTestFailureExit)) && !result.runnerErrors?.some((error) => error.phase === 'process')) {
    result.runnerErrors = [...(result.runnerErrors ?? []), { phase: 'process',
      message: stderr.trim() || `Vitest did not finish successfully (exit ${exitCode ?? exitSignal ?? 'unknown'}).`,
    }];
  }
  if (!interrupted && !result.passed && !result.runnerErrors?.length && result.failedTests === 0) {
    result.runnerErrors = [{ phase: 'process',
      message: stderr.trim() || `Vitest did not finish successfully (exit ${exitCode ?? exitSignal ?? 'unknown'}).`,
    }];
  }
  result.status = interrupted ? 'interrupted' : result.passed ? 'passed' : 'failed';
  if (options.runId && options.runsRoot) {
    try {
      await restoreRunAttempts(readVitestReport(reportJson)?.recoveryAttempts ?? [], options.runId, options.runsRoot);
    } catch (cause) {
      throw new RunFinalizationError(result, {
        runId: options.runId, outputDir: join(options.runsRoot, options.runId),
      }, cause);
    }
  }
  return result;
}

function execNode(
  args: string[],
  env: NodeJS.ProcessEnv,
  cwd: string,
  signal?: AbortSignal,
  processGroup: 'isolated' | 'inherit' = 'isolated',
): Promise<{ stdout: string; stderr: string; interrupted: boolean; exitCode: number | null; exitSignal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    const ownsProcessGroup = process.platform !== 'win32' && processGroup === 'isolated';
    const child = spawn(process.execPath, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: ownsProcessGroup });
    let stdout = '';
    let stderr = '';
    let interrupted = false;
    let killTimer: NodeJS.Timeout | undefined;
    const signalRun = (terminationSignal: NodeJS.Signals) => {
      if (ownsProcessGroup && child.pid) {
        try { process.kill(-child.pid, terminationSignal); } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH') child.kill(terminationSignal);
        }
      } else child.kill(terminationSignal);
    };
    const onSigint = () => {
      if (interrupted) return;
      interrupted = true;
      signalRun('SIGINT');
      killTimer = setTimeout(() => signalRun('SIGKILL'), 5000);
    };
    const onAbort = () => onSigint();
    process.once('SIGINT', onSigint);
    process.once('SIGTERM', onSigint);
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    const cleanup = () => {
      process.removeListener('SIGINT', onSigint);
      process.removeListener('SIGTERM', onSigint);
      signal?.removeEventListener('abort', onAbort);
      if (killTimer) clearTimeout(killTimer);
    };
    child.on('error', (error) => { cleanup(); reject(error); });
    child.on('close', (exitCode, exitSignal) => {
      // The runner can exit before its fork workers or owned subprocesses.
      // Complete cancellation before returning the recovered run to callers.
      if (interrupted && ownsProcessGroup) signalRun('SIGKILL');
      cleanup();
      resolve({ stdout, stderr, interrupted, exitCode, exitSignal });
    });
  });
}

interface VitestJsonReport {
  recoveryAttempts?: Array<{ result: RunSessionResult; timeline?: unknown }>;
  success?: boolean;
  numTotalTests?: number;
  numPassedTests?: number;
  numFailedTests?: number;
  startTime?: number;
  runnerErrors?: CliRunResult['runnerErrors'];
  testResults?: Array<{
    assertionResults?: Array<{
      fullName?: string;
      title?: string;
      status?: string;
      duration?: number | null;
      failureMessages?: string[];
    }>;
  }>;
}

function readVitestReport(raw: string): VitestJsonReport | undefined {
  const trimmed = raw.trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    return undefined;
  }

  try {
    return JSON.parse(trimmed.slice(start, end + 1)) as VitestJsonReport;
  } catch {
    return undefined;
  }
}

export function parseVitestOutput(raw: string): CliRunResult {
  const report = readVitestReport(raw);
  if (!report) return { passed: false, totalTests: 0, passedTests: 0, failedTests: 0, duration: 0, results: [] };

  const results = (report.testResults ?? []).flatMap((fileResult) =>
    (fileResult.assertionResults ?? []).map((assertion) => {
      const passed = assertion.status === 'passed';
      return {
        name: assertion.fullName ?? assertion.title ?? '<unknown>',
        passed,
        duration: assertion.duration ?? 0,
        ...(passed ? {} : { error: (assertion.failureMessages ?? []).join('\n') }),
      };
    }),
  );

  const duration = report.startTime ? Math.max(0, Date.now() - report.startTime) : 0;

  return {
    passed: report.success === true && !report.runnerErrors?.length,
    totalTests: report.numTotalTests ?? results.length,
    passedTests: report.numPassedTests ?? results.filter((r) => r.passed).length,
    failedTests: report.numFailedTests ?? results.filter((r) => !r.passed).length,
    duration,
    results,
    ...(report.runnerErrors?.length ? { runnerErrors: report.runnerErrors } : {}),
  };
}

async function readFailureContexts(manifestPath: string, screenshotMode: RunOptions['screenshot']): Promise<CliFailureEntry[]> {
  const runDir = dirname(manifestPath);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as RunManifest;
  const failures: CliFailureEntry[] = [];
  for (const test of manifest.tests) {
    const latest = test.attempts.at(-1);
    if (!latest) continue;
    const attemptDir = dirname(join(runDir, latest.resultPath));
    const result = JSON.parse(await readFile(join(runDir, latest.resultPath), 'utf8')) as RunSessionResult;
    if (result.testOutcome !== 'failed' || !result.failureContextPath) continue;
    const entries = JSON.parse(await readFile(join(attemptDir, result.failureContextPath), 'utf8')) as CliFailureEntry[];
    for (const entry of entries) {
      const screenshotPath = entry.screenshot?.path;
      if (screenshotPath && !isAbsolute(screenshotPath)) {
        const path = join(attemptDir, screenshotPath);
        entry.screenshot = screenshotMode === 'base64'
          ? { mimeType: 'image/png', base64: (await readFile(path)).toString('base64') }
          : { mimeType: 'image/png', path };
      }
      failures.push(entry);
    }
  }
  return failures;
}

/** Finalize an externally executed runner using the canonical CLI artifact pipeline. */
export async function finalizeRunArtifacts(
  result: CliRunResult,
  options: {
    cwd: string;
    outputDir: string;
    reportPath: string;
    runId: string;
    runsRoot: string;
    screenshot: 'file' | 'base64' | 'off';
    testPattern: string;
    recordingMode?: 'standard' | 'full' | 'off';
    testName?: string;
  },
): Promise<CliRunResult> {
  try {
    return await persistRunArtifacts(result, options);
  } catch (cause) {
    throw new RunFinalizationError(result, options, cause);
  }
}

async function persistRunArtifacts(
  result: CliRunResult,
  options: Parameters<typeof finalizeRunArtifacts>[1],
): Promise<CliRunResult> {
  await mkdir(options.outputDir, { recursive: true });
  const manifestPath = await writeRunManifest({
    runsRoot: options.runsRoot,
    runId: options.runId,
    runDir: options.outputDir,
    runStatus: result.status,
    runnerErrors: result.runnerErrors,
  });
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as RunManifest;
  if (manifest.status === 'interrupted' && result.status !== 'interrupted') {
    result = { ...result, status: 'interrupted', passed: false };
  }
  const screenshots: string[] = [];
  const projectedFailures = await readFailureContexts(manifestPath, options.screenshot);
  const failures = await persistScreenshots(projectedFailures, options.outputDir, options.screenshot, screenshots);
  const { timelines, agentVisibleFailures } = await readTimelineSummaries(options.runsRoot, options.runId);
  const report: CliRunResult = {
    ...result,
    ...(failures.length > 0 ? { failures } : {}),
    artifacts: {
      runId: options.runId,
      outputDir: options.outputDir,
      reportPath: join(options.outputDir, 'report.json'),
      manifestPath,
      screenshots,
      timelines: timelines.map((timeline) => timeline.path),
    },
    ...(timelines.length ? { timelines, agentVisibleFailures } : {}),
    reproduceCommand: buildReproduceCommand(options.testPattern, options.testName),
  };
  await mkdir(dirname(options.reportPath), { recursive: true });
  const canonicalReportPath = join(options.outputDir, 'report.json');
  await mkdir(dirname(canonicalReportPath), { recursive: true });
  const serialized = JSON.stringify(report, null, 2);
  await writeFile(canonicalReportPath, serialized, 'utf8');
  if (resolve(options.reportPath) !== resolve(canonicalReportPath)) {
    await writeFile(options.reportPath, serialized, 'utf8');
  }
  return report;
}

/**
 * Merge worker-written attempt results into the one authoritative run index.
 * Workers only create files below tests/<testId>/attempts/<attemptId>; the
 * parent process is the sole writer of run.json after Vitest exits.
 */
export async function writeRunManifest(options: {
  runsRoot: string;
  runId: string;
  runDir: string;
  runStatus?: CliRunResult['status'];
  runnerErrors?: RunError[];
}): Promise<string> {
  const testsRoot = join(options.runDir, 'tests');
  // Repair any attempt that was left running or unreadable. This is safe on a
  // normal run and also covers a worker crash whose parent exits cleanly.
  await repairInterruptedAttempts(testsRoot, options.runId, options.runnerErrors);
  const tests = new Map<string, {
    attemptId: string;
    resultPath: string;
    status?: string;
    evidenceStatus?: EvidenceStatus;
  }[]>();
  let testEntries: import('node:fs').Dirent[] = [];
  try {
    testEntries = await readdir(testsRoot, { withFileTypes: true });
  } catch {
    testEntries = [];
  }

  for (const testEntry of testEntries) {
    if (!testEntry.isDirectory()) continue;
    const testDir = join(testsRoot, testEntry.name);
    let attemptEntries: import('node:fs').Dirent[] = [];
    try {
      attemptEntries = await readdir(join(testDir, 'attempts'), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const attemptEntry of attemptEntries) {
      if (!attemptEntry.isDirectory()) continue;
      const resultAbsolute = join(testDir, 'attempts', attemptEntry.name, 'result.json');
      let result: {
        testId?: unknown;
        attemptId?: unknown;
        status?: unknown;
        testOutcome?: unknown;
        evidenceStatus?: unknown;
      } = {};
      try {
        result = JSON.parse(await readFile(resultAbsolute, 'utf8')) as typeof result;
      } catch {
        // Keep the reference: artifact export will report it as missing or
        // unreadable instead of claiming a complete run.
      }
      const testId = typeof result.testId === 'string' && result.testId.length > 0
        ? result.testId
        : testEntry.name;
      const attemptId = typeof result.attemptId === 'string' && result.attemptId.length > 0
        ? result.attemptId
        : attemptEntry.name;
      const list = tests.get(testId) ?? [];
      list.push({
        attemptId,
        resultPath: relative(options.runDir, resultAbsolute).split('\\').join('/'),
        ...(typeof result.testOutcome === 'string' ? { status: result.testOutcome } : {}),
        ...(result.evidenceStatus === 'complete' || result.evidenceStatus === 'partial' || result.evidenceStatus === 'disabled'
          ? { evidenceStatus: result.evidenceStatus }
          : {}),
      });
      tests.set(testId, list);
    }
  }

  const attempts = [...tests.values()].flat();
  const status: RunStatus = options.runStatus === 'interrupted' || attempts.some((attempt) => attempt.status === 'interrupted')
    ? 'interrupted'
    : attempts.some((attempt) => attempt.status === 'failed') || options.runStatus === 'failed' || Boolean(options.runnerErrors?.length)
      ? 'failed'
      : attempts.length > 0 && attempts.every((attempt) => attempt.status === 'skipped')
        ? 'skipped'
        : 'passed';
  const evidenceStatus: EvidenceStatus = attempts.some((attempt) => attempt.evidenceStatus === 'partial')
    ? 'partial'
    : attempts.length > 0 && attempts.every((attempt) => attempt.evidenceStatus === 'disabled')
      ? 'disabled'
      : 'complete';
  const manifest: RunManifest = {
    schemaVersion: 1,
    runId: options.runId,
    status,
    evidenceStatus,
    ...(options.runnerErrors?.length ? { runnerErrors: options.runnerErrors } : {}),
    tests: [...tests.entries()].map(([testId, attemptList]) => ({
      testId,
      attempts: attemptList
        .sort((a, b) => a.attemptId.localeCompare(b.attemptId, undefined, { numeric: true }))
        .map(({ attemptId, resultPath }) => ({ attemptId, resultPath })),
    })),
  };
  const store = new RunArtifactStore({ runsRoot: options.runsRoot, runId: options.runId });
  return store.writeManifest(manifest);
}

async function repairInterruptedAttempts(testsRoot: string, runId: string, runErrors: RunError[] = []): Promise<void> {
  const store = new RunArtifactStore({ runsRoot: dirname(dirname(testsRoot)), runId });
  let tests: import('node:fs').Dirent[];
  try { tests = await readdir(testsRoot, { withFileTypes: true }); } catch { return; }
  for (const testEntry of tests) {
    if (!testEntry.isDirectory()) continue;
    const attemptsDir = join(testsRoot, testEntry.name, 'attempts');
    let attempts: import('node:fs').Dirent[];
    try { attempts = await readdir(attemptsDir, { withFileTypes: true }); } catch { continue; }
    for (const attemptEntry of attempts) {
      if (!attemptEntry.isDirectory()) continue;
      const resultPath = join(attemptsDir, attemptEntry.name, 'result.json');
      let current: Record<string, unknown> | undefined;
      try {
        const parsed: unknown = JSON.parse(await readFile(resultPath, 'utf8'));
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) current = parsed as Record<string, unknown>;
      } catch { /* incomplete attempt */ }
      let recovered: RecoveredRunProgress | undefined;
      try {
        const log = await store.readEvents(join(attemptsDir, attemptEntry.name, 'events.jsonl'));
        // Filesystem directory names may encode characters in the original
        // task id. Recover that id only from a journal identity mapping to this exact
        // canonical directory, then enforce it for every subsequent event.
        const candidate = log.events.find((value): value is { testId: string; attemptId: string; runId: string } =>
          typeof value === 'object' && value !== null && 'testId' in value && typeof value.testId === 'string'
          && 'attemptId' in value && value.attemptId === attemptEntry.name && 'runId' in value && value.runId === runId
          && store.attemptDir(value.testId, value.attemptId) === join(attemptsDir, attemptEntry.name));
        recovered = recoverRunProgress(log, { runId,
          testId: typeof current?.testId === 'string' ? current.testId : candidate?.testId ?? testEntry.name,
          attemptId: attemptEntry.name });
      } catch (error) {
        if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')) {
          recovered = { issues: ['Progress journal could not be read.'], finalized: false };
        }
      }
      const snapshotFinalized = current?.finalized === true;
      if (recovered?.result && !snapshotFinalized) {
        current = { ...current, ...recovered.result,
          operations: mergeFacts(current?.operations, recovered.result.operations, 'operationId'),
        };
      }
      const terminalStatuses = new Set(['passed', 'failed', 'skipped', 'interrupted']);
      const completed = current
        && terminalStatuses.has(String(current.status))
        && terminalStatuses.has(String(current.attemptOutcome))
        && terminalStatuses.has(String(current.testOutcome)) && (!recovered || recovered.finalized || snapshotFinalized);
      if (completed && !recovered) continue;
      const interruptedAt = new Date().toISOString();
      const runnerErrors = Array.isArray(current?.runnerErrors) ? [...current.runnerErrors] : [];
      if (!completed || current?.testOutcome === 'interrupted') {
        for (const { phase, message, stack } of runErrors) {
          if (phase !== 'process' && phase !== 'unhandled') continue;
          if (!runnerErrors.some((error) => error?.phase === phase && error?.message === message)) {
            runnerErrors.push({ phase, message, ...(stack ? { stack } : {}) });
          }
        }
      }
      const result = {
        ...(current ?? {}),
        runId: typeof current?.runId === 'string' ? current.runId : runId,
        testId: typeof current?.testId === 'string' ? current.testId : testEntry.name,
        testName: typeof current?.testName === 'string' ? current.testName : testEntry.name,
        attemptId: typeof current?.attemptId === 'string' ? current.attemptId : attemptEntry.name,
        status: completed ? current!.status : 'interrupted',
        attemptOutcome: completed ? current!.attemptOutcome : 'interrupted',
        testOutcome: completed ? current!.testOutcome : 'interrupted',
        expectedFailure: current?.expectedFailure === true,
        flaky: current?.flaky === true,
        ...(runnerErrors.length ? { runnerErrors } : {}),
        evidenceStatus: !completed || recovered?.issues.length ? 'partial' : current!.evidenceStatus,
        evidenceIssues: [...new Set([...(Array.isArray(current?.evidenceIssues) ? current.evidenceIssues : []),
          ...(recovered?.issues ?? []),
          ...(!completed ? ['Attempt interrupted before finalization; only flushed evidence is available.'] : [])])],
        operations: Array.isArray(current?.operations) ? current.operations.map((operation: unknown) => {
          if (!operation || typeof operation !== 'object' || !('outcome' in operation) || operation.outcome !== 'running') return operation;
          return { ...operation, outcome: 'interrupted', endedAt: interruptedAt };
        }) : [],
        evidence: Array.isArray(current?.evidence) ? current.evidence : [],
      };
      const temporary = `${resultPath}.${process.pid}.interrupted.tmp`;
      await writeFile(temporary, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
      await rename(temporary, resultPath);
      const timelinePath = join(attemptsDir, attemptEntry.name, TIMELINE_FILE_NAME);
      const snapshot = parseTimelineData(await readFile(timelinePath, 'utf8').catch(() => ''));
      const timeline = snapshotFinalized && snapshot ? snapshot : recovered?.timeline ? { ...recovered.timeline,
        nodes: mergeFacts(snapshot?.nodes, recovered.timeline.nodes, 'id') as typeof recovered.timeline.nodes,
      } : snapshot;
      if (timeline) {
        if (!completed) {
          timeline.status = 'interrupted';
          timeline.endedAt = interruptedAt;
        }
        for (const node of timeline.nodes) if (!completed && node.status === 'running') {
          node.status = 'interrupted';
          node.endedAt = interruptedAt;
        }
        const timelineTemp = `${timelinePath}.${process.pid}.interrupted.tmp`;
        await writeFile(timelineTemp, `${JSON.stringify(timeline, null, 2)}\n`, 'utf8');
        await rename(timelineTemp, timelinePath);
        const traceDir = join(attemptsDir, attemptEntry.name, 'trace');
        await mkdir(traceDir, { recursive: true });
        const tracePath = join(traceDir, 'trace.json');
        const traceTemp = `${tracePath}.${process.pid}.interrupted.tmp`;
        await writeFile(traceTemp, JSON.stringify(projectRunTrace(result as RunSessionResult, timeline)), 'utf8');
        await rename(traceTemp, tracePath);
      }
    }
  }
}

function mergeFacts(snapshot: unknown, journal: unknown[], key: string): unknown[] {
  const facts = new Map<unknown, unknown>();
  for (const value of [...(Array.isArray(snapshot) ? snapshot : []), ...journal]) {
    if (typeof value === 'object' && value !== null && key in value) facts.set((value as Record<string, unknown>)[key], value);
  }
  return [...facts.values()];
}

async function readTimelineSummaries(
  runsRoot: string,
  runId: string,
): Promise<{
  timelines: NonNullable<CliRunResult['timelines']>;
  agentVisibleFailures: NonNullable<CliRunResult['agentVisibleFailures']>;
}> {
  const entries = await findTimelineFiles(runsRoot, runId);
  const summaries: NonNullable<CliRunResult['timelines']> = [];
  const agentVisibleFailures: NonNullable<CliRunResult['agentVisibleFailures']> = [];
  for (const path of entries) {
    const timeline = parseTimelineData(await readFile(path, 'utf8').catch(() => ''));
    if (!timeline) continue;
    // Failure app-state paths belong to the attempt, while the report belongs
    // to the run. Resolve their base before projecting them into the report.
    for (const ref of artifactReferences({ agentVisibleFailures: timeline.agentVisibleFailures }, 'report')) {
      ref.set(resolve(dirname(path), ref.path));
    }
    const summary = summarizeTimeline(timeline);
    summaries.push({ path, ...summary });
    agentVisibleFailures.push(...(timeline.agentVisibleFailures ?? []));
  }
  return { timelines: summaries, agentVisibleFailures };
}

async function findTimelineFiles(runsRoot: string, runId: string): Promise<string[]> {
  const runDir = join(runsRoot, runId);
  try {
    const manifest = JSON.parse(await readFile(join(runDir, 'run.json'), 'utf8')) as RunManifest;
    return manifest.tests.flatMap((test) => test.attempts.map((attempt) =>
      join(runDir, dirname(attempt.resultPath), TIMELINE_FILE_NAME)));
  } catch { return []; }
}

async function persistScreenshots(
  failures: CliFailureEntry[],
  outputDir: string,
  screenshotMode: 'file' | 'base64' | 'off',
  screenshots: string[],
): Promise<CliFailureEntry[]> {
  if (screenshotMode !== 'file') return failures;

  const screenshotDir = join(outputDir, 'screenshots');
  await mkdir(screenshotDir, { recursive: true });
  const persisted: CliFailureEntry[] = [];
  for (let index = 0; index < failures.length; index++) {
    const failure = failures[index];
    const existingPath = failure.screenshot?.path;
    if (existingPath) {
      screenshots.push(existingPath);
      persisted.push(failure);
      continue;
    }
    const base64 = failure.screenshot?.base64;
    if (!base64) {
      persisted.push(failure);
      continue;
    }
    const filename = `${index + 1}-${safeFilename(failure.testName)}.png`;
    const path = join(screenshotDir, filename);
    await writeFile(path, Buffer.from(base64, 'base64'));
    screenshots.push(path);
    persisted.push({
      ...failure,
      screenshot: {
        mimeType: 'image/png',
        path,
      },
    });
  }
  return persisted;
}

function createRunId(): string {
  return `run-${new Date().toISOString().replace(/[:.]/g, '-')}`;
}

function safeFilename(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'failure';
}

function buildReproduceCommand(testPattern: string, testName?: string): string {
  const parts = ['fliwright run', '--test', shellQuote(testPattern)];
  if (testName) parts.push('--test-name', shellQuote(testName));
  return parts.join(' ');
}

function shellQuote(value: string): string {
  if (/^[a-zA-Z0-9_./:@=-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function formatOutput(result: CliRunResult, reporter: string): string {
  switch (reporter) {
    case 'json':
      return formatJson(result);
    case 'junit':
      return formatJunit(result);
    case 'pretty':
    default:
      return formatPretty(result);
  }
}
