# Test Harness: `@fliwright/vitest`

How to wire the driver into your test. **Prefer the default fixture** for normal scripts; reach for
`createFliwrightTest` only when you need custom config, and for raw `FliwrightDriver` only for
custom plugins / raw extensions / legacy-bridge compatibility.

## Imports

```typescript
import { test, expect } from '@fliwright/vitest';
```

Also re-exported from the package: `createFliwrightTest`, `defineConfig`, `beforeEach`,
`afterEach`, `beforeAll`, `afterAll`, `describe`.

## The default `test` fixture

```typescript
test('name', async ({ page, driver }) => { /* … */ });
```

What it does for you:

| Concern | Behavior |
| --- | --- |
| VM URL | reads `process.env.FLIWRIGHT_VM_URL`, falls back to `FLIWRIGHT_VM_SERVICE_URL`; HTTP→WS conversion is automatic |
| Driver | one **shared** `FliwrightDriver` per process, lazily created & connected |
| Fixtures | provides `{ page, driver }` |
| Diagnostics | starts `driver.listenToDiagnostics()` so logs/stderr are captured for failure reports |
| Failure context | when `FLIWRIGHT_MCP_FAILURE_CONTEXT_PATH` is set, writes assertion details + widget tree + screenshot + diagnostics + source + healing suggestion |
| Trace | when `FLIWRIGHT_TRACE_DIR` + `FLIWRIGHT_TRACE` are set, records per-action traces (see [driver-lifecycle.md](./driver-lifecycle.md)) |
| Screenshot mode | controlled by `FLIWRIGHT_SCREENSHOT_MODE` |

The `driver` fixture is what you use for mocks and state — prefer it over raw lifecycle code:

```typescript
test('submits through mocked API', async ({ page, driver }) => {
  await driver.mock.clear();
  await driver.mock.route('/api/login', { method: 'POST', status: 200, body: { token: 't' } });
  await page.getByKey('loginButton').click();
});
```

## Custom config: `createFliwrightTest` + `defineConfig`

Use when a file must hard-code/transform the VM URL, change the timeout, or disable screenshots.

```typescript
import { createFliwrightTest, defineConfig, expect } from '@fliwright/vitest';

const test = createFliwrightTest(defineConfig({
  vmServiceUrl: process.env.FLIWRIGHT_VM_URL ?? '',
  timeout: 10_000,
  screenshot: 'file',
}));
```

`FliwrightConfig` shape:

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `vmServiceUrl` | `string` | *(required)* | HTTP or WS URL; converted to `ws://…/ws` |
| `timeout` | `number` | `5000` | default assertion / failure timeout in ms |
| `screenshot` | `'file' \| 'base64' \| 'off'` | `'file'` | how failure screenshots are serialized |

```typescript
export function defineConfig(overrides: Partial<FliwrightConfig> & { vmServiceUrl: string }): FliwrightConfig
```

`defineConfig` fills defaults (`timeout: 5000`, `screenshot: 'file'`) and applies your overrides.

## Hooks

The package re-exports hooks typed for the `{ page }` context:

```typescript
import { test, beforeEach, afterEach } from '@fliwright/vitest';

beforeEach(async ({ page }) => {
  await page.navigate('/');        // reset to a known route before each test
});

afterEach(async ({ page }) => {
  // optional teardown
});
```

`beforeEach` / `afterEach` receive `{ page }`; `beforeAll` / `afterAll` are re-exported from Vitest
as-is (no Fliwright context). `describe` is also re-exported.

## `expect` (Fliwright assertion)

`expect(locator)` returns an `Assertion` (Playwright-style auto-wait). It pulls the active driver
from the test context so self-healing and failure capture are wired automatically:

```typescript
await expect(page.getByText('Welcome')).toBeVisible();
await expect(page.getByKey('submit')).toBeEnabled({ timeout: 10_000 });
await expect(page.getByText('Saved')).toContainText('Saved');
await expect(page.getByKey('passwordError')).not.toBeVisible();
```

For raw boolean checks outside the Fliwright wrapper, import Vitest's `expect`:

```typescript
import { expect as viExpect } from 'vitest';
viExpect(await page.getByText('Ready').count()).toBe(1);
```

Full matcher list and behavior → [assertions.md](./assertions.md).

## Environment variable reference

| Variable | Purpose |
| --- | --- |
| `FLIWRIGHT_VM_URL` | Flutter VM Service URL (HTTP or WS). Primary. |
| `FLIWRIGHT_VM_SERVICE_URL` | Compatibility alias for the URL above. |
| `FLIWRIGHT_SCREENSHOT_MODE` | `file` \| `base64` \| `off`. Used by default `test`. |
| `FLIWRIGHT_FAILURE_TIMEOUT_MS` | Per-test failure/assertion timeout for the default `test`. |
| `FLIWRIGHT_MCP_FAILURE_CONTEXT_PATH` | File path to append failure-context JSON (set by `fliwright run`). |
| `FLIWRIGHT_MOCK_CONTROLLER_URL` | WebSocket URL of a tool-side mock controller. |
| `FLIWRIGHT_TRACE` | Trace mode: `full` \| `on-failure` \| `off`. |
| `FLIWRIGHT_TRACE_DIR` | Directory to write per-test trace artifacts. |

## Auto-skip when no VM URL

Tests that need a live app should skip cleanly when no URL is configured, so the suite still runs in CI:

```typescript
// e2e — skips the whole suite unless a VM URL is present
const hasVmUrl = Boolean(process.env.FLIWRIGHT_VM_URL ?? process.env.FLIWRIGHT_VM_SERVICE_URL);
const liveTest = test.skipIf(!hasVmUrl);

liveTest('fills the form', async ({ page }) => { /* … */ });
```

or wrap a `describe`:

```typescript
describe.skipIf(!vmServiceUrl)('Exio app live E2E', () => { /* … */ });
```

## When to bypass the fixture

Use raw `FliwrightDriver` (see [driver-lifecycle.md](./driver-lifecycle.md)) only when you need:

- **custom plugins** passed to `new FliwrightDriver({ plugins: [...] })`,
- **raw VM Service extensions** (`ext.fliwright.extractForm`, `ext.fliwright.snapshot`) — typically for older bridges,
- **deliberately low-level** coordinate/extension tests.

Always call `await driver.dispose()` in `afterAll`.
