# Fliwright Test Authoring Reference

Use this reference when writing or repairing Fliwright test scripts.

## Contents

- Vitest fixture
- Selectors and locators
- Actions
- Assertions
- Snapshots and refs
- Form helper
- Mocks
- Manual driver lifecycle
- MCP-assisted workflow
- Validation commands

## Vitest Fixture

Recommended imports for normal test files:

```typescript
import { test, expect } from '@fliwright/vitest';
```

The default `test` export:

- reads `process.env.FLIWRIGHT_VM_URL`, with `FLIWRIGHT_VM_SERVICE_URL` as a compatibility fallback
- creates one shared `FliwrightDriver`
- connects to the Flutter VM Service
- provides `{ page, driver }`
- writes MCP/CLI failure context when `FLIWRIGHT_MCP_FAILURE_CONTEXT_PATH` is set
- captures assertion details, widget tree, screenshot, recent diagnostics, source location, and healing suggestions on failure
- configures the Flutter mock controller when `FLIWRIGHT_MOCK_CONTROLLER_URL` is set

Use custom config when the test needs explicit VM URL handling:

```typescript
import { createFliwrightTest, defineConfig, expect } from '@fliwright/vitest';

const test = createFliwrightTest(defineConfig({
  vmServiceUrl: process.env.FLIWRIGHT_VM_URL ?? '',
  timeout: 10_000,
  screenshot: 'file',
}));
```

## Selectors and Locators

Preferred selector APIs:

```typescript
page.getByKey('loginButton');
page.getByText('Log in');
page.getByText(/log in/i);
page.getByType('ElevatedButton');
page.getBySemantics({ label: 'Log in', role: 'button' });
page.locator({ text: 'Log in' });
page.locator({ key: 'loginButton' });
page.locator({ type: 'ElevatedButton' });
page.locator('text=Log in');
```

String selector formats:

| Format | Example |
| --- | --- |
| `text=<value>` | `text=Submit` |
| `textContains=<value>` | `textContains=Sub` |
| `key=<value>` | `key=submitButton` |
| `type=<value>` or `byType=<value>` | `type=ElevatedButton` |
| `semantics=<value>` | `semantics=Email address` |
| `role=<value>` | `role=button` |
| plain string | treated as exact text |
| RegExp | text regex |

Scoping and disambiguation:

```typescript
const form = page.getByType('LoginForm');
await form.getByText('Email').fill('alice@example.com');
await page.getByText('Save').and({ type: 'ElevatedButton' }).click();
await page.getByType('TextField').nth(1).fill('secret');
await page.locator({ text: 'Submit' }).ancestor({ type: 'Form' }).click();
```

Prefer stable keys and semantics over broad widget types. Use text selectors when the text is visible and part of the user contract.

## Actions

Locator actions:

```typescript
await page.getByText('Continue').click();
await page.getByText('Delete').longPress({ duration: 700 });
await page.getByType('Slider').drag(120, 0, { steps: 12 });
await page.getByType('InteractiveViewer').pinch(1.25);
await page.getByKey('email').fill('alice@example.com');
await page.getByKey('search').type('hello');
await page.getByText('Checkout').scrollIntoView();
```

Use `fill()` to replace existing text and `type()` to append/type. Use coordinate drag only when testing gesture surfaces that cannot be represented by a widget locator:

```typescript
await page.dragFrom(120, 420, 0, -280, { steps: 16 });
```

## Assertions

Fliwright assertions auto-wait and can use self-healing:

```typescript
await expect(page.getByText('Welcome')).toBeVisible();
await expect(page.getByKey('submit')).toBeEnabled({ timeout: 10_000 });
await expect(page.getByText('Saved')).toContainText('Saved');
await expect(page.getByKey('passwordError')).not.toBeVisible();
```

Available matchers:

- `toBeVisible(options?: { timeout?: number })`
- `toHaveText(text: string, options?: { timeout?: number })`
- `toContainText(text: string, options?: { timeout?: number })`
- `toBeEnabled(options?: { timeout?: number })`
- `toBeDisabled(options?: { timeout?: number })`
- `.not` negation

For boolean checks outside the Fliwright assertion wrapper:

```typescript
import { expect as viExpect } from 'vitest';

viExpect(await page.getByText('Ready').count()).toBe(1);
```

## Snapshots and Refs

Use snapshots for exploration, debugging, or selectors returned by MCP tools. This requires the current bridge with `ext.fliwright.snap`; if the VM returns `Unknown method "ext.fliwright.snap"`, upgrade/rebuild the app before using ref-based flows.

```typescript
const snap = await page.snapshot({ depth: 4, includeRects: true });
const firstRef = snap.refs[0]?.ref;
if (firstRef) {
  await page.ref(firstRef).click();
}
```

Use `findRef()` when a current semantic snapshot is more precise than a selector:

```typescript
await (await page.findRef({ text: 'Confirm', role: 'button' })).click();
```

Do not hard-code `e<N>` refs in committed tests unless the test captures the snapshot in the same run.

Bridge capability checklist:

| Capability | Required for |
| --- | --- |
| `ext.fliwright.snap` | `page.snapshot()`, `page.findRef()`, `fliwright_snap`, `fliwright_observe` |
| `ext.fliwright.action` | ref-backed tap/type/wait/actionability |
| `ext.fliwright.extractForm` | `page.formHelper.analyze()`, `fill()`, `fillFields()` |
| `ext.fliwright.screenshot` | AI run report screenshots |
| mock extensions | `driver.mock` and tool-side mock server integration |

For Flutter app setup, initialize the current bridge in debug builds:

```dart
import 'package:flutter/foundation.dart';
import 'package:fliwright_bridge/fliwright_bridge.dart';

if (kDebugMode) {
  await FliwrightBridge.init();
}
```

## Form Helper

Use `page.formHelper` for complex forms after the driver/page is connected:

```typescript
const analysis = await page.formHelper.analyze();
const result = await page.formHelper.fill({ skipObscureFields: true });
const selected = await page.formHelper.fillFields(['Email', 'Phone'], {
  skipObscureFields: false,
});
```

Good use cases:

- smoke testing that every enabled field can be filled
- generating realistic fake data
- avoiding brittle individual field selectors in large forms

Prefer explicit locators for business-critical fields where exact values matter.

## Mocks

Use `driver.mock` from the `@fliwright/vitest` driver fixture, or configure the mock controller through environment. Raw `FliwrightDriver` lifecycle is only needed for legacy bridge scripts or custom plugin setup.

Common fixture mock pattern:

```typescript
import { test } from '@fliwright/vitest';
import { expect } from 'vitest';

test('submits through mocked API', async ({ page, driver }) => {
  await driver.mock.clear();
  await driver.mock.clearCalls();
  await driver.mock.route('/api/login', {
    method: 'POST',
    status: 200,
    body: { token: 'test-token', name: 'Alice' },
  });

  await page.getByKey('loginButton').click();

  const calls = await driver.mock.getCalls('/api/login');
  expect(calls.length).toBeGreaterThanOrEqual(1);
});
```

Raw-driver mock pattern:

```typescript
await driver.mock.clear();
await driver.mock.clearCalls();
await driver.mock.route('/api/login', {
  method: 'POST',
  status: 200,
  body: { token: 'test-token', name: 'Alice' },
});

const calls = await driver.mock.getCalls('/api/login');
```

Available operations include route, remove route, clear, list routes, set passthrough, get calls, clear calls, load rules, and switch rule.

## Manual Driver Lifecycle

Use this for advanced E2E tests, custom plugin setup, or older bridge compatibility. Prefer `@fliwright/vitest` for normal scripts.

```typescript
import { beforeAll, afterAll, describe, it } from 'vitest';
import { FliwrightDriver } from '@fliwright/core';

let driver: FliwrightDriver;

beforeAll(async () => {
  driver = new FliwrightDriver();
  await driver.connect(process.env.FLIWRIGHT_VM_URL!);
});

afterAll(async () => {
  await driver?.dispose();
});
```

`FliwrightDriver` exposes:

- `page`
- `mock`
- `healing`
- `recorder`
- `state` for Riverpod when the bridge/plugin is configured
- `sendRequest(method, params)` for custom VM Service extensions
- `reloadSources()`

If an existing script uses `FLIWRIGHT_VM_SERVICE_URL` from Flutter output, convert HTTP to WebSocket before `connect()`:

```typescript
function toWsUrl(httpUrl: string): string {
  return httpUrl.replace('http://', 'ws://').replace('https://', 'wss://').replace(/\/?$/, '/ws');
}
```

## MCP-Assisted Workflow

When MCP tools are available:

- Use `fliwright_connect`, `fliwright_snap`, and `fliwright_observe` to confirm the current bridge and inspect visible targets.
- Use `fliwright_record` to capture a flow, then simplify selectors and add assertions.
- Use `fliwright_generate_test` with `refs` or `snapshot` for a first draft that uses `page.findRef(...)` queries instead of hard-coded ephemeral refs.
- Use `fliwright_run` to execute a test against a running VM Service and get the same AI report shape as CLI `fliwright run --reporter ai-json`.
- Use `fliwright_get_failure` after a failed run for assertion details, widget tree, diagnostics, screenshot artifact, source, and healing suggestions.

## Validation Commands

Static validation:

```bash
pnpm lint
pnpm --filter @fliwright/vitest test
pnpm --filter @fliwright/core test
```

Live app validation:

```bash
fliwright run --test path/to/test.ts --vm-url "ws://127.0.0.1:54321/xxxxxxxxxxxxxx/ws" --reporter ai-json
```

MCP validation:

```text
fliwright_run({
  testFile: "path/to/test.ts",
  vmServiceUrl: "ws://127.0.0.1:54321/token/ws",
  screenshot: "file"
})
```

Direct Vitest validation is still useful for quick smoke checks:

```bash
FLIWRIGHT_VM_URL="ws://127.0.0.1:54321/xxxxxxxxxxxxxx/ws" pnpm vitest run path/to/test.ts
```

If the app crashes, the VM returns unstable screenshot/assertion errors, or bridge methods are missing, stop live testing and ask for the app to be restarted or upgraded.
