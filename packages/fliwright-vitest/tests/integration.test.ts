import { describe, it, expect, test as vitestTest, vi } from 'vitest';
import { Assertion, Locator } from '@fliwright/core';
import { AiRuntime } from '@fliwright/core';
import {
  afterEach as fliwrightAfterEach,
  beforeEach as fliwrightBeforeEach,
  beforeAll as fliwrightBeforeAll,
  createFliwrightTest,
  defineConfig,
  describe as fliwrightDescribe,
  expect as fliwrightExpect,
  test as fliwrightTest,
} from '../src/index.js';

vi.mock(import('@fliwright/core'), async importOriginal => {
  const actual = await importOriginal();

  class MockDriver {
    readonly page = {
      screenshot: async () => Buffer.from(''),
      snapshot: async () => ({}),
    };
    readonly healing = { getReports: () => [] };

    async connect(): Promise<void> {}

    async listenToDiagnostics(): Promise<void> {}

    async sendRequest(): Promise<unknown> {
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
  ai: { provider: 'mock' },
});

testWithAi('provides an aiRuntime fixture to generated tests', async ({ aiRuntime }) => {
  expect(aiRuntime).toBeInstanceOf(AiRuntime);
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
