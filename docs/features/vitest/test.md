---
module: "test"
package: "@fliwright/vitest"
source: "src/index.ts"
generated: "2026-06-02"
---

# test()

> Vitest test fixture with auto-managed FliwrightDriver lifecycle.

## Overview

The `test` export is a Vitest `test.extend<{ page: Page }>()` fixture. It automatically connects to the Flutter VM Service (using `FLIWRIGHT_VM_URL` env var), creates a shared `FliwrightDriver`, and provides a `page` fixture. On test failure, it writes MCP failure context to `FLIWRIGHT_MCP_FAILURE_CONTEXT_PATH`.

## Usage

```typescript
import { test, expect } from '@fliwright/vitest';

test('my test', async ({ page }) => {
  // page is auto-connected
  await page.locator({ text: 'Button' }).click();
});
```

## Custom Configuration

```typescript
import { createFliwrightTest, expect } from '@fliwright/vitest';

const test = createFliwrightTest({
  vmServiceUrl: 'ws://127.0.0.1:8181/ws',
  timeout: 10000,
  screenshot: 'file',
});
```

## Exports

| Export | Type | Description |
|--------|------|-------------|
| `test` | `TestAPI<{ page: Page }>` | Default test fixture using FLIWRIGHT_VM_URL |
| `createFliwrightTest` | `(config) => TestAPI` | Creates a test fixture with custom config |
| `defineConfig` | `(overrides) => FliwrightConfig` | Defines test configuration |
| `FliwrightConfig` | `interface` | Config type: vmServiceUrl, timeout, screenshot |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `FLIWRIGHT_VM_URL` | VM Service WebSocket URL |
| `FLIWRIGHT_MOCK_CONTROLLER_URL` | Mock controller URL for Flutter-side mocking |
| `FLIWRIGHT_MCP_FAILURE_CONTEXT_PATH` | Path to write failure context JSON |
