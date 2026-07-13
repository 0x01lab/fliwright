# Structured Logging

Use this page when a Fliwright test or script needs progress output, machine-readable run logs, debug traces, or different output modes.

## Fixture

`test` and `script` both expose `logger`:

```typescript
import { test, script } from '@fliwright/vitest';

test('login flow', async ({ page, logger }) => {
  logger.info('Open login screen');
  await page.getByText('Login').click();
  logger.success('Login screen opened', { route: '/login' });
});

script('seed account', async ({ page, logger }) => {
  logger.info('Prepare demo account');
  await page.getByText('Users').click();
  logger.warn('Using fallback seed data', { source: 'fixture' });
});
```

Prefer `logger` over `console.log` for run progress. `logger` events carry `runId`, `testName`, `mode`, timestamp, level, kind, optional structured data, and can be formatted or consumed as JSONL.

## Methods

```typescript
logger.trace(message, data?)
logger.debug(message, data?)
logger.info(message, data?)
logger.warn(message, data?)
logger.error(message, error?, data?)
logger.success(message, data?)
logger.child({ kind?, testName?, mode?, timelineNodeId? })
```

Use levels like this:

| Level | Use for |
| --- | --- |
| `trace` | Very noisy protocol or polling details |
| `debug` | Selectors, branch decisions, mock setup details |
| `info` | User-visible progress and phase changes |
| `success` | A completed business action or script milestone |
| `warn` | Recoverable fallback, optional UI absent, non-fatal diagnostic |
| `error` | Caught error or failure context before rethrowing/continuing |

## Default Output

By default, Fliwright writes structured JSONL logs to:

```text
<runsRoot>/<runId>/logs/events.jsonl
```

`<runsRoot>` 默认是 `~/.fliwright/projects/<project-slug>/runs`。也可用 `FLIWRIGHT_RUNS_ROOT` 或 `defineConfig({ runsRoot })` 手动覆盖。The terminal is quiet unless you opt in. This keeps Vitest/CLI JSON output parseable.

## Config

```typescript
import { createFliwrightTest } from '@fliwright/vitest';

const test = createFliwrightTest({
  vmServiceUrl: process.env.FLIWRIGHT_VM_URL ?? '',
  log: {
    level: 'debug',
    format: 'pretty',
    outputs: ['stderr', 'jsonl-file'],
    jsonlPath: '{runDir}/logs/events.jsonl',
  },
});
```

`FliwrightLogConfig`:

```typescript
{
  level?: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'success';
  format?: 'pretty' | 'compact' | 'jsonl' | 'silent';
  outputs?: Array<'stderr' | 'stdout' | 'file' | 'jsonl-file'>;
  filePath?: string;  // supports {runDir}
  jsonlPath?: string; // supports {runDir}
}
```

## Environment Variables

| Variable | Values | Notes |
| --- | --- | --- |
| `FLIWRIGHT_LOG_LEVEL` | `trace` \| `debug` \| `info` \| `warn` \| `error` \| `success` | Minimum emitted level |
| `FLIWRIGHT_LOG_FORMAT` | `pretty` \| `compact` \| `jsonl` \| `silent` | Stream/file formatter |
| `FLIWRIGHT_LOG_OUTPUT` | comma-separated `stderr`, `stdout`, `file`, `jsonl-file` | Default is `jsonl-file` |
| `FLIWRIGHT_LOG_FILE` | path | Pretty/file path, supports `{runDir}` |
| `FLIWRIGHT_LOG_JSONL` | path | JSONL path, supports `{runDir}` |

Examples:

```bash
FLIWRIGHT_LOG_OUTPUT=stderr,jsonl-file FLIWRIGHT_LOG_LEVEL=debug pnpm vitest run tests/login.test.ts
FLIWRIGHT_LOG_FORMAT=jsonl FLIWRIGHT_LOG_OUTPUT=stdout pnpm vitest run tests/login.test.ts
FLIWRIGHT_LOG_FORMAT=silent pnpm vitest run tests/login.test.ts
```

## Timeline Integration

`TimelineRecorder` automatically emits structured log events when timeline nodes start, pass, fail, or skip. That means `flow.step`, `flow.page`, `flow.frame`, `mock.*`, `agent.*`, and locator `expect(...)` produce log events without extra `logger` calls.

Use explicit `logger` calls for information that is not already represented by a timeline node:

- Generated account ID or fixture name.
- Which fallback branch the script selected.
- External system response summaries.
- Manual progress messages in long automation scripts.
- Non-secret debug metadata useful to an agent.

Do not log secrets, local VM URLs, tokens, passwords, or full API payloads containing private data.

## Good Pattern

```typescript
script('create demo user', async ({ page, flow, logger }) => {
  logger.info('Starting demo user creation');

  await flow.step('Open user form', async () => {
    await page.getByText('New user').click();
  });

  const email = `demo-${Date.now()}@example.com`;
  logger.debug('Generated demo email', { domain: 'example.com' });

  await flow.step('Fill user details', async () => {
    await page.getByKey('email').fill(email);
  });

  logger.success('Demo user form is filled');
});
```

## Bad Pattern

```typescript
console.log('password', password); // do not log secrets or bypass structured logs
```
