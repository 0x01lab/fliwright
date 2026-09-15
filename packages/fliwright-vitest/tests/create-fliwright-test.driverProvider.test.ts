import { describe, expect, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFliwrightTest, extendFliwrightTest } from '../src/index.js';

function makeStubDriver() {
  return {
    page: {
      screenshot: async () => Buffer.from(''),
      snapshot: async () => ({}),
      locator: () => ({}),
    },
    healing: { getReports: () => [] },
    mock: {},
    sendRequest: async () => ({}),
    connect: async () => {},
    dispose: async () => {},
    listenToDiagnostics: async () => {},
    getDiagnostics: () => [],
  } as any;
}

describe('createFliwrightTest driverProvider', () => {
  const provider = vi.fn(async () => makeStubDriver());
  const test = createFliwrightTest(
    {
      vmServiceUrl: 'ws://placeholder/ws',
      requireAssertions: false,
      mode: 'script',
      runsRoot: mkdtempSync(join(tmpdir(), 'fliwright-vitest-driver-')),
    },
    { driverProvider: provider },
  );

  test('uses the injected provider for page-backed fixtures', async ({ page }) => {
    expect(page).toBeDefined();
  });

  test('called the injected provider instead of requiring a real shared VM driver', () => {
    expect(provider).toHaveBeenCalled();
  });
});

describe('createFliwrightTest scenarios', () => {
  const driver = {
    ...makeStubDriver(),
    app: {
      invoke: vi.fn(async (_capability: string, method: string) => (
        method === 'getStatus' ? { isAuthenticated: false } : undefined
      )),
    },
  };
  const test = createFliwrightTest({
    vmServiceUrl: 'ws://placeholder/ws',
    requireAssertions: false,
    mode: 'script',
    runsRoot: mkdtempSync(join(tmpdir(), 'fliwright-vitest-scenario-')),
    scenarios: {
      guest: {
        name: 'guest',
        layers: [{ kind: 'auth', state: 'guest' }],
        ready: [{ kind: 'auth', state: 'guest' }],
      },
    },
  }, { driverProvider: async () => driver });

  test.scenario('guest')('applies a named scenario before the test body', async () => {
    expect(driver.app.invoke).toHaveBeenCalledWith('auth', 'clearSession');
    expect(driver.app.invoke).toHaveBeenCalledWith('auth', 'getStatus');
  });
});

describe('extendFliwrightTest', () => {
  const base = createFliwrightTest(
    {
      vmServiceUrl: 'ws://placeholder/ws',
      requireAssertions: false,
      mode: 'script',
      runsRoot: mkdtempSync(join(tmpdir(), 'fliwright-vitest-project-fixture-')),
    },
    { driverProvider: async () => makeStubDriver() },
  );

  const test = extendFliwrightTest(base, {
    app: async ({ page, logger }, use) => {
      await use({
        page,
        async openHome() {
          logger.info('project fixture opened home');
          return 'opened';
        },
      });
    },
  });

  test('injects project fixtures alongside core fixtures', async ({ app, page }) => {
    expect(app.page).toBe(page);
    await expect(app.openHome()).resolves.toBe('opened');
  });
});
