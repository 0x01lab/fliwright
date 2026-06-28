import { describe, it, expect, test as vitestTest, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Assertion, Locator } from '@fliwright/core';
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

vi.mock(import('@fliwright/core'), async () => {
  const actual = await import('../../fliwright-core/src/index.js');

  class MockDriver {
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

    async connect(): Promise<void> {}

    async listenToDiagnostics(): Promise<void> {}

    async sendRequest(method?: string): Promise<unknown> {
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
  ai: { provider: 'mock' },
});

testWithAi('provides an aiRuntime fixture to generated tests', async ({ aiRuntime }) => {
  expect(aiRuntime).toBeInstanceOf(AiRuntime);
});

const testWithTimeline = createFliwrightTest({
  vmServiceUrl: 'ws://localhost:12345/ws',
  runsRoot: testRunsRoot,
  ai: { provider: 'mock' },
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

const testWithLogger = createFliwrightTest({
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
    kind: 'test',
    message: 'Test started',
  }));
  expect(events).toContainEqual(expect.objectContaining({
    kind: 'test',
    message: 'custom user log',
    data: { screen: 'login' },
  }));
});

let persistedTimelinePath = '';

testWithTimeline('writes timeline.json after each run', async ({ flow, timeline }) => {
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
