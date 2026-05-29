import { test as vitestTest } from 'vitest';
import { FliwrightDriver, createExpect } from '@fliwright/core';
import type { Page } from '@fliwright/core';

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

export function createFliwrightTest(config: FliwrightConfig) {
  const fliwrightTest = vitestTest.extend<{ page: Page }>({
    page: async ({}, use) => {
      if (!sharedDriver) {
        sharedDriver = new FliwrightDriver();
        await sharedDriver.connect(config.vmServiceUrl);
      }
      await use(sharedDriver.page);
    },
  });

  return fliwrightTest;
}

export { createExpect as expect };
