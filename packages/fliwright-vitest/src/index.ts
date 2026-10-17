import {
  afterAll,
  afterEach as vitestAfterEach,
  beforeAll,
  beforeEach as vitestBeforeEach,
  describe,
  expect as vitestExpect,
  test as vitestTest,
} from 'vitest';
import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import {
  AgentRuntime,
  AssertRuntime,
  AiRuntime,
  Assertion,
  FileLogSink,
  FliwrightDriver,
  FlowRuntime,
  JsonlLogSink,
  MockRuntime,
  PassiveAgent,
  Page as FliwrightPage,
  PrettyLogFormatter,
  readWorkspaceConfigSync,
  resolveFliwrightRunsRoot,
  StructuredLogger,
  TimelineArtifactStore,
  RunArtifactStore,
  EvidenceCapture,
  createExpect,
  resolveAiConfig,
  ScenarioCoordinator,
  ScenarioResolver,
  fingerprintScenario,
  DEFAULT_FLIWRIGHT_CONFIG,
  EndpointLeaseManager,
  mergeFliwrightConfig,
  readFliwrightEnvironment,
} from '@fliwright/core';
import type { AiRuntimeConfig, AgentPolicy, EvidenceRequest, EvidenceResult, FliwrightLogger, FliwrightLogLevel, FliwrightLogEvent, FliwrightPlugin, FliwrightRecordingConfig, Locator, LogSink, Page, RecordingMode, ScenarioExecutionMode, TestScenario, TimelineRunMode, TimelineRecorder, TimelineNode } from '@fliwright/core';
import type { TestAPI } from 'vitest';
import { requireAttemptContext } from './AttemptContext.js';
import { getTaskEndpointLease, setTaskEndpointLease, finishTaskEndpointLeasePhase } from './TaskEndpointLease.js';
import { withTaskPreparation } from './TestRegistration.js';
export { FliwrightRunner, createFliwrightRunner } from './runner.js';
export type { FliwrightRunnerOptions, FliwrightRunnerConstructor } from './runner.js';
export { fliwrightPreset } from './preset.js';
export { FliwrightRecoveryReporter } from './RecoveryReporter.js';
export type { FliwrightVitestPresetOptions } from './preset.js';

export type FliwrightLogFormat = 'pretty' | 'compact' | 'jsonl' | 'silent';
export type FliwrightLogOutput = 'stderr' | 'stdout' | 'file' | 'jsonl-file';

export interface FliwrightLogConfig {
  level?: FliwrightLogLevel;
  format?: FliwrightLogFormat;
  outputs?: FliwrightLogOutput[];
  filePath?: string;
  jsonlPath?: string;
}

export interface FliwrightConfig {
  vmServiceUrl: string;
  plugins?: FliwrightPlugin[];
  timeout?: number;
  screenshot?: 'file' | 'base64' | 'off';
  ai?: AiRuntimeConfig;
  mode?: TimelineRunMode;
  requireAssertions?: boolean;
  agentPolicy?: AgentPolicy;
  timelineDir?: string;
  runsRoot?: string;
  log?: FliwrightLogConfig;
  /** Named, composable environment declarations used by `test.scenario(name)`. */
  scenarios?: Record<string, TestScenario>;
  /** Attach to an already running app, or prepare a waiting test-only app before its first frame. */
  scenarioMode?: ScenarioExecutionMode;
  recording?: Partial<FliwrightRecordingConfig>;
}

export function defineConfig(overrides: Partial<FliwrightConfig> & { vmServiceUrl: string }): FliwrightConfig {
  return {
    timeout: 5000,
    screenshot: 'file',
    recording: { ...DEFAULT_FLIWRIGHT_CONFIG.recording, ...overrides.recording },
    ...overrides,
  };
}

/**
 * Decide where run artifacts go for a fliwright test run.
 * Precedence is implemented by @fliwright/core:
 * explicit config.runsRoot > FLIWRIGHT_RUNS_ROOT env > per-project home root.
 */
export function resolveRunsRoot(config: { runsRoot?: string; projectRoot?: string }): string {
  return resolveFliwrightRunsRoot({
    runsRoot: config.runsRoot,
    projectRoot: config.projectRoot,
  });
}

const sharedDrivers = new Map<string, Promise<FliwrightDriver>>();
const endpointLeases = new EndpointLeaseManager();
let nextPluginId = 1;
const pluginIds = new WeakMap<FliwrightPlugin, number>();

interface FliwrightTestContext {
  driver: FliwrightDriver;
  testName: string;
  timeline?: FliwrightTimelineContext;
}

const testContext = new AsyncLocalStorage<FliwrightTestContext>();
let currentTestContext: FliwrightTestContext | null = null;

type FliwrightHookContext = {
  page: Page;
};

type FliwrightHook = (context: FliwrightHookContext, suite: unknown) => unknown | Promise<unknown>;

interface FliwrightTimelineContext {
  recorder: TimelineRecorder;
  driver?: FliwrightDriver;
  artifactStore: TimelineArtifactStore;
  runId: string;
  logger: FliwrightLogger;
  timelinePath?: string;
  runSession?: import('@fliwright/core').RunSession;
}

export interface FliwrightFixtures {
  driver: FliwrightDriver;
  page: Page;
  aiRuntime: AiRuntime;
  flow: FlowRuntime;
  mock: MockRuntime;
  agent: AgentRuntime;
  assert: AssertRuntime;
  timeline: FliwrightTimelineContext;
  logger: FliwrightLogger;
}

export type FliwrightTest = TestAPI<FliwrightFixtures>;

export type ScenarioTest<TFixtures extends FliwrightFixtures = FliwrightFixtures> = (
  name: string,
  handler: (fixtures: TFixtures) => unknown | Promise<unknown>,
  timeout?: number,
) => void;

export interface ScenarioEnabledFliwrightTest<TFixtures extends FliwrightFixtures = FliwrightFixtures> extends TestAPI<TFixtures> {
  scenario(name: string): ScenarioTest<TFixtures>;
}

const scenarioConfigs = new WeakMap<object, () => FliwrightConfig>();

export type FliwrightProjectFixtures = Record<
  string,
  (fixtures: FliwrightFixtures, use: (value: unknown) => Promise<void>) => Promise<void>
>;

export interface CreateFliwrightTestOptions {
  /** When set, fixtures use this driver instead of the worker's endpoint-specific cache. */
  driverProvider?: () => Promise<FliwrightDriver>;
}

export function createFliwrightTest(
  config: FliwrightConfig,
  options?: CreateFliwrightTestOptions,
): ScenarioEnabledFliwrightTest {
  // Persistent Vitest workers reuse fixture modules across reruns. Resolve
  // process settings at fixture use so a new run does not retain the old root.
  const resolveConfig = (): FliwrightConfig => ({ ...config,
    ...mergeFliwrightConfig({ environment: readFliwrightEnvironment(process.env), explicit: config }),
  });
  const resolveDriver = options?.driverProvider
    ? () => options.driverProvider!()
    : () => getSharedDriver(resolveConfig());
  const fliwrightTest = vitestTest.extend<FliwrightFixtures & { _fliwrightEndpointLease: undefined }>({
    _fliwrightEndpointLease: [async ({ task }, use) => {
      await requireAttemptContext(task).beforeFixtures?.();
      const endpoint = resolveConfig().vmServiceUrl.trim();
      if (endpoint && getTaskEndpointLease(task)) {
        // A retry retains ownership but starts a fresh fixture lifecycle.
        setTaskEndpointLease(task, getTaskEndpointLease(task)!);
      }
      try { await use(undefined); }
      finally {
        // Dynamic skip bypasses onAfterRunTask. Normal tasks retain ownership
        // through runner evidence/finalization and all retries.
        try {
          // Vitest 4.1 sets pending before unwinding an aroundEach skip;
          // that field is present at runtime but omitted from TaskResult.
          const pendingSkip = (task.result as { pending?: boolean } | undefined)?.pending === true;
          if ((task.result?.state === 'skip' || pendingSkip) && !requireAttemptContext(task).runnerEntered) {
            await requireAttemptContext(task).onSetupSkipped?.();
          }
        } finally { await finishTaskEndpointLeasePhase(task, 'cleanupComplete'); }
      }
    }, { auto: true }],
    timeline: async ({ task }, use) => {
      const config = resolveConfig();
      const testName = getTestName(task);
      const attempt = requireAttemptContext(task);
      const cwd = config.timelineDir ?? process.cwd();
      const runsRoot = resolveRunsRoot({ runsRoot: config.runsRoot, projectRoot: cwd });
      const store = new RunArtifactStore({ runsRoot, runId: attempt.runId });
      const logger = createRunLogger(config, {
        runId: attempt.runId, testName, mode: config.mode ?? 'test',
        runDir: store.attemptDir(task.id, attempt.attemptId),
      });
      await attempt.configure({ runsRoot, mode: config.mode ?? 'test', logger, recordingMode: config.recording?.mode,
        testFinalizationBudgetMs: config.recording?.testFinalizationBudgetMs });
      if (config.vmServiceUrl.trim()) {
        const lease = getTaskEndpointLease(task);
        attempt.session.configureEndpointLease(lease ? {
          run: (endpoint, execute) => lease.run(() => endpointLeases.run(endpoint, execute)),
        } : endpointLeases, config.vmServiceUrl);
      }
      const timeline: FliwrightTimelineContext = { recorder: attempt.recorder,
        artifactStore: attempt.artifactStore, runId: attempt.runId, logger, runSession: attempt.session };
      attempt.onFailure = async (error, node, signal) => {
        await writeFailureProjection(timeline, error, node, config, signal);
        if (!signal.aborted) attempt.failureContextPath = 'failures.json';
      };
      if (config.agentPolicy?.passive === true && (config.agentPolicy.onFailure ?? 'diagnose') === 'diagnose') {
        attempt.beforeFinish = (signal) => diagnoseTimelineFailures(timeline, config, resolveDriver, signal,
          () => Math.max(1, attempt.finalization.remainingMs - attempt.persistenceReserveMs));
      }
      const ctx = testContext.getStore();
      if (ctx) ctx.timeline = timeline;

      const assertionCallsBefore = vitestExpect.getState().assertionCalls ?? 0;
      attempt.validate = () => {
        const required = config.requireAssertions ?? config.recording?.requireAssertions
          ?? (config.mode !== 'script' && DEFAULT_FLIWRIGHT_CONFIG.recording.requireAssertions);
        if (required && !timeline.recorder.toJSON().nodes.some((node) => node.kind === 'assertion')
          && (vitestExpect.getState().assertionCalls ?? 0) <= assertionCallsBefore
          && task.context.expect.getState().assertionCalls === 0) {
          return new Error('Test mode requires at least one executed assertion, but none were recorded. Add an assertion or use script mode.');
        }
        return undefined;
      };
      logger.info(`${config.mode === 'script' ? 'Script' : 'Test'} started`);
      await use(timeline);
    },
    driver: async ({ task, timeline }, use) => {
      const driver = await resolveDriver();
      timeline.driver = driver;
      const testName = getTestName(task);
      const previous = currentTestContext;
      const ctx: FliwrightTestContext = { driver, testName, timeline };
      currentTestContext = ctx;
      let useFailed = false;
      try {
        await testContext.run(ctx, async () => {
          await use(driver);
        });
      } catch (error) {
        useFailed = true;
        throw error;
      } finally {
        currentTestContext = previous;
        if (options?.driverProvider) {
          const attempt = requireAttemptContext(task);
          try {
            // Calling dispose even after an earlier stage exhausts its budget
            // still initiates transport cleanup; only the wait is bounded.
            if (attempt.finalization.remainingMs <= attempt.persistenceReserveMs) {
              const controller = new AbortController();
              controller.abort(new Error('Driver cleanup exceeded the test finalization budget.'));
              void driver.dispose({ signal: controller.signal }).catch((error: unknown) => attempt.recordEvidenceIssue(error));
            }
            await attempt.finalization.run('Driver cleanup', (signal) => driver.dispose({ signal }), attempt.persistenceReserveMs);
          } catch (error) {
            attempt.recordEvidenceIssue(error);
            if (!useFailed && task.result?.state !== 'fail') throw error;
          }
        }
      }
    },
    page: async ({ task, timeline, driver }, use) => {
      const config = resolveConfig();
      timeline.driver = driver;
      const testName = getTestName(task);

      const ctx: FliwrightTestContext = { driver, testName, timeline };
      const previous = currentTestContext;
      currentTestContext = ctx;
      try {
        await testContext.run(ctx, async () => {
          const page = new FliwrightPage((method, params) => driver.sendRequest(method, params), {
            recorder: timeline.recorder, artifactStore: timeline.artifactStore, runSession: timeline.runSession,
          });
          configureRunSessionEvidence(timeline, page, config, () => requireAttemptContext(task).finalizationSignal);
          const recordingMode = config.recording?.mode ?? parseRecordingMode(process.env.FLIWRIGHT_RECORDING_MODE) ?? 'standard';
          if (recordingMode !== 'off') await captureTestLifecycleScreenshot(timeline, page, 'start');
          try {
            await use(page);
          } finally {
            if (recordingMode !== 'off' && (config.recording?.testFinalScreenshots ?? DEFAULT_FLIWRIGHT_CONFIG.recording.testFinalScreenshots)) {
              await requireAttemptContext(task).finalizeStep('Final screenshot', async (signal) => {
                if (!signal.aborted) await captureTestLifecycleScreenshot(timeline, page, 'finish', signal);
              });
            }
          }
        });
      } finally {
        currentTestContext = previous;
      }
    },
    aiRuntime: async ({ task, timeline, driver }, use) => {
      const config = resolveConfig();
      timeline.driver = driver;
      const testName = getTestName(task);
      const runtime = new AiRuntime(resolveAiConfig(config.ai), {
        page: driver.page,
        driver,
        testName,
        runId: timeline.runId,
        cwd: process.cwd(),
      });
      await use(runtime);
    },
    flow: async ({ page, timeline }, use) => {
      await use(new FlowRuntime({ recorder: timeline.recorder, artifactStore: timeline.artifactStore, page,
        runSession: timeline.runSession }));
    },
    mock: async ({ driver, timeline }, use) => {
      await use(new MockRuntime(driver.mock, timeline.recorder));
    },
    agent: async ({ aiRuntime, timeline }, use) => {
      await use(new AgentRuntime({ aiRuntime, recorder: timeline.recorder }));
    },
    assert: async ({ page, mock, timeline }, use) => {
      await use(new AssertRuntime({
        page,
        mock,
        recorder: timeline.recorder,
        artifactStore: timeline.artifactStore,
      }));
    },
    logger: async ({ timeline }, use) => {
      await use(timeline.logger);
    },
  });

  return withScenarioSupport(fliwrightTest as unknown as TestAPI<FliwrightFixtures>, resolveConfig);
}

function withScenarioSupport<TFixtures extends FliwrightFixtures>(
  test: TestAPI<TFixtures>, resolveConfig: () => FliwrightConfig,
): ScenarioEnabledFliwrightTest<TFixtures> {
  const prepare = async (task: import('vitest').RunnerTestCase, signal: AbortSignal): Promise<void> => {
    const config = resolveConfig();
    requireAttemptContext(task).configureRecordingPolicy({ recordingMode: config.recording?.mode,
      testFinalizationBudgetMs: config.recording?.testFinalizationBudgetMs });
    const endpoint = config.vmServiceUrl.trim();
    if (endpoint && !getTaskEndpointLease(task)) {
      const lease = await endpointLeases.acquire(endpoint, { signal: AbortSignal.any([signal, task.context.signal]) });
      if (signal.aborted) {
        await lease.release();
        signal.throwIfAborted();
      }
      setTaskEndpointLease(task, lease);
    }
  };
  const scenarioTest = withTaskPreparation(test, prepare) as ScenarioEnabledFliwrightTest<TFixtures>;
  scenarioConfigs.set(scenarioTest, resolveConfig);
  scenarioTest.scenario = (scenarioName: string): ScenarioTest<TFixtures> => {
    const config = resolveConfig();
    const scenarios = config.scenarios;
    if (!scenarios) {
      throw new Error(`Test scenario '${scenarioName}' was requested, but defineConfig({ scenarios }) is missing.`);
    }
    const scenario = new ScenarioResolver(scenarios).resolve(scenarioName);
    // The automatic fixture adds preparation without wrapping the handler, so
    // Vitest still discovers and lazily injects its project fixture dependencies.
    const prepared = scenarioTest.extend({
      _fliwrightScenario: [async ({ driver, timeline }, use) => {
        const scenarioNode = timeline.recorder.startNode('step', `Scenario: ${scenarioName}`);
        await timeline.recorder.flushProgress();
        await new ScenarioCoordinator(driver).apply(scenario, {
          mode: config.scenarioMode ?? 'attach',
        });
        timeline.recorder.passNode(scenarioNode.id, {
          scenarioName, scenarioFingerprint: fingerprintScenario(scenario),
        });
        await timeline.recorder.flushProgress();
        await use(undefined);
      }, { auto: true }],
    }) as unknown as TestAPI<TFixtures>;
    return (name, handler, timeout) => { prepared(name, handler, timeout); };
  };
  return scenarioTest;
}

export function extendFliwrightTest<
  TProjectFixtures extends Record<string, unknown>,
  TBaseFixtures extends FliwrightFixtures = FliwrightFixtures,
>(
  base: TestAPI<TBaseFixtures>,
  fixtures: {
    [K in keyof TProjectFixtures]: (
      fixtures: Omit<TProjectFixtures, K> & TBaseFixtures,
      use: (value: TProjectFixtures[K]) => Promise<void>,
    ) => Promise<void>;
  },
): ScenarioEnabledFliwrightTest<TBaseFixtures & TProjectFixtures> {
  const resolveConfig = scenarioConfigs.get(base);
  if (!resolveConfig) throw new Error('extendFliwrightTest requires a base from createFliwrightTest or extendFliwrightTest.');
  const extended = base.extend<TProjectFixtures>(fixtures as never) as unknown as TestAPI<TBaseFixtures & TProjectFixtures>;
  return withScenarioSupport(extended, resolveConfig);
}

function configureRunSessionEvidence(timeline: FliwrightTimelineContext, page: Page, config: FliwrightConfig,
  getFinalizationSignal: () => AbortSignal | undefined): void {
  const session = timeline.runSession;
  if (!session) return;
  const mode: RecordingMode = config.recording?.mode ?? parseRecordingMode(process.env.FLIWRIGHT_RECORDING_MODE) ?? 'standard';
  const budget = config.recording?.failureCaptureBudgetMs ?? DEFAULT_FLIWRIGHT_CONFIG.recording.failureCaptureBudgetMs;
  const capture = new EvidenceCapture({ totalBudgetMs: budget, channelTimeoutMs: budget / 3 });
  session.configureRecording({
    mode,
    captureEvidence: async (request: EvidenceRequest): Promise<EvidenceResult> => {
      if (mode === 'off' && request.reason !== 'explicit') return { status: 'disabled' };
      const signal = getFinalizationSignal();
      const suffix = `${request.operationId ?? 'checkpoint'}-${request.reason}`;
      const sources = {
        screenshot: async () => {
          const screenshot = await page.screenshot();
          signal?.throwIfAborted();
          return timeline.artifactStore.writeScreenshot(suffix, screenshot);
        },
        snapshot: async () => {
          const snapshot = await page.snapshot();
          signal?.throwIfAborted();
          return timeline.artifactStore.writeSnapshot(suffix, snapshot);
        },
        diagnostics: async () => {
          const frame = await page.captureFrame({ screenshot: false, snapshot: false, diagnostics: true });
          signal?.throwIfAborted();
          return timeline.artifactStore.writeDiagnostics(suffix, frame.diagnostics ?? frame);
        },
      };
      const result = await capture.capture(request.reason === 'failure' ? suffix : `${suffix}-${request.kind}`,
        request.reason === 'failure' ? sources : { [request.kind]: sources[request.kind] }, { signal });
      const channel = result.channels[request.kind];
      const artifact = channel.value as { path: string } | undefined;
      return { status: channel.status, ...(artifact ? { artifactPaths: [artifact.path] } : {}),
        ...(channel.error ? { error: channel.error } : {}) };
    },
  });
}

async function captureTestLifecycleScreenshot(
  timeline: FliwrightTimelineContext,
  page: Page,
  reason: 'start' | 'finish',
  signal?: AbortSignal,
): Promise<void> {
  const node = timeline.recorder.startNode('step', `Test ${reason} screenshot`, {
    metadata: { lifecycle: reason },
  });
  await timeline.recorder.flushProgress();
  if (signal?.aborted) return;
  const result = await timeline.runSession?.checkpoint({ kind: 'screenshot', reason })
    ?? { status: 'disabled' as const };
  if (signal?.aborted) return;
  const artifacts = result.artifactPaths?.map((path) => ({ kind: 'screenshot', path, mimeType: 'image/png' })) ?? [];
  if (artifacts.length) timeline.recorder.addArtifacts(node.id, artifacts);
  timeline.recorder.passNode(node.id, { evidenceStatus: result.status });
  await timeline.recorder.flushProgress();
}

export function createFliwrightScript(config: FliwrightConfig) {
  return createFliwrightTest({ ...config, mode: 'script', requireAssertions: false });
}

export const test = createFliwrightTest(testConfigFromEnv());

export const script = createFliwrightScript(testConfigFromEnv());

export function beforeEach(hook: FliwrightHook, timeout?: number): void {
  vitestBeforeEach<FliwrightHookContext>(hook, timeout);
}

export function afterEach(hook: FliwrightHook, timeout?: number): void {
  vitestAfterEach<FliwrightHookContext>(hook, timeout);
}

export { afterAll, beforeAll, describe };

export function expect(locator: Locator, title?: string): Assertion {
  const context = testContext.getStore() ?? currentTestContext;
  const locatorTimeline = locator.assertionTimeline;
  if (!context) return createExpect(locator, undefined, { ...locatorTimeline, title: title ?? locatorTimeline?.title });
  return new Assertion(
    locator,
    false,
    undefined,
    process.env.FLIWRIGHT_RECORDING_REPLAY === '1' ? undefined : context.driver.healing,
    context.testName,
    (method, params) => context.driver.sendRequest(method, params),
    locatorTimeline?.recorder
      ? { ...locatorTimeline, title: title ?? locatorTimeline.title }
      : context.timeline
      ? {
        title,
        recorder: context.timeline.recorder,
        artifactStore: context.timeline.artifactStore,
        page: context.driver.page,
        runSession: context.timeline.runSession,
      }
      : { title },
  );
}

/** Project the same saved evidence to the CLI/MCP report; never recapture it. */
async function writeFailureProjection(
  timeline: FliwrightTimelineContext, error: unknown, node: TimelineNode, config: FliwrightConfig, signal: AbortSignal,
): Promise<void> {
  const outputPath = join(timeline.artifactStore.runDir, 'failures.json');
  const readArtifact = async (kind: string): Promise<Buffer | undefined> => {
    const artifact = node.artifacts?.find((item) => item.kind === kind);
    return artifact ? readFile(join(timeline.artifactStore.runDir, artifact.path)).catch(() => undefined) : undefined;
  };
  const [snapshot, diagnostics] = await Promise.all([readArtifact('snapshot'), readArtifact('diagnostics')]);
  if (signal.aborted) return;
  const screenshot = node.artifacts?.find((artifact) => artifact.kind === 'screenshot');
  const original = error as { message?: string; stack?: string; stacks?: Array<{ file: string; line: number }> };
  const lines = original.stack?.split('\n') ?? [];
  const frame = lines.find((line) => line.includes('.test.') || line.includes('.script.')) ?? lines[1] ?? '';
  const parsed = frame.match(/\(?((?:file:\/\/\/|\/|[A-Za-z]:\\)[^\n()]+):(\d+):(\d+)\)?$/);
  const source = original.stacks?.[0] ?? (parsed ? { file: parsed[1], line: Number(parsed[2]) } : undefined);
  let healingSuggestion: Record<string, unknown> | undefined;
  try {
    const report = timeline.driver?.healing.getReports(timeline.recorder.testName).at(-1);
    if (report) healingSuggestion = { originalSelector: report.originalSelector, suggestedSelector: report.suggestedSelector,
      confidence: report.confidence, scores: report.scores };
  } catch { /* Keep the original failure when no healing report is available. */ }
  const entry = {
    testName: timeline.recorder.testName,
    ...(healingSuggestion ? { healingSuggestion } : {}),
    assertion: { matcher: 'unknown', expected: 'pass', actual: original.message ?? String(error), timeout: config.timeout ?? 5000 },
    widgetTree: snapshot ? JSON.parse(snapshot.toString()) : { error: 'Evidence unavailable' },
    ...(diagnostics ? { diagnostics: JSON.parse(diagnostics.toString()) } : {}),
    source: { file: source?.file ?? '<unknown>', line: source?.line ?? 0, snippet: original.message ?? String(error) },
    ...(screenshot && config.screenshot !== 'off' ? { screenshot: { mimeType: 'image/png', path: screenshot.path } } : {}),
    timestamp: node.startedAt,
  };
  await mkdir(dirname(outputPath), { recursive: true });
  const entries = await readFile(outputPath, 'utf8').then((text) => JSON.parse(text) as unknown[]).catch((): unknown[] => []);
  if (signal.aborted) return;
  entries.push(timeline.runSession?.redactReport(entry) ?? entry);
  await writeFile(outputPath, JSON.stringify(entries, null, 2), { signal });
}

async function getSharedDriver(config: FliwrightConfig): Promise<FliwrightDriver> {
  const vmServiceUrl = toWebSocketUrl(config.vmServiceUrl);
  if (!vmServiceUrl) {
    throw new Error(
      'No VM Service URL provided. Set FLIWRIGHT_VM_URL or FLIWRIGHT_VM_SERVICE_URL, or use createFliwrightTest({ vmServiceUrl }).',
    );
  }
  const key = sharedDriverCacheKey(vmServiceUrl, config.plugins);
  let pending = sharedDrivers.get(key);
  if (!pending) {
    pending = (async () => {
      const driver = new FliwrightDriver({ plugins: config.plugins });
      try {
        await driver.connect(vmServiceUrl);
        await listenToDiagnostics(driver);
        return driver;
      } catch (error) {
        await driver.dispose().catch(() => undefined);
        throw error;
      }
    })();
    sharedDrivers.set(key, pending);
  }
  try { return await pending; }
  catch (error) {
    if (sharedDrivers.get(key) === pending) sharedDrivers.delete(key);
    throw error;
  }
}

function sharedDriverCacheKey(vmServiceUrl: string, plugins: FliwrightPlugin[] | undefined): string {
  return JSON.stringify({
    vmServiceUrl,
    plugins: (plugins ?? []).map((plugin) => `${plugin.name}:${pluginIdentity(plugin)}`),
  });
}

function pluginIdentity(plugin: FliwrightPlugin): number {
  const existing = pluginIds.get(plugin);
  if (existing !== undefined) return existing;
  const id = nextPluginId++;
  pluginIds.set(plugin, id);
  return id;
}

async function listenToDiagnostics(driver: FliwrightDriver): Promise<void> {
  try {
    await driver.listenToDiagnostics();
  } catch {
    // Diagnostics are helpful for AI reports but should not prevent tests from running.
  }
}

function testConfigFromEnv(): FliwrightConfig {
  return {
    vmServiceUrl: toWebSocketUrl(
      process.env.FLIWRIGHT_VM_URL
      ?? process.env.FLIWRIGHT_VM_SERVICE_URL
      ?? readWorkspaceConfigSync().vmServiceUrl
      ?? '',
    ),
    timeout: parsePositiveInt(process.env.FLIWRIGHT_FAILURE_TIMEOUT_MS) ?? 5000,
    screenshot: parseScreenshotMode(process.env.FLIWRIGHT_SCREENSHOT_MODE),
    log: logConfigFromEnv(),
  };
}

function parseScreenshotMode(value: string | undefined): 'file' | 'base64' | 'off' {
  if (value === 'base64' || value === 'off') return value;
  return 'file';
}

function parseRecordingMode(value: string | undefined): RecordingMode | undefined {
  if (value === 'standard' || value === 'full' || value === 'off') return value;
  return undefined;
}

function parsePositiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function createRunLogger(
  config: FliwrightConfig,
  options: {
    runId: string;
    testName: string;
    mode: TimelineRunMode;
    runDir: string;
  },
): FliwrightLogger {
  const logConfig = mergeLogConfig(config.log, logConfigFromEnv());
  return new StructuredLogger({
    runId: options.runId,
    testName: options.testName,
    mode: options.mode,
    kind: options.mode === 'script' ? 'script' : 'test',
    level: logConfig.level ?? 'info',
    sinks: createLogSinks(logConfig, options.runDir),
  });
}

function createLogSinks(config: FliwrightLogConfig, runDir: string): LogSink[] {
  const format = config.format ?? 'pretty';
  if (format === 'silent') return [];

  const outputs = config.outputs ?? ['jsonl-file'];
  const sinks: LogSink[] = [];
  for (const output of outputs) {
    switch (output) {
      case 'stderr':
        sinks.push(new FileDescriptorLogSink(2, format));
        break;
      case 'stdout':
        sinks.push(new FileDescriptorLogSink(1, format));
        break;
      case 'file':
        sinks.push(new FileLogSink(resolveLogPath(config.filePath, runDir, 'logs/run.log'), new PrettyLogFormatter({ color: false })));
        break;
      case 'jsonl-file':
        sinks.push(new JsonlLogSink(resolveLogPath(config.jsonlPath, runDir, 'logs/events.jsonl')));
        break;
      default:
        break;
    }
  }
  return sinks;
}

class FileDescriptorLogSink implements LogSink {
  private readonly sink: LogSink;

  constructor(fd: 1 | 2, format: FliwrightLogFormat) {
    const stream = fd === 1 ? process.stdout : process.stderr;
    this.sink = new (class implements LogSink {
      write(event: FliwrightLogEvent): void {
        stream.write(`${formatEventForStream(event, format)}\n`);
      }
    })();
  }

  write(event: FliwrightLogEvent): void {
    void this.sink.write(event);
  }
}

function formatEventForStream(event: FliwrightLogEvent, format: FliwrightLogFormat): string {
  switch (format) {
    case 'jsonl':
      return JSON.stringify(event);
    case 'compact':
      return `${event.level.toUpperCase()} ${event.kind}: ${event.message}`;
    case 'pretty':
    default:
      return new PrettyLogFormatter({ color: true }).format(event);
  }
}

function resolveLogPath(path: string | undefined, runDir: string, fallback: string): string {
  const template = path ?? join(runDir, fallback);
  const expanded = template.replace('{runDir}', runDir);
  return resolve(process.cwd(), expanded);
}

function mergeLogConfig(primary?: FliwrightLogConfig, fallback?: FliwrightLogConfig): FliwrightLogConfig {
  return {
    ...fallback,
    ...primary,
    outputs: primary?.outputs ?? fallback?.outputs,
  };
}

function logConfigFromEnv(): FliwrightLogConfig | undefined {
  const level = parseLogLevel(process.env.FLIWRIGHT_LOG_LEVEL);
  const format = parseLogFormat(process.env.FLIWRIGHT_LOG_FORMAT);
  const outputs = parseLogOutputs(process.env.FLIWRIGHT_LOG_OUTPUT);
  const config: FliwrightLogConfig = {
    ...(level ? { level } : {}),
    ...(format ? { format } : {}),
    ...(outputs ? { outputs } : {}),
    ...(process.env.FLIWRIGHT_LOG_FILE ? { filePath: process.env.FLIWRIGHT_LOG_FILE } : {}),
    ...(process.env.FLIWRIGHT_LOG_JSONL ? { jsonlPath: process.env.FLIWRIGHT_LOG_JSONL } : {}),
  };
  return Object.keys(config).length ? config : undefined;
}

function parseLogLevel(value: string | undefined): FliwrightLogLevel | undefined {
  if (value === 'trace' || value === 'debug' || value === 'info' || value === 'warn' || value === 'error' || value === 'success') {
    return value;
  }
  return undefined;
}

function parseLogFormat(value: string | undefined): FliwrightLogFormat | undefined {
  if (value === 'pretty' || value === 'compact' || value === 'jsonl' || value === 'silent') return value;
  return undefined;
}

function parseLogOutputs(value: string | undefined): FliwrightLogOutput[] | undefined {
  if (!value) return undefined;
  const outputs = value.split(',').map((part) => part.trim()).filter(Boolean);
  const parsed = outputs.filter((output): output is FliwrightLogOutput =>
    output === 'stderr' || output === 'stdout' || output === 'file' || output === 'jsonl-file',
  );
  return parsed.length ? parsed : undefined;
}

function toWebSocketUrl(url: string): string {
  if (!url) return '';
  const converted = url
    .replace('http://', 'ws://')
    .replace('https://', 'wss://');
  return converted.endsWith('/ws') ? converted : converted.replace(/\/?$/, '/ws');
}

function getTestName(task: unknown): string {
  const candidate = task as { name?: unknown };
  if (typeof candidate.name === 'string') return candidate.name;
  return '<unknown>';
}

async function diagnoseTimelineFailures(
  timeline: FliwrightTimelineContext,
  config: FliwrightConfig,
  resolveDriver: () => Promise<FliwrightDriver>,
  signal: AbortSignal,
  remainingMs: () => number,
): Promise<void> {
  if (config.agentPolicy?.passive !== true || (config.agentPolicy.onFailure ?? 'diagnose') !== 'diagnose') return;

  const failures = timeline.recorder.toJSON().agentVisibleFailures ?? [];
  if (failures.length === 0) return;

  try {
    const driver = await resolveDriver();
    if (signal.aborted) return;
    const data = timeline.recorder.toJSON();

    for (const failure of failures) {
      if (signal.aborted) return;
      const aiRuntime = new AiRuntime({ ...resolveAiConfig(config.ai),
        timeoutMs: Math.min(config.ai?.timeoutMs ?? Infinity, remainingMs()),
      }, {
        page: driver.page, driver, testName: timeline.recorder.testName, runId: timeline.runId, cwd: process.cwd(),
      });
      const agent = new PassiveAgent({ aiRuntime, recorder: timeline.recorder, passive: true, signal });
      const currentNode = data.nodes.find((node) => node.id === failure.timelineNodeId);
      await agent.diagnose(failure, {
        currentNode,
        recentNodes: data.nodes.slice(-8),
        artifacts: currentNode?.artifacts,
      });
    }
  } catch (error) {
    timeline.logger.warn('Passive AI diagnosis failed; preserving the original failure.', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
