---
module: "test"
package: "@fliwright/vitest"
source: "src/index.ts"
generated: "2026-06-02"
---

# `test` / `createFliwrightTest`

> Vitest `test()` extended with a `page` fixture that lazily provisions a shared `FliwrightDriver` and tears it down on process exit.

## Overview

The vitest integration exposes a `test` function (re-exported `vitest.test`) pre-configured with a `{ page }` fixture backed by a shared driver. The driver is created on first use, connected to the VM Service URL in `config.vmServiceUrl` (or `process.env.FLIWRIGHT_VM_URL` for the default export), and reused for every subsequent test. For multi-app or per-process isolation, call `createFliwrightTest(config)` to mint a fresh `test` bound to a different URL.

## Signature

```typescript
export interface FliwrightConfig {
  vmServiceUrl: string;
  timeout?: number;          // default: 5000 — passed to FailureCollector.collect()
  screenshot?: 'file' | 'base64' | 'off'; // default: 'file'
}

export function defineConfig(
  overrides: Partial<FliwrightConfig> & { vmServiceUrl: string },
): FliwrightConfig;

export function createFliwrightTest(config: FliwrightConfig): TestFn<{ page: Page }>;

export const test: TestFn<{ page: Page }>;
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `config.vmServiceUrl` | `string` | Yes | WebSocket URL of the Flutter VM Service (e.g. `ws://127.0.0.1:8181/ws`). |
| `config.timeout` | `number` | No | Default: `5000`. Used as the collection timeout when a test fails and MCP failure context is enabled. |
| `config.screenshot` | `'file' \| 'base64' \| 'off'` | No | Default: `'file'`. Screenshot mode forwarded to the failure collector. |

## Options

### `page` fixture

Auto-injected into every test callback. Resolves to the shared `FliwrightDriver`'s `page` property.

- **Behavior:** On the first test that runs, creates a `FliwrightDriver`, calls `connect(vmServiceUrl)`, and stores it in a module-level `sharedDriver`. Subsequent tests reuse the same connection.
- **Per-test isolation:** The `page` fixture runs the test body inside an `AsyncLocalStorage` context that exposes `{ driver, testName }` so `expect()` can attach healing metadata and write failure entries.
- **Failure capture:** If the body throws, `writeMcpFailureContext()` is invoked before re-throwing. If `FLIWRIGHT_MCP_FAILURE_CONTEXT_PATH` is unset, this is a no-op.
- **Returns:** `Promise<Page>` (via the `use(page)` callback).

**Example:**

```typescript
import { test, expect } from '@fliwright/vitest';

test('signs in', async ({ page }) => {
  await page.locator('text=Sign in').click();
  await expect(page.locator('text=Welcome')).toBeVisible();
});
```

### `createFliwrightTest(config)`

Factory for a custom `test` bound to a specific `vmServiceUrl`. Useful when you need a different app instance per test file or want to pass non-default `timeout`/`screenshot` settings.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `config` | `FliwrightConfig` | Yes | Must include `vmServiceUrl`. |

**Returns:** A Vitest `test` function with the `{ page }` fixture pre-wired.

**Example:**

```typescript
import { createFliwrightTest, expect } from '@fliwright/vitest';

const test = createFliwrightTest({
  vmServiceUrl: 'ws://127.0.0.1:8888/ws',
  timeout: 10000,
  screenshot: 'base64',
});

test('hits the staging app', async ({ page }) => {
  await expect(page.locator('text=Staging')).toBeVisible();
});
```

### `defineConfig(overrides)`

Convenience helper for constructing a `FliwrightConfig` with defaults applied.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `overrides.vmServiceUrl` | `string` | Yes | VM Service URL. |
| `overrides.timeout` | `number` | No | Default: `5000`. |
| `overrides.screenshot` | `'file' \| 'base64' \| 'off'` | No | Default: `'file'`. |

**Returns:** `FliwrightConfig`

## Auto-Driver Lifecycle

1. **First test starts** → fixture checks `sharedDriver`; if `null`, instantiates `new FliwrightDriver()` and `await connect(config.vmServiceUrl)`.
2. **Test body executes** inside `AsyncLocalStorage` with `{ driver, testName }` on the store.
3. **Body throws** → `writeMcpFailureContext(error, driver, testName, timeout)` runs, then the error is re-thrown to Vitest.
4. **Body succeeds** → Vitest moves to the next test; the shared driver persists.
5. **Process exit** → Vitest tears down; no explicit `disconnect()` is invoked by `test()` (the driver's process exit hook handles cleanup). For explicit control, use [setup.md](./setup.md) instead.

The default `test` export reads `process.env.FLIWRIGHT_VM_URL` at import time:

```typescript
export const test = createFliwrightTest({
  vmServiceUrl: process.env.FLIWRIGHT_VM_URL ?? '',
});
```

If `FLIWRIGHT_VM_URL` is unset and no `vmServiceUrl` is provided, the first test will throw `No VM Service URL provided. Set FLIWRIGHT_VM_URL or use createFliwrightTest({ vmServiceUrl }).`

## Related

- **Depends on:** [`@fliwright/core` FliwrightDriver](../core/FliwrightDriver.md), [Assertion / createExpect](../core/Assertion.md), [FailureCollector](../core/FailureCollector.md)
- **Used by:** [`@fliwright/cli` run command](../cli/run.md) (sets `FLIWRIGHT_VM_URL` and `FLIWRIGHT_MCP_FAILURE_CONTEXT_PATH` before invoking Vitest)
- **Companion modules:** [expect.md](./expect.md), [setup.md](./setup.md), [reporter.md](./reporter.md)
- **Source:** `packages/fliwright-vitest/src/index.ts`
