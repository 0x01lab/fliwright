# Timeline-Native Scripts

Use this page when writing new Fliwright scripts with `flow`, `mock`, `agent`, timeline-aware locator `expect`, or when cleaning generated code with `timeline: true`.

## Choose `test` Or `script`

```typescript
import { test, script, expect } from '@fliwright/vitest';
```

| Runner | Use for | Fixture shape |
| --- | --- | --- |
| `test` | E2E verification that should pass/fail in CI | `{ page, driver, flow, mock, agent, aiRuntime, timeline, logger }` |
| `script` | Automation tasks, account setup, data entry, cleanup flows | `{ page, driver, flow, mock, agent, aiRuntime, timeline, logger }` |

Both write `<runsRoot>/<runId>/timeline.json` and `<runsRoot>/<runId>/logs/events.jsonl`. `<runsRoot>` 默认是 `~/.fliwright/projects/<project-slug>/runs`，也可通过 `FLIWRIGHT_RUNS_ROOT` 或 `defineConfig({ runsRoot })` 覆盖。`test` can require at least one timeline assertion when configured with `requireAssertions`; `script` never requires assertions.

## Standard Test Shape

```typescript
import { test, expect } from '@fliwright/vitest';
import { expect as viExpect } from 'vitest';

test('registers a user', async ({ page, flow, mock, logger }) => {
  logger.info('Starting registration test');

  await mock.rules('Use successful registration API', async () => {
    await mock.clearRoutes();
    await mock.clearCalls();
    await mock.route('/api/register', {
      method: 'POST',
      status: 200,
      body: { success: true, message: '注册成功' },
    });
  });

  await flow.page('Register page', { route: '/register' }, async () => {
    await page.navigate('/register');
    await expect(page.getByText('请输入手机号'), 'Phone field is visible').toBeVisible();
  });

  await flow.step('Fill registration form', async () => {
    await page.formHelper.fill({ skipObscureFields: false });
  });

  await flow.step('Submit registration', async () => {
    await page.getByText('提交').click();
  });

  await expect(page.getByText('注册成功'), 'Registration succeeded').toBeVisible();

  const calls = await mock.findCalls({ method: 'POST', path: '/api/register' });
  viExpect(calls.length).toBeGreaterThanOrEqual(1);
});
```

## Standard Automation Script Shape

```typescript
import { script } from '@fliwright/vitest';

script('auto register fill', async ({ page, flow, mock, agent, logger }) => {
  logger.info('Starting auto registration fill');

  await flow.page('Register page', { route: '/register' }, async () => {
    await page.navigate('/register');
  });

  const user = await agent.generate('Generate deterministic registration data', {
    schema: {
      type: 'object',
      properties: {
        phone: { type: 'string' },
        password: { type: 'string' },
      },
      required: ['phone', 'password'],
    },
    fallback: { phone: '13800138000', password: 'Passw0rd!' },
  });

  await flow.step('Fill phone', async () => {
    await page.getByText('请输入手机号').fill(user.phone);
  });

  await flow.frame('Registration form filled', {
    screenshot: true,
    snapshot: true,
    diagnostics: true,
  });

  logger.success('Registration form filled');
});
```

## `flow` Runtime

Every `flow.*` call creates a timeline node. Use titles that describe user intent, not implementation details.

```typescript
await flow.step(title, async () => { ... }, metadata?)
await flow.page(title, { route?, metadata? }, async () => { ... })
await flow.page(title, async () => { ... })
await flow.branch(title, metadata, async () => { ... })
await flow.optional(title, { when }, async () => { ... })
await flow.frame(title, { screenshot?, snapshot?, diagnostics?, metadata? })
await flow.manual(title, { message?, timeoutMs?, pollIntervalMs?, metadata?, resumeWhen? })
await flow.assertion(title, async () => { ... }, metadata?)
```

Guidance:

- Put one coherent user action per `flow.step`: fill a field, tap submit, switch tab, open menu.
- Use `flow.page` when entering or validating a screen/route.
- Use `flow.optional` for genuinely optional UI, such as dismissing a popup only when it exists.
- Use `flow.frame` to leave artifacts in automation scripts even when there is no assertion.
- Use `flow.manual` when the script must pause for human work such as a captcha drag, QR-code login, SMS code, or external approval. **If the manual work is an Aliyun/人机校验 slider or any non-Flutter overlay, read [captcha.md](./captcha.md) first** — those components are invisible to `getByKey`/`getByText`/`snapshot` and the only reliable way through is `flow.manual({ resumeWhen })` (do not try to bypass via `state.override`).
- For manual work performed inside the running app, prefer `resumeWhen` and make the runtime observe the post-manual app state. Do not depend on terminal stdin, VS Code buttons, or external `continue` files for this path.
- Prefer `expect(locator, title?).to*` for locator assertions; reserve `flow.assertion` for custom non-locator checks that need a timeline node.

```typescript
await flow.manual('Complete captcha', {
  message: 'Please complete the slider captcha in the running app.',
  timeoutMs: 180_000,
  pollIntervalMs: 700,
  resumeWhen: async () => page.getByText('Verification required', { exact: true }).isVisible(),
});
await expect(page.getByText('Verification required'), 'Verification page is visible').toBeVisible();
await flow.step('Fill verification code', async () => {
  await page.getByType('EditableText').first({ visible: true }).fill('000000');
});
```

Manual-step pattern:

- First identify the concrete app state that proves the human action finished, such as a route-specific title, a newly visible form, or a success page.
- Pass that state check as `resumeWhen`; keep it narrow enough that the script cannot continue just because the original captcha or QR overlay disappeared.
- Continue the automated flow immediately after the manual node. For example, after a slider captcha sends the app to a two-factor page, wait for the exact title and fill the OTP input.
- If the manual action happens outside the Flutter app and no app state can prove completion, introduce a product-visible confirmation state where possible. External terminal input should not be the primary design for app-based manual work.

## Structured `logger`

Use `logger` for progress, non-secret diagnostic metadata, and business facts that are not already represented by a timeline node.

```typescript
logger.debug('Generated fixture data', { role: 'demo-user' });
logger.info('Open settings screen');
logger.warn('Optional onboarding modal was absent');
logger.error('Failed to load optional seed data', error);
logger.success('Settings screen is ready');
```

Automatic timeline events are already logged for `flow`, `mock`, `agent`, and locator `expect` nodes. Add explicit `logger` calls for high-level script readability and facts an agent may need later. See [logging.md](./logging.md).

## Timeline-Aware `expect`

`expect(locator, title?).to*` records an `assertion` node, captures screenshot/snapshot on failure, and throws a `FliwrightAgentError` with an agent-visible failure.

```typescript
await expect(locator, title).toBeVisible(options?)
await expect(locator, title).toHaveText(expected, options?)
await expect(locator, title).toContainText(expected, options?)
await expect(locator, title).toBeEnabled(options?)
await expect(locator, title).toBeDisabled(options?)
await expect(locator, title).not.toBeVisible(options?)
```

`AssertionOptions`:

```typescript
{ timeout?: number; title?: string; includeScreenshot?: boolean; includeSnapshot?: boolean }
```

Use the second `title` argument for readability:

```typescript
await expect(page.getByText('注册成功'), 'Registration succeeded').toBeVisible();
```

## `mock` Runtime

`mock` is a timeline-aware facade over `driver.mock`.

```typescript
await mock.rules(title, async () => { ... })
await mock.loadRules(mockDir?)
await mock.switchRule(endpoint, ruleName, method?)
await mock.route(path, { method?, status, body, headers?, delay?, id? })
await mock.routeFlutter(path, response)
await mock.removeRoute(path, method?)
await mock.clearRoutes()
await mock.clearCalls()
await mock.setPassthrough(enabled)
const calls = await mock.getCalls(path?)
const routes = await mock.listRoutes()
const rules = mock.listRules()
const matches = await mock.findCalls({ method?, path?, url?, headers?, body? })
```

For request assertions, read calls through `mock.findCalls` / `mock.getCalls` and use Vitest `expect`:

```typescript
import { expect as viExpect } from 'vitest';

const calls = await mock.findCalls({ method: 'POST', path: '/api/register' });
viExpect(calls.length).toBeGreaterThanOrEqual(1);
```

## `agent` Runtime

`agent` wraps explicit AI calls and records them as `ai-call` nodes. Keep CI deterministic with `provider: 'mock'` or a `fallback`.

```typescript
await agent.ask(titleOrPrompt, request?)
await agent.generate<T>(titleOrPrompt, { schema?, fallback?, prompt? })
await agent.verify(prompt, { includeScreenshot?, includeSnapshot?, timeoutMs? })
await agent.inspect<T>(titleOrPrompt, { schema?, prompt?, includeScreenshot?, includeSnapshot? })
```

Never hide AI use inside ordinary helper functions. If a script depends on AI, make the `agent.*` call visible in the top-level flow.

## Timeline Inspection

After `fliwright run --reporter ai-json`, reports include timeline paths. MCP tools can inspect them:

```text
fliwright_timeline_get({ path?, runId?, nodeId?, includeArtifacts? })
fliwright_agent_diagnose({ path?, runId?, failureIndex?, failure? })
```

For local debugging, open `<runsRoot>/<runId>/timeline.json`（默认在 `~/.fliwright/projects/<project-slug>/runs/`） and inspect `agentVisibleFailures`, failed nodes, and artifact paths.

For chronological log events, read `<runsRoot>/<runId>/logs/events.jsonl`（路径同上） or enable live output with:

```bash
FLIWRIGHT_LOG_OUTPUT=stderr,jsonl-file FLIWRIGHT_LOG_LEVEL=debug pnpm vitest run tests/login.test.ts
```
