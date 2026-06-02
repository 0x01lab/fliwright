import { test as vitestTest } from 'vitest';
import { AsyncLocalStorage } from 'node:async_hooks';
import { dirname } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import {
  AssertionError,
  Assertion,
  FailureCollector,
  FliwrightDriver,
  createExpect,
} from '@fliwright/core';
import type { FailureContext, HealingReport, Locator, Page } from '@fliwright/core';

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

interface FliwrightTestContext {
  driver: FliwrightDriver;
  testName: string;
}

const testContext = new AsyncLocalStorage<FliwrightTestContext>();

export function createFliwrightTest(config: FliwrightConfig) {
  const fliwrightTest = vitestTest.extend<{ page: Page }>({
    page: async ({ task }, use) => {
      if (!config.vmServiceUrl) {
        throw new Error('No VM Service URL provided. Set FLIWRIGHT_VM_URL or use createFliwrightTest({ vmServiceUrl }).');
      }
      if (!sharedDriver) {
        sharedDriver = new FliwrightDriver();
        await sharedDriver.connect(config.vmServiceUrl);
        const mockControllerUrl = process.env.FLIWRIGHT_MOCK_CONTROLLER_URL;
        if (mockControllerUrl) {
          await sharedDriver.mock.configureFlutterController(mockControllerUrl);
        }
      }
      const testName = getTestName(task);
      try {
        await testContext.run({ driver: sharedDriver, testName }, async () => {
          await use(sharedDriver!.page);
        });
      } catch (error) {
        await writeMcpFailureContext(error, sharedDriver, testName, config.timeout ?? 5000);
        throw error;
      }
    },
  });

  return fliwrightTest;
}

export const test = createFliwrightTest({
  vmServiceUrl: process.env.FLIWRIGHT_VM_URL ?? '',
});

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

interface McpFailureEntry {
  testName: string;
  assertion: FailureContext['assertion'];
  widgetTree: object;
  source: FailureContext['source'];
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
): Promise<void> {
  const outputPath = process.env.FLIWRIGHT_MCP_FAILURE_CONTEXT_PATH;
  if (!outputPath) return;

  const failure = await collectFailureEntry(error, driver, testName, timeout);
  await appendFailureEntry(outputPath, failure);
}

async function collectFailureEntry(
  error: unknown,
  driver: FliwrightDriver,
  testName: string,
  timeout: number,
): Promise<McpFailureEntry> {
  if (error instanceof AssertionError) {
    const collector = new FailureCollector((method, params) => driver.sendRequest(method, params));
    const context = await collector.collect(error, timeout);
    return {
      testName,
      assertion: context.assertion,
      widgetTree: context.widgetTree,
      source: context.source,
      healingSuggestion: latestHealingSuggestion(driver, testName),
      timestamp: context.timestamp,
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  return {
    testName,
    assertion: {
      matcher: 'unknown',
      expected: 'pass',
      actual: message,
      timeout,
    },
    widgetTree: {},
    source: {
      file: '<unknown>',
      line: 0,
      snippet: message,
    },
    healingSuggestion: latestHealingSuggestion(driver, testName),
    timestamp: new Date().toISOString(),
  };
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
