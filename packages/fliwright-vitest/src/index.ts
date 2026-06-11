import {
  afterAll,
  afterEach as vitestAfterEach,
  beforeAll,
  beforeEach as vitestBeforeEach,
  describe,
  test as vitestTest,
} from 'vitest';
import { AsyncLocalStorage } from 'node:async_hooks';
import { dirname } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import {
  AssertionError,
  Assertion,
  FailureCollector,
  FliwrightDriver,
  TraceCollector,
  TraceStore,
  isActionMethod,
  createExpect,
} from '@fliwright/core';
import type { FailureContext, HealingReport, Locator, Page, VMServiceEvent, TraceMode } from '@fliwright/core';

export interface FliwrightConfig {
  vmServiceUrl: string;
  timeout?: number;
  screenshot?: 'file' | 'base64' | 'off';
}

export function defineConfig(overrides: Partial<FliwrightConfig> & { vmServiceUrl: string }): FliwrightConfig {
  return {
    timeout: 5000,
    screenshot: 'file',
    ...overrides,
  };
}

let sharedDriver: FliwrightDriver | null = null;

// Run-level trace ID, generated once per Vitest process
const runId = TraceStore.generateRunId();

interface FliwrightTestContext {
  driver: FliwrightDriver;
  testName: string;
  traceCollector?: TraceCollector;
  originalSendRequest?: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
}

const testContext = new AsyncLocalStorage<FliwrightTestContext>();

type FliwrightHookContext = {
  page: Page;
};

type FliwrightHook = (context: FliwrightHookContext, suite: unknown) => unknown | Promise<unknown>;

export function createFliwrightTest(config: FliwrightConfig) {
  const fliwrightTest = vitestTest.extend<{ page: Page; driver: FliwrightDriver }>({
    driver: async ({ task }, use) => {
      const driver = await getSharedDriver(config);
      const testName = getTestName(task);
      await testContext.run({ driver, testName }, async () => {
        await use(driver);
      });
    },
    page: async ({ task }, use) => {
      const driver = await getSharedDriver(config);
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

      const ctx: FliwrightTestContext = { driver, testName, traceCollector: collector, originalSendRequest: origSendRequest };

      try {
        await testContext.run(ctx, async () => {
          await use(driver.page);
        });
      } catch (error) {
        await collector?.complete('failed');
        await writeMcpFailureContext(error, driver, testName, config.timeout ?? 5000, config.screenshot ?? 'file');
        // Restore original sendRequest before re-throwing
        if (origSendRequest) (driver as any).sendRequest = origSendRequest;
        throw error;
      }

      await collector?.complete('passed');
      // Restore original sendRequest
      if (origSendRequest) (driver as any).sendRequest = origSendRequest;
    },
  });

  return fliwrightTest;
}

export const test = createFliwrightTest({
  vmServiceUrl: toWebSocketUrl(process.env.FLIWRIGHT_VM_URL ?? process.env.FLIWRIGHT_VM_SERVICE_URL ?? ''),
  timeout: parsePositiveInt(process.env.FLIWRIGHT_FAILURE_TIMEOUT_MS) ?? 5000,
  screenshot: parseScreenshotMode(process.env.FLIWRIGHT_SCREENSHOT_MODE),
});

export function beforeEach(hook: FliwrightHook, timeout?: number): void {
  vitestBeforeEach<FliwrightHookContext>(hook, timeout);
}

export function afterEach(hook: FliwrightHook, timeout?: number): void {
  vitestAfterEach<FliwrightHookContext>(hook, timeout);
}

export { afterAll, beforeAll, describe };

export function expect(locator: Locator): Assertion {
  const context = testContext.getStore();
  if (!context) return createExpect(locator);
  return new Assertion(
    locator,
    false,
    undefined,
    context.driver.healing,
    context.testName,
    (method, params) => context.driver.sendRequest(method, params),
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
