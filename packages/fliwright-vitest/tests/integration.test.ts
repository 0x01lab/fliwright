import { describe, it, expect, beforeEach, test as vitestTest, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Assertion, Locator, MockAiAdapter } from '@fliwright/core';
import { AiRuntime } from '@fliwright/core';
import {
  afterEach as fliwrightAfterEach,
  beforeAll as fliwrightBeforeAll,
  beforeEach as fliwrightBeforeEach,
  createFliwrightScript,
  createFliwrightTest,
  defineConfig,
  describe as fliwrightDescribe,
  expect as fliwrightExpect,
  script as fliwrightScript,
  test as fliwrightTest,
} from '../src/index.js';
import type { FliwrightPlugin } from '@fliwright/core';

const mockDriverOptions: unknown[] = [];
const mockConnectCalls: string[] = [];
const mockConnectFailures = new Map<string, number>();

vi.mock(import('@fliwright/core'), async () => {
  const actual = await import('../../fliwright-core/src/index.js');

  class MockDriver {
    disposed = false;
    readonly page = {
      screenshot: async () => Buffer.from(''),
      snapshot: async () => ({}),
      locator: (selector: unknown) => new actual.Locator(selector as any, async () => ({
        matches: [{ id: '1', type: 'Text', text: 'Next', hitTestable: true, properties: { enabled: true } }],
      })),
    };
    readonly healing = { getReports: () => [] };
    readonly mock = {
      route: vi.fn().mockResolvedValue(undefined),
      routeFlutter: vi.fn().mockResolvedValue(undefined),
      removeRoute: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
      clearCalls: vi.fn().mockResolvedValue(undefined),
      setPassthrough: vi.fn().mockResolvedValue(undefined),
      getCalls: vi.fn().mockResolvedValue([{ method: 'POST', path: '/api/register', headers: {}, body: '{}', timestamp: 'now' }]),
      listRoutes: vi.fn().mockResolvedValue([]),
      listRules: vi.fn().mockReturnValue([]),
      loadRules: vi.fn().mockResolvedValue(undefined),
      switchRule: vi.fn().mockResolvedValue(undefined),
    };

    constructor(options?: unknown) {
      mockDriverOptions.push(options);
    }

    async connect(vmServiceUrl?: string): Promise<void> {
      const url = vmServiceUrl ?? '';
      mockConnectCalls.push(url);
      const failures = mockConnectFailures.get(url) ?? 0;
      if (failures > 0) {
        mockConnectFailures.set(url, failures - 1);
        throw new Error(`connect failed for ${url}`);
      }
    }

    async dispose(): Promise<void> { this.disposed = true; }

    async listenToDiagnostics(): Promise<void> {}

    async sendRequest(method?: string): Promise<unknown> {
      if (method === 'ext.fliwright.screenshot') return { success: true, screenshot: Buffer.from('lifecycle').toString('base64') };
      if (method === 'ext.fliwright.snap') return { widgets: [{ type: 'Root' }] };
      if (method === 'ext.fliwright.captureFrame') return { diagnostics: [] };
      if (method === 'ext.fliwright.resolve') {
        return {
          matches: [{ id: '1', type: 'Text', text: 'Next', hitTestable: true, properties: { enabled: true } }],
        };
      }
      return {};
    }

    getDiagnostics(): unknown[] {
      return [];
    }
  }

  return {
    ...actual,
    FliwrightDriver: MockDriver,
  };
});

const testRunsRoot = mkdtempSync(join(tmpdir(), 'fliwright-vitest-runs-'));

describe('createFliwrightTest', () => {
  it('creates a test function with page fixture', () => {
    const test = createFliwrightTest({
      vmServiceUrl: 'ws://localhost:12345/ws',
    });
    expect(test).toBeDefined();
    expect(typeof test).toBe('function');
  });

  it('exports a default test function for generated tests', () => {
    expect(fliwrightTest).toBeDefined();
    expect(typeof fliwrightTest).toBe('function');
  });

  it('exports a default script function for automation scripts', () => {
    expect(fliwrightScript).toBeDefined();
    expect(typeof fliwrightScript).toBe('function');
  });

  it('exports hooks for generated tests', () => {
    expect(fliwrightBeforeEach).toBeDefined();
    expect(fliwrightAfterEach).toBeDefined();
    expect(fliwrightBeforeAll).toBeDefined();
    expect(fliwrightDescribe).toBeDefined();
    expect(typeof fliwrightBeforeEach).toBe('function');
    expect(typeof fliwrightAfterEach).toBe('function');
  });

  it('exports a fliwright expect function', () => {
    const locator = new Locator('text=Login', async () => ({ widgets: [] }));
    const assertion = fliwrightExpect(locator);
    expect(assertion).toBeInstanceOf(Assertion);
  });

  it('creates a test function with an aiRuntime fixture when configured', () => {
    const test = createFliwrightTest({
      vmServiceUrl: 'ws://localhost:12345/ws',
      ai: { provider: 'mock' },
    });
    expect(test).toBeDefined();
    expect(typeof test).toBe('function');
  });

  it('creates a script function with script mode', () => {
    const script = createFliwrightScript({
      vmServiceUrl: 'ws://localhost:12345/ws',
    });
    expect(script).toBeDefined();
    expect(typeof script).toBe('function');
  });

  it('preserves ai config in defineConfig', () => {
    const config = defineConfig({
      vmServiceUrl: 'ws://localhost:12345/ws',
      ai: {
        provider: 'mock',
        timeoutMs: 1234,
        artifactsDir: '.fliwright/ai-test',
      },
    });

    expect(config.ai).toMatchObject({
      provider: 'mock',
      timeoutMs: 1234,
      artifactsDir: '.fliwright/ai-test',
    });
  });

  it('preserves plugins in defineConfig', () => {
    const plugin: FliwrightPlugin = { name: 'project-plugin' };
    const config = defineConfig({
      vmServiceUrl: 'ws://localhost:12345/ws',
      plugins: [plugin],
    });

    expect(config.plugins).toEqual([plugin]);
  });

  it('exposes the AiRuntime type for aiRuntime fixture consumers', () => {
    const runtime: AiRuntime | undefined = undefined;
    expect(runtime).toBeUndefined();
  });

  it('defineConfig merges defaults', () => {
    const config = defineConfig({
      vmServiceUrl: 'ws://localhost:12345/ws',
      timeout: 10000,
    });
    expect(config.vmServiceUrl).toBe('ws://localhost:12345/ws');
    expect(config.timeout).toBe(10000);
    expect(config.screenshot).toBe('file');
  });
});

const testWithAi = createFliwrightTest({
  vmServiceUrl: 'ws://localhost:12345/ws',
  runsRoot: testRunsRoot,
  ai: { provider: 'mock', artifactsDir: join(testRunsRoot, 'ai') },
});

testWithAi('provides an aiRuntime fixture to generated tests', async ({ aiRuntime }) => {
  expect(aiRuntime).toBeInstanceOf(AiRuntime);
});

const testWithTimeline = createFliwrightTest({
  vmServiceUrl: 'ws://localhost:12345/ws',
  runsRoot: testRunsRoot,
  ai: { provider: 'mock', artifactsDir: join(testRunsRoot, 'ai') },
});

let lifecycleTimelinePath = '';
const testWithLifecycleScreenshots = createFliwrightTest({
  vmServiceUrl: 'ws://localhost:12345/ws',
  runsRoot: testRunsRoot,
  recording: { mode: 'standard' },
});

testWithLifecycleScreenshots('captures standard test start and finish screenshots', async ({ page, timeline }) => {
  lifecycleTimelinePath = timeline.artifactStore.timelinePath;
  await fliwrightExpect(page.locator({ text: 'Next' }), 'lifecycle assertion').toBeVisible();
});

const testWithAutomaticActions = createFliwrightTest({
  vmServiceUrl: 'ws://localhost:12345/ws',
  runsRoot: testRunsRoot,
  recording: { mode: 'standard', testFinalScreenshots: false },
});

let automaticActionsTimelinePath = '';
testWithAutomaticActions('records ordinary locator actions without flow.step wrappers', async ({ page, timeline }) => {
  automaticActionsTimelinePath = timeline.artifactStore.timelinePath;
  const next = page.getByText('Next');
  await next.click();
  await next.click();
  await fliwrightExpect(next, 'ordinary action assertion').toBeVisible();
});

vitestTest('ordinary locator actions have one action node each and one assertion', async () => {
  const timeline = JSON.parse(await readFile(automaticActionsTimelinePath, 'utf8')) as {
    nodes: Array<{ kind: string; metadata?: { action?: string }; status: string }>;
  };
  const actions = timeline.nodes.filter((node) => node.kind === 'action');
  expect(actions).toHaveLength(2);
  expect(actions.map((node) => node.metadata?.action)).toEqual(['tap', 'tap']);
  expect(timeline.nodes.filter((node) => node.kind === 'assertion')).toHaveLength(1);
});

vitestTest('persists lifecycle screenshots as timeline evidence', async () => {
  const timeline = JSON.parse(await readFile(lifecycleTimelinePath, 'utf8')) as {
    nodes: Array<{ metadata?: { lifecycle?: string }; artifacts?: Array<{ kind: string }> }>;
  };
  const lifecycle = timeline.nodes.filter((node) => node.metadata?.lifecycle);
  expect(lifecycle.map((node) => node.metadata?.lifecycle)).toEqual(['start', 'finish']);
  expect(lifecycle.every((node) => node.artifacts?.some((artifact) => artifact.kind === 'screenshot'))).toBe(true);
});

let noFinalLifecycleTimelinePath = '';
const testWithoutFinalScreenshot = createFliwrightTest({
  vmServiceUrl: 'ws://localhost:12345/ws',
  runsRoot: testRunsRoot,
  recording: { mode: 'standard', testFinalScreenshots: false },
});

testWithoutFinalScreenshot('can disable the final lifecycle screenshot', async ({ page, timeline }) => {
  noFinalLifecycleTimelinePath = timeline.artifactStore.timelinePath;
  await fliwrightExpect(page.locator({ text: 'Next' }), 'no final screenshot assertion').toBeVisible();
});

vitestTest('does not write a final lifecycle screenshot when disabled', async () => {
  const timeline = JSON.parse(await readFile(noFinalLifecycleTimelinePath, 'utf8')) as {
    nodes: Array<{ metadata?: { lifecycle?: string } }>;
  };
  expect(timeline.nodes.filter((node) => node.metadata?.lifecycle).map((node) => node.metadata?.lifecycle))
    .toEqual(['start']);
});

const testWithPassiveDiagnosis = createFliwrightTest({
  vmServiceUrl: 'ws://localhost:12346/ws',
  runsRoot: testRunsRoot,
  ai: {
    artifactsDir: join(testRunsRoot, 'ai'),
    provider: 'mock',
    adapter: new MockAiAdapter([{
      text: JSON.stringify({
        summary: 'The action failed.',
        rootCause: 'The test raised an error.',
        suggestedActions: ['Inspect the timeline.'],
        confidence: 0.9,
      }),
      json: {
        summary: 'The action failed.',
        rootCause: 'The test raised an error.',
        suggestedActions: ['Inspect the timeline.'],
        confidence: 0.9,
      },
    }]),
  },
  agentPolicy: { passive: true },
});

let passiveDiagnosisTimelinePath = '';

testWithPassiveDiagnosis.fails('records a configured passive diagnosis after failure', async ({ flow, timeline }) => {
  passiveDiagnosisTimelinePath = timeline.artifactStore.timelinePath;
  await flow.step('Fail operation', () => {
    throw new Error('operation failed');
  });
});

vitestTest('persists the configured passive diagnosis without replacing the original failure', async () => {
  const timeline = JSON.parse(await readFile(passiveDiagnosisTimelinePath, 'utf8')) as {
    agentVisibleFailures?: Array<{ code: string }>;
    nodes: Array<{ kind: string; status: string; metadata?: Record<string, unknown> }>;
  };

  expect(timeline.agentVisibleFailures).toContainEqual(expect.objectContaining({ code: 'step_failed' }));
  expect(timeline.nodes).toContainEqual(expect.objectContaining({
    kind: 'ai-call',
    status: 'passed',
    metadata: expect.objectContaining({ mode: 'passive-diagnosis', failureCode: 'step_failed' }),
  }));
});

const pluginConfiguredTest = createFliwrightTest({
  vmServiceUrl: 'ws://localhost:22345/ws',
  runsRoot: testRunsRoot,
  plugins: [{ name: 'exio-project-plugin' }],
});

pluginConfiguredTest('passes configured plugins to the shared driver', async ({ driver }) => {
  expect(driver).toBeDefined();
  expect(mockDriverOptions).toContainEqual({
    plugins: [expect.objectContaining({ name: 'exio-project-plugin' })],
  });
});

const retryAfterConnectFailureUrl = 'ws://localhost:32345/ws';
mockConnectFailures.set(retryAfterConnectFailureUrl, 1);

const connectFailureTest = createFliwrightTest({
  vmServiceUrl: retryAfterConnectFailureUrl,
  runsRoot: testRunsRoot,
});

connectFailureTest.fails('surfaces the first shared driver connect failure', async ({ driver }) => {
  expect(driver).toBeDefined();
  throw new Error('fixture should fail before this callback runs');
});

connectFailureTest('retries the same shared driver config after a connect failure', async ({ driver }) => {
  expect(driver).toBeDefined();
  expect(mockConnectCalls.filter((url) => url === retryAfterConnectFailureUrl)).toHaveLength(2);
});

describe('parallel apps keep independent driver connections', () => {
  const arrived = new Set<string>();
  let release!: () => void;
  const bothConnected = new Promise<void>((resolve) => { release = resolve; });
  let firstReady!: () => void;
  const firstConnected = new Promise<void>((resolve) => { firstReady = resolve; });
  beforeEach(async ({ task }) => {
    if (task.name === 'parallel-b') await firstConnected;
  });
  for (const app of ['parallel-a', 'parallel-b']) {
    const appTest = createFliwrightTest({ vmServiceUrl: `ws://${app}/ws`, runsRoot: testRunsRoot });
    appTest.concurrent(app, async ({ driver }) => {
      arrived.add(app);
      if (app === 'parallel-a') firstReady();
      if (arrived.size === 2) release();
      await bothConnected;
      expect((driver as unknown as { disposed: boolean }).disposed).toBe(false);
    });
  }
});

testWithTimeline('provides timeline-native fixtures', async ({ page, flow, mock, agent, timeline }) => {
  await flow.step('Generate data', async () => {
    await agent.generate('Generate payload', {
      schema: { type: 'object' },
      fallback: { ok: true },
    });
  });
  await mock.route('/api/register', { method: 'POST', status: 200 });
  await fliwrightExpect(page.locator({ text: 'Next' }), 'Next is visible').toBeVisible();

  expect(timeline.recorder.toJSON().nodes.map((node) => node.kind)).toContain('ai-call');
  expect(timeline.recorder.toJSON().nodes.map((node) => node.kind)).toContain('mock');
  expect(timeline.recorder.toJSON().nodes.map((node) => node.kind)).toContain('assertion');
});

testWithTimeline('records locator expect assertions in the timeline', async ({ page, timeline }) => {
  await fliwrightExpect(page.locator({ text: 'Next' }), 'Next is visible').toBeVisible();

  expect(timeline.recorder.toJSON().nodes).toContainEqual(expect.objectContaining({
    kind: 'assertion',
    title: 'Next is visible',
    metadata: expect.objectContaining({
      matcher: 'toBeVisible',
    }),
  }));
});

testWithTimeline('provides the timeline-native assert fixture', async ({ page, assert, timeline }) => {
  await assert.visible('Next is visible through assert', page.locator({ text: 'Next' }));
  expect(timeline.recorder.toJSON().nodes).toContainEqual(expect.objectContaining({
    kind: 'assertion',
    title: 'Next is visible through assert',
    metadata: expect.objectContaining({ matcher: 'visible' }),
  }));
});

let persistedFailedAssertionTimelinePath = '';

testWithTimeline.fails('persists failed timeline-native assertions', async ({ assert, timeline }) => {
  persistedFailedAssertionTimelinePath = timeline.artifactStore.timelinePath;
  const missing = {
    selectorString: 'text=Missing',
    isVisible: async () => false,
  } as Locator;

  await assert.visible('Missing control', missing, { timeout: 0 });
});

vitestTest('failed assert fixture writes an agent-visible failure to timeline.json', async () => {
  const timeline = JSON.parse(await readFile(persistedFailedAssertionTimelinePath, 'utf8')) as {
    nodes: Array<{ kind: string; status: string; error?: { code?: string; actionContext?: { action?: string } } }>;
    agentVisibleFailures?: Array<{ code: string }>;
  };
  expect(timeline.nodes).toContainEqual(expect.objectContaining({
    kind: 'assertion',
    status: 'failed',
    error: expect.objectContaining({
      code: 'assertion_failed',
      actionContext: expect.objectContaining({ action: 'visible' }),
    }),
  }));
  expect(timeline.agentVisibleFailures).toContainEqual(expect.objectContaining({ code: 'assertion_failed' }));
});

const testWithLogger = createFliwrightScript({
  vmServiceUrl: 'ws://localhost:12345/ws',
  timelineDir: await mkdtemp(join(tmpdir(), 'fliwright-vitest-logs-')),
  runsRoot: testRunsRoot,
  log: {
    level: 'debug',
    format: 'jsonl',
    outputs: ['jsonl-file'],
    jsonlPath: '{runDir}/logs/events.jsonl',
  },
});

let persistedLogPath = '';

testWithLogger('provides a logger fixture and writes jsonl logs', async ({ logger, timeline }) => {
  logger.info('custom user log', { screen: 'login' });
  persistedLogPath = join(timeline.artifactStore.runDir, 'logs', 'events.jsonl');
});

vitestTest('logger jsonl file is persisted', async () => {
  const lines = (await readFile(persistedLogPath, 'utf8')).trim().split('\n');
  const events = lines.map((line) => JSON.parse(line) as { kind: string; message: string; data?: Record<string, unknown> });
  expect(events).toContainEqual(expect.objectContaining({
    kind: 'script',
    message: 'Script started',
  }));
  expect(events).toContainEqual(expect.objectContaining({
    kind: 'script',
    message: 'custom user log',
    data: { screen: 'login' },
  }));
});

let persistedTimelinePath = '';

createFliwrightScript({ vmServiceUrl: 'ws://localhost:12345/ws', runsRoot: testRunsRoot })('writes timeline.json after each run', async ({ flow, timeline }) => {
  await flow.step('A passing step', () => undefined);
  persistedTimelinePath = timeline.artifactStore.timelinePath;
});

vitestTest('timeline file is persisted by fixture teardown', async () => {
  const timeline = JSON.parse(await readFile(persistedTimelinePath, 'utf8')) as { nodes: Array<{ title: string }> };
  expect(timeline.nodes.some((node) => node.title === 'A passing step')).toBe(true);
});

describe('fliwright hooks', () => {
  const navigations: string[] = [];
  const testWithPage = vitestTest.extend<{ page: { navigate: (route: string) => Promise<void> } }>({
    page: async ({}, use) => {
      await use({
        navigate: async (route: string) => {
          navigations.push(route);
        },
      });
    },
  });

  fliwrightBeforeEach(async ({ page }) => {
    await page.navigate('/');
  });

  testWithPage('injects the page fixture into beforeEach hooks', () => {
    expect(navigations).toEqual(['/']);
  });
});
