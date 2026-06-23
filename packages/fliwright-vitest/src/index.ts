import {
  afterAll,
  afterEach as vitestAfterEach,
  beforeAll,
  beforeEach as vitestBeforeEach,
  describe,
  test as vitestTest,
} from 'vitest';
import { AsyncLocalStorage } from 'node:async_hooks';
import { dirname, join, resolve } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import {
  AgentRuntime,
  AiRuntime,
  AssertionError,
  Assertion,
  FailureCollector,
  FileLogSink,
  FliwrightDriver,
  FlowRuntime,
  FliwrightAgentError,
  JsonlLogSink,
  MockRuntime,
  Page as FliwrightPage,
  PrettyLogFormatter,
  readWorkspaceConfigSync,
  TraceCollector,
  TraceStore,
  StructuredLogger,
  TimelineArtifactStore,
  TimelineRecorder,
  isActionMethod,
  createExpect,
  resolveAiConfig,
} from '@fliwright/core';
import type { AiRuntimeConfig, AgentPolicy, FailureContext, FliwrightLogger, FliwrightLogLevel, FliwrightLogEvent, HealingReport, Locator, LogSink, Page, TimelineRunMode, VMServiceEvent, TraceMode } from '@fliwright/core';

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
  timeout?: number;
  screenshot?: 'file' | 'base64' | 'off';
  ai?: AiRuntimeConfig;
  mode?: TimelineRunMode;
  requireAssertions?: boolean;
  agentPolicy?: AgentPolicy;
  timelineDir?: string;
  runsRoot?: string;
  log?: FliwrightLogConfig;
}

export function defineConfig(overrides: Partial<FliwrightConfig> & { vmServiceUrl: string }): FliwrightConfig {
  return {
    timeout: 5000,
    screenshot: 'file',
    ...overrides,
  };
}

/**
 * Decide where run artifacts go for a fliwright test run.
 * Precedence: explicit config.runsRoot > FLIWRIGHT_RUNS_ROOT env > undefined
 * (the caller — createFliwrightTest — falls back to legacy cwd/.fliwright when undefined).
 */
export function resolveRunsRoot(config: { runsRoot?: string }): string | undefined {
  return config.runsRoot ?? process.env.FLIWRIGHT_RUNS_ROOT;
}

let sharedDriver: FliwrightDriver | null = null;

// Run-level trace ID, generated once per Vitest process
const runId = TraceStore.generateRunId();

interface FliwrightTestContext {
  driver: FliwrightDriver;
  testName: string;
  timeline?: FliwrightTimelineContext;
  traceCollector?: TraceCollector;
  originalSendRequest?: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
}

const testContext = new AsyncLocalStorage<FliwrightTestContext>();
let currentTestContext: FliwrightTestContext | null = null;

type FliwrightHookContext = {
  page: Page;
};

type FliwrightHook = (context: FliwrightHookContext, suite: unknown) => unknown | Promise<unknown>;

interface FliwrightTimelineContext {
  recorder: TimelineRecorder;
  artifactStore: TimelineArtifactStore;
  runId: string;
  logger: FliwrightLogger;
  timelinePath?: string;
}

interface FliwrightFixtures {
  driver: FliwrightDriver;
  page: Page;
  aiRuntime: AiRuntime;
  flow: FlowRuntime;
  mock: MockRuntime;
  agent: AgentRuntime;
  timeline: FliwrightTimelineContext;
  logger: FliwrightLogger;
}

export interface CreateFliwrightTestOptions {
  /** When set, fixtures use this driver instead of lazily creating sharedDriver. */
  driverProvider?: () => Promise<FliwrightDriver>;
}

export function createFliwrightTest(config: FliwrightConfig, options?: CreateFliwrightTestOptions) {
  const resolveDriver = options?.driverProvider
    ? () => options.driverProvider!()
    : () => getSharedDriver(config);
  const fliwrightTest = vitestTest.extend<FliwrightFixtures>({
    timeline: async ({ task }, use) => {
      const testName = getTestName(task);
      const testRunId = `${process.env.FLIWRIGHT_RUN_ID ?? runId}-${safeName(testName)}`;
      const runsRoot = resolveRunsRoot(config);
      const artifactStore = new TimelineArtifactStore({
        cwd: config.timelineDir ?? process.cwd(),
        ...(runsRoot ? { runsRoot } : {}),
        runId: testRunId,
      });
      const logger = createRunLogger(config, {
        runId: testRunId,
        testName,
        mode: config.mode ?? 'test',
        runDir: artifactStore.runDir,
      });
      const recorder = new TimelineRecorder({
        runId: testRunId,
        testName,
        mode: config.mode ?? 'test',
        logger,
      });
      const timeline: FliwrightTimelineContext = { recorder, artifactStore, runId: testRunId, logger };
      const ctx = testContext.getStore();
      if (ctx) ctx.timeline = timeline;

      let failed = false;
      try {
        logger.info(`${config.mode === 'script' ? 'Script' : 'Test'} started`);
        await use(timeline);
        if (config.requireAssertions && !timeline.recorder.toJSON().nodes.some((node) => node.kind === 'assertion')) {
          throw new FliwrightAgentError({
            code: 'assertion_failed',
            title: testName,
            message: 'Test mode requires at least one timeline assertion, but none were recorded.',
            recoveryHints: [
              { kind: 'manual', description: 'Add at least one expect(...).to* assertion or disable requireAssertions.' },
            ],
          });
        }
      } catch (error) {
        failed = true;
        captureTimelineFailure(timeline, error, testName);
        logger.error(`${config.mode === 'script' ? 'Script' : 'Test'} failed`, error);
        throw error;
      } finally {
        const data = timeline.recorder.complete(failed ? 'failed' : 'passed');
        timeline.timelinePath = await timeline.artifactStore.writeTimeline(data);
        if (!failed) logger.success(`${config.mode === 'script' ? 'Script' : 'Test'} passed`);
      }
    },
    driver: async ({ task, timeline }, use) => {
      const driver = await resolveDriver();
      const testName = getTestName(task);
      const previous = currentTestContext;
      const ctx: FliwrightTestContext = { driver, testName, timeline };
      currentTestContext = ctx;
      try {
        await testContext.run(ctx, async () => {
          await use(driver);
        });
      } finally {
        currentTestContext = previous;
      }
    },
    page: async ({ task, timeline }, use) => {
      const driver = await resolveDriver();
      const testName = getTestName(task);

      // ── Trace collection setup ──────────────────────────────
      const traceMode = parseTraceMode(process.env.FLIWRIGHT_TRACE);
      const traceDir = process.env.FLIWRIGHT_TRACE_DIR;
      let collector: TraceCollector | undefined;
      let origSendRequest: ((method: string, params?: Record<string, unknown>) => Promise<unknown>) | undefined;

      if (traceMode !== 'off' && traceDir) {
        try {
          collector = await TraceCollector.create(traceDir, testName, runId, driver.sendRequest.bind(driver), traceMode);
          // Shadow driver.sendRequest with traced version
          origSendRequest = driver.sendRequest.bind(driver);
          const capturedCollector = collector;
          const capturedOrigSend = origSendRequest;
          (driver as any).sendRequest = async (method: string, params?: Record<string, unknown>) => {
            const start = Date.now();
            let error: unknown;
            let result: unknown;
            try {
              result = await capturedOrigSend(method, params);
            } catch (e) {
              error = e;
              throw e;
            } finally {
              if (isActionMethod(method)) {
                await capturedCollector.onAction(method, params ?? {}, Date.now() - start, result, error);
              }
            }
            return result;
          };
        } catch {
          // Trace setup failure should not prevent test from running
        }
      }

      // Reset lazy Page so it picks up the shadowed sendRequest
      (driver as any)._page = null;

      const ctx: FliwrightTestContext = { driver, testName, timeline, traceCollector: collector, originalSendRequest: origSendRequest };
      const previous = currentTestContext;
      currentTestContext = ctx;

      try {
        await testContext.run(ctx, async () => {
          const page = new FliwrightPage(
            (method, params) => driver.sendRequest(method, params),
            {
              recorder: timeline.recorder,
              artifactStore: timeline.artifactStore,
            },
          );
          await use(page);
        });
        await collector?.complete('passed');
      } catch (error) {
        await collector?.complete('failed');
        await writeMcpFailureContext(error, driver, testName, config.timeout ?? 5000, config.screenshot ?? 'file');
        throw error;
      } finally {
        // Restore original sendRequest
        if (origSendRequest) (driver as any).sendRequest = origSendRequest;
        currentTestContext = previous;
      }
    },
    aiRuntime: async ({ task, timeline }, use) => {
      const driver = await resolveDriver();
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
      await use(new FlowRuntime({ recorder: timeline.recorder, artifactStore: timeline.artifactStore, page }));
    },
    mock: async ({ driver, timeline }, use) => {
      await use(new MockRuntime(driver.mock, timeline.recorder));
    },
    agent: async ({ aiRuntime, timeline }, use) => {
      await use(new AgentRuntime({ aiRuntime, recorder: timeline.recorder }));
    },
    logger: async ({ timeline }, use) => {
      await use(timeline.logger);
    },
  });

  return fliwrightTest;
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
    context.driver.healing,
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
      }
      : { title },
  );
}

// ── MCP Failure Context (unchanged) ──────────────────────────

interface McpFailureEntry {
  testName: string;
  assertion: FailureContext['assertion'];
  widgetTree: object;
  diagnostics?: VMServiceEvent[];
  source: FailureContext['source'];
  screenshot?: {
    mimeType: 'image/png';
    base64: string;
  };
  healingSuggestion?: McpHealingSuggestion;
  timestamp: string;
}

interface McpHealingSuggestion {
  originalSelector: string;
  suggestedSelector: string;
  confidence: number;
  scores: HealingReport['scores'];
}

async function writeMcpFailureContext(
  error: unknown,
  driver: FliwrightDriver,
  testName: string,
  timeout: number,
  screenshotMode: 'file' | 'base64' | 'off',
): Promise<void> {
  const outputPath = process.env.FLIWRIGHT_MCP_FAILURE_CONTEXT_PATH;
  if (!outputPath) return;

  const failure = await collectFailureEntry(error, driver, testName, timeout, screenshotMode);
  await appendFailureEntry(outputPath, failure);
}

async function collectFailureEntry(
  error: unknown,
  driver: FliwrightDriver,
  testName: string,
  timeout: number,
  screenshotMode: 'file' | 'base64' | 'off',
): Promise<McpFailureEntry> {
  if (error instanceof AssertionError) {
    const collector = new FailureCollector((method, params) => driver.sendRequest(method, params));
    const context = await collector.collect(error, timeout);
    return {
      testName,
      assertion: context.assertion,
      widgetTree: context.widgetTree,
      diagnostics: collectDiagnostics(driver),
      source: context.source,
      screenshot: serializeScreenshot(context.screenshot, screenshotMode),
      healingSuggestion: latestHealingSuggestion(driver, testName),
      timestamp: context.timestamp,
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  const [screenshot, widgetTree] = await Promise.all([
    takeScreenshot(driver, screenshotMode),
    collectWidgetTree(driver),
  ]);
  return {
    testName,
    assertion: {
      matcher: 'unknown',
      expected: 'pass',
      actual: message,
      timeout,
    },
    widgetTree,
    diagnostics: collectDiagnostics(driver),
    source: {
      file: '<unknown>',
      line: 0,
      snippet: message,
    },
    screenshot,
    healingSuggestion: latestHealingSuggestion(driver, testName),
    timestamp: new Date().toISOString(),
  };
}

async function getSharedDriver(config: FliwrightConfig): Promise<FliwrightDriver> {
  const vmServiceUrl = toWebSocketUrl(config.vmServiceUrl);
  if (!vmServiceUrl) {
    throw new Error(
      'No VM Service URL provided. Set FLIWRIGHT_VM_URL or FLIWRIGHT_VM_SERVICE_URL, or use createFliwrightTest({ vmServiceUrl }).',
    );
  }
  if (!sharedDriver) {
    sharedDriver = new FliwrightDriver();
    await sharedDriver.connect(vmServiceUrl);
    await listenToDiagnostics(sharedDriver);
  }
  return sharedDriver;
}

async function listenToDiagnostics(driver: FliwrightDriver): Promise<void> {
  try {
    await driver.listenToDiagnostics();
  } catch {
    // Diagnostics are helpful for AI reports but should not prevent tests from running.
  }
}

function serializeScreenshot(
  screenshot: FailureContext['screenshot'],
  screenshotMode: 'file' | 'base64' | 'off',
): McpFailureEntry['screenshot'] | undefined {
  if (!screenshot || screenshotMode === 'off') return undefined;
  return {
    mimeType: 'image/png',
    base64: screenshot.toString('base64'),
  };
}

async function takeScreenshot(
  driver: FliwrightDriver,
  screenshotMode: 'file' | 'base64' | 'off',
): Promise<McpFailureEntry['screenshot'] | undefined> {
  if (screenshotMode === 'off') return undefined;
  try {
    return {
      mimeType: 'image/png',
      base64: (await driver.page.screenshot()).toString('base64'),
    };
  } catch {
    return undefined;
  }
}

async function collectWidgetTree(driver: FliwrightDriver): Promise<object> {
  try {
    return await driver.sendRequest('ext.fliwright.snapshot', {}) as object;
  } catch {
    try {
      return await driver.sendRequest('ext.fliwright.inspect', { selector: '' }) as object;
    } catch {
      return { error: 'Failed to collect widget tree' };
    }
  }
}

function collectDiagnostics(driver: FliwrightDriver): VMServiceEvent[] | undefined {
  try {
    const events = driver.getDiagnostics({ limit: 50 });
    return events.length > 0 ? events : undefined;
  } catch {
    return undefined;
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

function parseTraceMode(value: string | undefined): TraceMode {
  if (value === 'full' || value === 'on-failure') return value;
  return 'off';
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

function latestHealingSuggestion(
  driver: FliwrightDriver,
  testName: string,
): McpHealingSuggestion | undefined {
  const report = driver.healing.getReports(testName).at(-1);
  if (!report) return undefined;

  return {
    originalSelector: report.originalSelector,
    suggestedSelector: report.suggestedSelector,
    confidence: report.confidence,
    scores: report.scores,
  };
}

async function appendFailureEntry(outputPath: string, entry: McpFailureEntry): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });
  let entries: McpFailureEntry[] = [];
  try {
    entries = JSON.parse(await readFile(outputPath, 'utf8')) as McpFailureEntry[];
  } catch {
    entries = [];
  }
  entries.push(entry);
  await writeFile(outputPath, JSON.stringify(entries, null, 2));
}

function getTestName(task: unknown): string {
  const candidate = task as { name?: unknown };
  if (typeof candidate.name === 'string') return candidate.name;
  return '<unknown>';
}

function captureTimelineFailure(timeline: FliwrightTimelineContext, error: unknown, testName: string): void {
  if (error instanceof FliwrightAgentError) return;
  const node = timeline.recorder.startNode('failure', testName);
  timeline.recorder.failNode(node.id, {
    code: 'unknown',
    title: testName,
    message: error instanceof Error ? error.message : String(error),
    timelineNodeId: node.id,
    recoveryHints: [
      { kind: 'observe', description: 'Inspect timeline artifacts and failure context for this run.' },
      { kind: 'manual', description: 'Review the thrown error and app state at failure time.' },
    ],
  });
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'test';
}
