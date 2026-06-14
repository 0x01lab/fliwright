# AI Runtime Tools Design

**Date**: 2026-06-14
**Status**: Awaiting written spec review
**Scope**: `@fliwright/core`, `@fliwright/vitest`, optional CLI diagnostics

## Goal

Add first-class `ai.*` helpers that let Fliwright tests call AI capabilities at
runtime. The initial feature focuses on two test-time loops:

1. Generate structured test data from a prompt.
2. Inspect the current Flutter UI screenshot, optionally with a semantic
   snapshot, and assert or extract visual state.

This complements the existing MCP loop. MCP lets an external agent drive
Fliwright; `ai.*` lets a Fliwright test ask an AI provider for data or
judgement while the test is running.

## Priorities

The recommended first implementation is a reusable AI runtime in
`@fliwright/core`, with a thin `@fliwright/vitest` fixture that injects the
current page, driver, test name, and run id.

Other approaches were considered:

| Approach | Trade-off |
| --- | --- |
| Core AI runtime + adapter + Vitest fixture | Best API ergonomics and long-term package boundary. Requires careful adapter and artifact design. |
| Reverse MCP communication from tests | Fits the existing agent model, but is too complex for the first runtime API and depends on more host capabilities. |
| Pre-generated CLI files | Simple and CI-friendly, but does not support live screenshot inspection at the point where a test is executing. |

## Non-Goals

- Do not let `ai.*` edit test code or application code during the test.
- Do not build a persistent multi-turn agent session in the first slice.
- Do not make MCP the runtime transport for the first slice.
- Do not send source files or workspace trees by default.
- Do not require real Claude or Codex CLI calls in default tests.

## Public API

The high-level API is exposed through an `ai` object:

```typescript
test('ai assisted signup', async ({ page, ai }) => {
  const user = await ai.generate({
    prompt: 'Generate a mainland China ecommerce signup user.',
    schema: {
      type: 'object',
      properties: {
        phone: { type: 'string' },
        password: { type: 'string' },
        address: { type: 'string' },
      },
      required: ['phone', 'password', 'address'],
    },
  });

  await page.getByText('Phone').fill(user.phone);
  await ai.visible('The page shows signup success and no red error message.');
});
```

### Methods

```typescript
ai.ask(input): Promise<AiResponse>;
ai.generate<T = unknown>(input): Promise<T>;
ai.visible(prompt, options?): Promise<void>;
ai.inspect<T = unknown>(input): Promise<T>;
ai.classify(input): Promise<string>;
```

`ai.ask()` is the low-level primitive. It returns text, parsed JSON when
available, and adapter metadata.

`ai.generate()` requests structured JSON. The MVP supports JSON Schema runtime
validation. Zod integration can be added later if it does not leak an unwanted
public dependency into `@fliwright/core`.

`ai.visible()` is assertion-like. It captures the current screenshot by default,
optionally includes `page.snapshot()`, expects `{ pass: boolean, reason: string
}` from the provider, and throws `AiAssertionError` when `pass` is false.

`ai.inspect()` captures visual/page context and returns structured data. It is
the escape hatch when callers want a boolean result instead of an assertion.

`ai.classify()` returns one label from a caller-provided choice list.

## Core Types

```typescript
export interface AiRuntimeContext {
  page?: Page;
  driver?: FliwrightDriver;
  testName?: string;
  runId?: string;
  cwd?: string;
}

export interface AiRequest {
  prompt: string;
  system?: string;
  responseFormat?: 'text' | 'json';
  schema?: JsonSchema;
  images?: AiImageInput[];
  files?: AiFileInput[];
  timeoutMs?: number;
  temperature?: number;
  metadata?: Record<string, unknown>;
}

export interface AiAdapter {
  readonly name: string;
  invoke(request: AiRequest, context: AiInvocationContext): Promise<AiAdapterResponse>;
}

export interface AiAdapterResponse {
  text: string;
  json?: unknown;
  raw?: unknown;
  metadata?: {
    model?: string;
    usage?: unknown;
    providerRequestId?: string;
  };
}
```

The runtime owns parsing, schema validation, assertion behavior, artifact
writing, caching, and error normalization. Adapters only invoke a provider and
return provider output.

## Package Structure

```text
packages/fliwright-core/src/ai/
  AiRuntime.ts
  AiArtifactStore.ts
  AiSchemaValidator.ts
  errors.ts
  types.ts
  adapters/
    MockAiAdapter.ts
    CliJsonAdapter.ts
    ClaudeCliAdapter.ts
    CodexCliAdapter.ts

packages/fliwright-vitest/src/index.ts
  createFliwrightTest({ ai })
  test fixture: { page, driver, ai }
```

`@fliwright/core` owns the reusable AI system. `@fliwright/vitest` binds that
system to the current test context through the existing `AsyncLocalStorage`
pattern.

## Adapter Design

The first real adapters target Claude and Codex CLI through child processes:

```typescript
new ClaudeCliAdapter({
  command: 'claude',
  args: [],
  cwd,
});

new CodexCliAdapter({
  command: 'codex',
  args: ['exec', '--json'],
  cwd,
});
```

Adapters must use `spawn(command, args)` and never shell string execution.
Configuration accepts a command plus an argument array, not arbitrary shell
scripts.

The first slice uses stateless invocation: one AI call starts one child process.
Persistent sessions are deferred until the basic contract is stable.

The generic CLI adapter contract is:

1. Write the full normalized request to a temporary `request.json`.
2. Send the prompt or request path through the configured input mode.
3. Read stdout and stderr.
4. Parse pure JSON output or one JSON fenced block when JSON is required.
5. On parse or exit failure, preserve artifacts and throw a typed error.

This keeps Claude and Codex differences behind small adapter classes while
still allowing a `custom-cli` adapter later.

## Runtime Data Flow

```text
test({ page, ai })
  -> ai.generate()/visible()/inspect()
  -> AiRuntime
  -> collect context: screenshot, snapshot, testName, cwd, metadata
  -> AiAdapter.invoke()
  -> parse, validate, assert
  -> write artifacts
  -> return value or throw typed error
```

`ai.generate()` does not capture screenshots by default. `ai.visible()` and
`ai.inspect()` capture a screenshot by default and can include a semantic
snapshot:

```typescript
await ai.visible('The payment success page is displayed.', {
  includeSnapshot: true,
  screenshot: { pixelRatio: 1 },
});
```

## Configuration

Programmatic configuration:

```typescript
const test = createFliwrightTest({
  vmServiceUrl,
  ai: {
    provider: 'codex',
    timeoutMs: 60_000,
    artifactsDir: '.fliwright/ai',
    cache: 'off',
    maxConcurrency: 1,
    defaultVisionContext: {
      includeScreenshot: true,
      includeSnapshot: true,
    },
    adapter: {
      command: 'codex',
      args: ['exec', '--json'],
    },
  },
});
```

Environment variables:

```text
FLIWRIGHT_AI_PROVIDER=codex|claude|mock|none
FLIWRIGHT_AI_COMMAND=codex
FLIWRIGHT_AI_ARGS=exec,--json
FLIWRIGHT_AI_TIMEOUT_MS=60000
FLIWRIGHT_AI_ARTIFACTS_DIR=.fliwright/ai
FLIWRIGHT_AI_CACHE=off|read|write|read-write
FLIWRIGHT_AI_ENABLED=true|false
```

Configuration priority is:

```text
per-call options > createFliwrightTest({ ai }) > environment > defaults
```

CI should require explicit AI enablement. Local runs can auto-enable when a
provider is explicitly configured.

## Artifacts

Every AI invocation writes debuggable artifacts when artifact storage is
enabled:

```text
.fliwright/ai/<runId>/<testSlug>/<callId>/
  request.json
  prompt.md
  screenshot.png
  snapshot.json
  response.txt
  response.json
  stderr.txt
  meta.json
```

`meta.json` records provider name, command and args summary, duration, exit
code, status, and error type. It must not include secrets, environment variable
values, or full shell strings.

Future integration can link these artifacts from `.fliwright/runs/<runId>/report.json`
so MCP and VS Code can show the AI judgement that caused a test to pass or fail.

## Caching

Caching is supported but disabled by default. Cache keys include:

- Prompt and system prompt.
- Schema or response format.
- Image hash.
- Snapshot hash.
- Provider and adapter version.

`ai.generate()` benefits most from caching. `ai.visible()` can use caching for
local debugging but CI should use `off` or `read` mode to avoid hiding live UI
changes.

## Concurrency And Timeouts

- `AiRuntime` owns a small queue.
- Default `maxConcurrency` is `1`.
- Each invocation has an independent timeout.
- Timeout kills the child process and throws `AiTimeoutError`.
- Vitest worker collisions are avoided with `runId`, worker id when available,
  test name, and call id in artifact paths.

## Security

- Use `spawn(command, args)` only.
- Do not execute shell strings from user config.
- Do not send source files, workspace trees, environment variables, tokens, or
  secrets by default.
- File attachments require explicit per-call input.
- Screenshots and snapshots are sent only for methods that request visual/page
  context.
- `mock` adapter is available for deterministic CI and unit tests.

## Errors

The runtime normalizes failures into typed errors:

```typescript
AiInvocationError;
AiTimeoutError;
AiParseError;
AiSchemaValidationError;
AiAssertionError;
```

By default, any AI failure fails the test. Callers can provide explicit
fallbacks for data generation:

```typescript
const user = await ai.generate({
  prompt,
  schema,
  fallback: { phone: '13800138000' },
});
```

Assertion helpers such as `ai.visible()` do not use fallback by default because
that would hide the state being verified.

## Testing Strategy

Unit tests:

- `MockAiAdapter` success, JSON, failure, timeout simulation.
- `AiRuntime.generate()` JSON parsing, schema validation, fallback, artifacts.
- `AiRuntime.visible()` screenshot/snapshot collection, pass behavior, and
  `AiAssertionError` behavior.
- CLI adapter with fake executable fixtures for stdout, stderr, exit code, and
  timeout.
- Vitest fixture creation with `createFliwrightTest({ ai })` and test-context
  propagation.

Default tests must not call real Claude or Codex. Live provider smoke tests are
opt-in behind `FLIWRIGHT_AI_LIVE=1`.

## Delivery Plan

### Phase 1: Runtime And Mock Adapter

Implement core types, runtime, typed errors, artifact store, JSON parsing,
minimal schema validation, and `MockAiAdapter`.

User gets: manual `new AiRuntime(...)` usage with deterministic adapter.

### Phase 2: Vitest Fixture

Add `ai` to `createFliwrightTest` fixtures. Bind page, driver, test name, run id,
and default configuration.

User gets: `test('...', async ({ page, ai }) => { ... })`.

### Phase 3: Claude/Codex CLI Adapters

Implement safe process spawning, stdin/request-file prompt modes, stdout parsing,
timeout handling, and adapter metadata.

User gets: provider switching through configuration or environment variables.

### Phase 4: Vision And Report Integration

Improve screenshot/snapshot prompts and link AI artifacts into run reports and
failure context.

User gets: diagnosable AI assertions visible to MCP and VS Code surfaces.

### Phase 5: Advanced Agent Communication

Evaluate persistent sessions, MCP client transport, HTTP providers, tool
callbacks, and multi-turn task APIs.

User gets: a foundation for richer agent collaboration without changing the
basic `ai.*` API.

## Open Decisions

The implementation plan should decide exact CLI default arguments after checking
the current Claude and Codex CLI interfaces in the target development
environment. The adapter architecture should not rely on one exact CLI version.

## Acceptance Criteria

- `@fliwright/core` exports AI runtime types, runtime, errors, and adapters.
- `@fliwright/vitest` can inject `ai` into tests.
- `ai.generate()` returns schema-validated JSON or fails with a typed error.
- `ai.visible()` captures current UI context and fails with `AiAssertionError`
  when the provider reports `pass: false`.
- Artifacts are written for successful and failed invocations.
- Unit tests pass without real AI providers.
- Live Claude/Codex tests are opt-in and skipped by default.
