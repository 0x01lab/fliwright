import { mkdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const CONFIG_TEMPLATE = `import { defineConfig } from '@fliwright/cli';

export default defineConfig({
  // vmServiceUrl: 'ws://127.0.0.1:8181/ws',
  timeout: 30000,
  screenshot: 'file',
  testDir: 'tests',
  reporter: 'pretty',
});
`;

const EXAMPLE_TEST_TEMPLATE = `import { test, expect } from '@fliwright/vitest';

test('counter increments', async ({ page }) => {
  // Replace with your app's actual widgets
  const counter = page.locator('text=Count: 0');
  await expect(counter).toBeVisible();

  const button = page.locator('text=Increment');
  await button.click();

  await expect(page.locator('text=Count: 1')).toBeVisible();
});
`;

export async function initCommand(projectDir: string): Promise<void> {
  const configPath = join(projectDir, 'fliwright.config.ts');
  const testDir = join(projectDir, 'tests');
  const exampleTestPath = join(testDir, 'example.test.ts');

  try {
    await stat(configPath);
    console.log('fliwright.config.ts already exists — skipping.');
  } catch {
    await writeFile(configPath, CONFIG_TEMPLATE, 'utf8');
    console.log('Created fliwright.config.ts');
  }

  await mkdir(testDir, { recursive: true });

  try {
    await stat(exampleTestPath);
    console.log('tests/example.test.ts already exists — skipping.');
  } catch {
    await writeFile(exampleTestPath, EXAMPLE_TEST_TEMPLATE, 'utf8');
    console.log('Created tests/example.test.ts');
  }

  console.log('');
  console.log('Next steps:');
  console.log('  1. Add the bridge to your Flutter app in debug mode only:');
  console.log('     import "package:flutter/foundation.dart";');
  console.log('     import "package:fliwright_bridge/fliwright_bridge.dart";');
  console.log('     if (kDebugMode) { await FliwrightBridge.init(); }');
  console.log('  2. Start your Flutter app: flutter run');
  console.log('  3. Run tests: npx fliwright run');
}
