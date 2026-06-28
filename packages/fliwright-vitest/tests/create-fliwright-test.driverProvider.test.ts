import { describe, expect, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFliwrightTest } from '../src/index.js';

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
