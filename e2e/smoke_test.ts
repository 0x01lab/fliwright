import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FliwrightDriver } from '@fliwright/core';

function toWsUrl(httpUrl: string): string {
  return httpUrl
    .replace('http://', 'ws://')
    .replace('https://', 'wss://')
    .replace(/\/?$/, '/ws');
}

describe('E2E Smoke Test: Remote Click', () => {
  let driver: FliwrightDriver;
  const vmServiceUrl = process.env.FLIWRIGHT_VM_SERVICE_URL;

  beforeAll(async () => {
    if (!vmServiceUrl) {
      throw new Error(
        'Set FLIWRIGHT_VM_SERVICE_URL env var to the VM Service URI from `flutter run` output.\n' +
        'Example: FLIWRIGHT_VM_SERVICE_URL="http://127.0.0.1:54321/xxxxxxxxxxxxxx/" npx vitest run e2e/smoke_test.ts',
      );
    }

    const wsUrl = toWsUrl(vmServiceUrl);
    driver = new FliwrightDriver();
    await driver.connect(wsUrl);
  });

  afterAll(async () => {
    await driver?.dispose();
  });

  it('finds and clicks the Increment button', async () => {
    // Verify initial state: counter shows 0
    const counter0 = driver.page.locator('text=Count: 0');
    await expect(counter0.isVisible()).resolves.toBe(true);

    // Click the increment button
    const button = driver.page.locator('text=Increment');
    await button.click();

    // Wait for and verify state change: counter shows 1
    const counter1 = await driver.page.waitFor('text=Count: 1', 3000);
    await expect(counter1.isVisible()).resolves.toBe(true);
  });
});
