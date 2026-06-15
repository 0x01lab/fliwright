# AI As A Universal Capability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing `AiRuntime` engine into a module-level `ai` namespace that any fliwright package can import and call directly, plus a `configureAi()` entry for host-side setup.

**Architecture:** A thin `ai/capability.ts` module owns one long-lived `AiRuntime` (so per-call `callId`s and artifact directories stay unique) and exposes `ask/generate/classify/visible/inspect` as functions. Per-call context (page/driver/testName/runId) flows through an optional `callContext` argument added to `AiRuntime`'s methods. Env/adapter resolution moves from `@fliwright/vitest` into `@fliwright/core/src/ai/config.ts` so the capability can self-resolve. The vitest `ai` fixture is renamed `aiRuntime`.

**Tech Stack:** TypeScript ESM, Node16 module resolution, Vitest, existing `AiRuntime`/`MockAiAdapter`/CLI adapters.

**Spec:** `docs/superpowers/specs/2026-06-15-ai-universal-capability-design.md`

---

## File Map

- Create `packages/fliwright-core/src/ai/config.ts`: env resolution + adapter factory moved out of vitest; exports `resolveAiConfig`.
- Create `packages/fliwright-core/tests/ai/config.test.ts`: env parsing + `resolveAiConfig` unit tests.
- Modify `packages/fliwright-core/src/ai/types.ts`: add `AiCallContext`.
- Modify `packages/fliwright-core/src/ai/AiRuntime.ts`: accept optional `callContext` on methods; use it for artifact dir + vision page/driver.
- Modify `packages/fliwright-core/tests/ai/AiRuntime.test.ts`: add per-call-context behavior test.
- Create `packages/fliwright-core/src/ai/capability.ts`: `configureAi`, shared runtime, `ai` namespace.
- Create `packages/fliwright-core/tests/ai/capability.test.ts`: namespace behavior + shared-runtime invariants.
- Modify `packages/fliwright-core/src/index.ts`: export `ai`, `configureAi`, `AiCallContext`, `resolveAiConfig`.
- Modify `packages/fliwright-vitest/src/index.ts`: import `resolveAiConfig` from core; delete moved helpers; rename fixture `ai` → `aiRuntime`.
- Modify `packages/fliwright-vitest/tests/integration.test.ts`: update fixture name references.

## Implementation Notes

- Use `.js` extensions in relative TypeScript imports.
- Default provider is `none`; unconfigured `ai.*` calls throw `AiDisabledError`. CI stays free of real provider calls.
- Do not call real Claude or Codex in any test; use `MockAiAdapter`.
- `parsePositiveInt` stays in vitest (still used by the failure-timeout path); core's `config.ts` gets its own local copy.
- FormHelper integration is explicitly out of scope for this slice (see spec Non-Goals); it is the planned first consumer, tracked separately.

## Task 1: Move AI Config Resolution Into Core

**Files:**
- Create: `packages/fliwright-core/src/ai/config.ts`
- Create: `packages/fliwright-core/tests/ai/config.test.ts`
- Modify: `packages/fliwright-core/src/index.ts`

- [ ] **Step 1: Write failing config tests**

Create `packages/fliwright-core/tests/ai/config.test.ts`:

```typescript
import { afterEach, describe, expect, it } from 'vitest';
import { AiDisabledError, resolveAiConfig } from '../../src/index.js';
import { AiRuntime, MockAiAdapter } from '../../src/index.js';

const ENV_KEYS = [
  'FLIWRIGHT_AI_PROVIDER',
  'FLIWRIGHT_AI_ENABLED',
  'FLIWRIGHT_AI_TIMEOUT_MS',
  'FLIWRIGHT_AI_ARTIFACTS_DIR',
  'FLIWRIGHT_AI_CACHE',
  'FLIWRIGHT_AI_COMMAND',
  'FLIWRIGHT_AI_ARGS',
] as const;

const original: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const key of ENV_KEYS) original[key] = process.env[key];
});
afterEach(() => {
  for (const key of ENV_KEYS) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
});

describe('resolveAiConfig', () => {
  it('defaults to provider none and disabled when nothing is configured', () => {
    for (const key of ENV_KEYS) delete process.env[key];
    const config = resolveAiConfig(undefined);
    expect(config.provider).toBe('none');
    expect(config.enabled).toBe(false);
    expect(config.timeoutMs).toBe(60_000);
    expect(config.artifactsDir).toBe('.fliwright/ai');
    expect(config.cache).toBe('off');
  });

  it('reads provider and artifacts dir from environment', () => {
    process.env.FLIWRIGHT_AI_PROVIDER = 'mock';
    process.env.FLIWRIGHT_AI_ARTIFACTS_DIR = '.fliwright/ai-env';
    process.env.FLIWRIGHT_AI_TIMEOUT_MS = '1234';
    const config = resolveAiConfig(undefined);
    expect(config.provider).toBe('mock');
    expect(config.enabled).toBe(true);
    expect(config.artifactsDir).toBe('.fliwright/ai-env');
    expect(config.timeoutMs).toBe(1234);
    expect(config.adapter).toBeInstanceOf(MockAiAdapter);
  });

  it('parses comma-separated args', () => {
    process.env.FLIWRIGHT_AI_PROVIDER = 'codex';
    process.env.FLIWRIGHT_AI_ARGS = 'exec, --json';
    const config = resolveAiConfig(undefined);
    expect(config.adapter).toBeDefined();
  });

  it('respects an explicit adapter instance over provider-based construction', () => {
    const adapter = new MockAiAdapter();
    const config = resolveAiConfig({ provider: 'mock', adapter });
    expect(config.adapter).toBe(adapter);
  });
});

describe('AiRuntime via resolved config', () => {
  it('throws AiDisabledError when resolved config has no provider', async () => {
    for (const key of ENV_KEYS) delete process.env[key];
    const runtime = new AiRuntime(resolveAiConfig(undefined));
    await expect(runtime.ask({ prompt: 'hi' })).rejects.toBeInstanceOf(AiDisabledError);
  });
});
```

Note: add `beforeEach` to the imports in step 1 — replace the import line:

```typescript
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
```

- [ ] **Step 2: Run config tests to verify they fail**

Run: `pnpm --filter @fliwright/core test -- tests/ai/config.test.ts`
Expected: FAIL — `resolveAiConfig` is not exported from `@fliwright/core`.

- [ ] **Step 3: Implement the config module**

Create `packages/fliwright-core/src/ai/config.ts`:

```typescript
import { CliJsonAdapter } from './adapters/CliJsonAdapter.js';
import { ClaudeCliAdapter } from './adapters/ClaudeCliAdapter.js';
import { CodexCliAdapter } from './adapters/CodexCliAdapter.js';
import { MockAiAdapter } from './adapters/MockAiAdapter.js';
import type { AiAdapter, AiCliAdapterOptions, AiProviderName, AiRuntimeConfig } from './types.js';

export function resolveAiConfig(config: AiRuntimeConfig | undefined): AiRuntimeConfig {
  const provider = config?.provider ?? parseAiProvider(process.env.FLIWRIGHT_AI_PROVIDER);
  const adapter = isAiAdapter(config?.adapter) ? config?.adapter : createAiAdapter(config);
  return {
    provider,
    timeoutMs: config?.timeoutMs ?? parsePositiveInt(process.env.FLIWRIGHT_AI_TIMEOUT_MS) ?? 60_000,
    artifactsDir: config?.artifactsDir ?? process.env.FLIWRIGHT_AI_ARTIFACTS_DIR ?? '.fliwright/ai',
    cache: config?.cache ?? parseAiCache(process.env.FLIWRIGHT_AI_CACHE),
    maxConcurrency: config?.maxConcurrency ?? 1,
    enabled: config?.enabled ?? parseAiEnabled(process.env.FLIWRIGHT_AI_ENABLED, provider),
    defaultVisionContext: config?.defaultVisionContext,
    adapter,
  };
}

function createAiAdapter(config: AiRuntimeConfig | undefined): AiAdapter | undefined {
  if (isAiCliAdapterOptions(config?.adapter)) return new CliJsonAdapter(config!.adapter as AiCliAdapterOptions);
  const provider = config?.provider ?? parseAiProvider(process.env.FLIWRIGHT_AI_PROVIDER);
  if (provider === 'mock') return new MockAiAdapter();
  if (provider === 'claude') {
    return new ClaudeCliAdapter({
      command: process.env.FLIWRIGHT_AI_COMMAND ?? 'claude',
      args: parseAiArgs(process.env.FLIWRIGHT_AI_ARGS),
    });
  }
  if (provider === 'codex') {
    return new CodexCliAdapter({
      command: process.env.FLIWRIGHT_AI_COMMAND ?? 'codex',
      args: parseAiArgs(process.env.FLIWRIGHT_AI_ARGS) ?? ['exec', '--json'],
    });
  }
  if (provider === 'custom-cli') {
    const command = process.env.FLIWRIGHT_AI_COMMAND;
    return command ? new CliJsonAdapter({ provider: 'custom-cli', command, args: parseAiArgs(process.env.FLIWRIGHT_AI_ARGS) }) : undefined;
  }
  return undefined;
}

export function parseAiProvider(value: string | undefined): AiProviderName {
  if (value === 'mock' || value === 'claude' || value === 'codex' || value === 'custom-cli' || value === 'none') return value;
  return 'none';
}

export function parseAiCache(value: string | undefined): AiRuntimeConfig['cache'] {
  if (value === 'read' || value === 'write' || value === 'read-write') return value;
  return 'off';
}

export function parseAiEnabled(value: string | undefined, provider: AiRuntimeConfig['provider']): boolean {
  if (value === 'false') return false;
  if (value === 'true') return true;
  return provider !== 'none';
}

export function parseAiArgs(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  return value.split(',').map((arg) => arg.trim()).filter(Boolean);
}

export function parsePositiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function isAiAdapter(adapter: AiRuntimeConfig['adapter'] | undefined): adapter is AiAdapter {
  return Boolean(adapter && 'invoke' in adapter);
}

export function isAiCliAdapterOptions(adapter: AiRuntimeConfig['adapter'] | undefined): adapter is AiCliAdapterOptions {
  return Boolean(adapter && 'command' in adapter);
}
```

- [ ] **Step 4: Export resolveAiConfig from core**

In `packages/fliwright-core/src/index.ts`, after the existing `export { CodexCliAdapter } ...` line (line 136), add:

```typescript
export { resolveAiConfig } from './ai/config.js';
```

- [ ] **Step 5: Run config tests to verify they pass**

Run: `pnpm --filter @fliwright/core test -- tests/ai/config.test.ts`
Expected: PASS (4 + 1 = 5 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/fliwright-core/src/ai/config.ts packages/fliwright-core/src/index.ts packages/fliwright-core/tests/ai/config.test.ts
git commit -m "feat(core): move ai config resolution into core"
```

## Task 2: Rewire Vitest To Use Core Config Resolution

**Files:**
- Modify: `packages/fliwright-vitest/src/index.ts`

- [ ] **Step 1: Import resolveAiConfig from core**

In `packages/fliwright-vitest/src/index.ts`, the import from `@fliwright/core` (lines 12-26) currently imports `AiRuntime, ClaudeCliAdapter, CliJsonAdapter, CodexCliAdapter, MockAiAdapter, ...`. Remove the three CLI adapter classes and `MockAiAdapter` from that import (they are no longer referenced here after step 3), and add `resolveAiConfig`. The value import becomes:

```typescript
import {
  AiRuntime,
  AssertionError,
  Assertion,
  FailureCollector,
  FliwrightDriver,
  TraceCollector,
  TraceStore,
  isActionMethod,
  createExpect,
  resolveAiConfig,
} from '@fliwright/core';
```

And update the type import (line 27) — remove `AiCliAdapterOptions` since it is no longer used here:

```typescript
import type { AiAdapter, AiRuntimeConfig, FailureContext, HealingReport, Locator, Page, VMServiceEvent, TraceMode } from '@fliwright/core';
```

- [ ] **Step 2: Replace createAiRuntime with a direct construction**

In `packages/fliwright-vitest/src/index.ts`, replace the `createAiRuntime` function (lines 349-352) with nothing, and update its single caller in the `ai` fixture (line 135). The fixture body becomes:

```typescript
    ai: async ({ task }, use) => {
      const driver = await getSharedDriver(config);
      const testName = getTestName(task);
      const runtime = new AiRuntime(resolveAiConfig(config.ai), {
        page: driver.page,
        driver,
        testName,
        runId,
        cwd: process.cwd(),
      });
      await use(runtime);
    },
```

- [ ] **Step 3: Delete the moved helper functions**

Delete these functions from `packages/fliwright-vitest/src/index.ts` (they now live in core): `resolveAiConfig` (lines 354-367), `createAiAdapter` (lines 369-390), `parseAiProvider` (lines 392-395), `parseAiCache` (lines 397-400), `parseAiEnabled` (lines 402-406), `parseAiArgs` (lines 408-411), `isAiAdapter` (lines 413-415), `isAiCliAdapterOptions` (lines 417-419).

Keep `parsePositiveInt` (line 343) — it is still used by `FLIWRIGHT_FAILURE_TIMEOUT_MS` on line 151.

- [ ] **Step 4: Run vitest tests to verify they pass**

Run: `pnpm --filter @fliwright/vitest test`
Expected: PASS — all vitest tests green, including the AI fixture integration tests.

- [ ] **Step 5: Commit**

```bash
git add packages/fliwright-vitest/src/index.ts
git commit -m "refactor(vitest): use core ai config resolution"
```

## Task 3: Add Per-Call Context Override To AiRuntime

**Files:**
- Modify: `packages/fliwright-core/src/ai/types.ts`
- Modify: `packages/fliwright-core/src/ai/AiRuntime.ts`
- Modify: `packages/fliwright-core/tests/ai/AiRuntime.test.ts`

- [ ] **Step 1: Write failing per-call-context test**

In `packages/fliwright-core/tests/ai/AiRuntime.test.ts`, add this test inside the existing `describe('AiRuntime', ...)` block (after the "times out" test):

```typescript
  it('visible uses per-call page override instead of constructor context', async () => {
    const constructorPage = {
      screenshot: () => {
        throw new Error('constructor page must not be used');
      },
      snapshot: () => {
        throw new Error('constructor page must not be used');
      },
    } as unknown as Page;
    const callPage = pageStub();
    const adapter = new MockAiAdapter(async (request) => {
      expect(request.images?.[0]?.mimeType).toBe('image/png');
      return { text: '{"pass":true,"reason":"ok"}', json: { pass: true, reason: 'ok' } };
    });
    const runtime = new AiRuntime({ adapter }, { page: constructorPage });

    await expect(runtime.visible('looks good', {}, { page: callPage })).resolves.toBeUndefined();
    expect((callPage.screenshot as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
  });

  it('ask uses per-call testName and runId for the artifact directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-ai-callctx-'));
    const runtime = new AiRuntime(
      { artifactsDir: root, adapter: new MockAiAdapter([{ text: '{"ok":true}', json: { ok: true } }]) },
      { runId: 'constructor-run', testName: 'constructor-test' },
    );

    const response = await runtime.ask({ prompt: 'hi', responseFormat: 'json' }, { runId: 'call-run', testName: 'call-test' });

    expect(response.artifactsDir).toContain('call-run');
    expect(response.artifactsDir).toContain('call-test');
    expect(response.artifactsDir).not.toContain('constructor');
  });
```

- [ ] **Step 2: Run runtime tests to verify they fail**

Run: `pnpm --filter @fliwright/core test -- tests/ai/AiRuntime.test.ts`
Expected: FAIL — `visible` does not accept a third argument; `ask` does not accept a second argument.

- [ ] **Step 3: Add the AiCallContext type**

In `packages/fliwright-core/src/ai/types.ts`, add after the `AiRuntimeContext` interface (after line 103):

```typescript
export interface AiCallContext {
  page?: Page;
  driver?: FliwrightDriver;
  testName?: string;
  runId?: string;
}
```

- [ ] **Step 4: Thread callContext through AiRuntime methods**

In `packages/fliwright-core/src/ai/AiRuntime.ts`, add `AiCallContext` to the type import from `./types.js`:

```typescript
import type {
  AiAdapter,
  AiArtifactMeta,
  AiCallContext,
  AiClassifyRequest,
  AiGenerateRequest,
  AiInspectRequest,
  AiRequest,
  AiResponse,
  AiRuntimeConfig,
  AiRuntimeContext,
  AiVisibleOptions,
  JsonSchema,
} from './types.js';
```

Replace the `ask` method signature and its artifact-dir + invocation-context lines. The full updated `ask` method:

```typescript
  async ask(input: AiRequest, call?: AiCallContext): Promise<AiResponse> {
    const adapter = this.resolveAdapter();
    const callId = `ai-${++this.callCounter}`;
    const timeoutMs = input.timeoutMs ?? this.config.timeoutMs ?? 60_000;
    const store = this.config.artifactsDir ? new AiArtifactStore(this.config.artifactsDir) : undefined;
    const artifactsDir = store
      ? await store.createInvocationDir({
          runId: call?.runId ?? this.context.runId,
          testName: call?.testName ?? this.context.testName,
          callId,
        })
      : undefined;
    const startedAt = Date.now();
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;

    try {
      await store?.writeRequest(artifactsDir!, input);
      await store?.writePrompt(artifactsDir!, input.prompt);
      const invocation = adapter.invoke(input, {
        callId,
        timeoutMs,
        signal: controller.signal,
        runtime: {
          ...this.context,
          page: call?.page ?? this.context.page,
          driver: call?.driver ?? this.context.driver,
        },
        artifactsDir,
      });
      const response = await withTimeout(invocation, timeoutMs, controller, artifactsDir, (handle) => {
        timeout = handle;
      });
      const json = response.json ?? parseJsonIfNeeded(response.text, input.responseFormat, artifactsDir);
      await store?.writeResponseText(artifactsDir!, response.text);
      if (json !== undefined) await store?.writeResponseJson(artifactsDir!, json);
      await store?.writeMeta(artifactsDir!, buildMeta(adapter.name, 'passed', startedAt, response.raw));
      return { text: response.text, json, metadata: response.metadata, artifactsDir };
    } catch (error) {
      const normalized = normalizeError(error, artifactsDir);
      await store?.writeMeta(artifactsDir!, {
        provider: adapter.name,
        status: 'failed',
        durationMs: Date.now() - startedAt,
        errorType: normalized.name,
      });
      throw normalized;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
```

Replace the `generate`, `visible`, `inspect`, `classify` methods to thread `call`:

```typescript
  async generate<T = unknown>(input: AiGenerateRequest<T>, call?: AiCallContext): Promise<T> {
    try {
      const response = await this.ask({ ...input, responseFormat: 'json' }, call);
      const json = response.json ?? parseJsonIfNeeded(response.text, 'json', response.artifactsDir);
      return input.schema ? validateJsonSchema<T>(json, input.schema) : json as T;
    } catch (error) {
      if ('fallback' in input) return input.fallback as T;
      throw error;
    }
  }

  async visible(prompt: string, options: AiVisibleOptions = {}, call?: AiCallContext): Promise<void> {
    const result = await this.inspect<{ pass: boolean; reason: string }>({
      prompt,
      responseFormat: 'json',
      schema: visibleSchema,
      includeScreenshot: options.includeScreenshot ?? true,
      includeSnapshot: options.includeSnapshot ?? false,
      screenshot: options.screenshot,
      timeoutMs: options.timeoutMs,
    }, call);
    if (!result.pass) throw new AiAssertionError(result.reason || 'provider returned pass=false');
  }

  async inspect<T = unknown>(input: AiInspectRequest, call?: AiCallContext): Promise<T> {
    const request = await this.withVisionContext(input, call);
    const response = await this.ask({ ...request, responseFormat: 'json' }, call);
    const json = response.json ?? parseJsonIfNeeded(response.text, 'json', response.artifactsDir);
    return input.schema ? validateJsonSchema<T>(json, input.schema) : json as T;
  }

  async classify(input: AiClassifyRequest, call?: AiCallContext): Promise<string> {
    const response = await this.generate<{ label: string }>({
      ...input,
      responseFormat: 'json',
      schema: {
        type: 'object',
        properties: { label: { type: 'string', enum: input.choices } },
        required: ['label'],
      },
    }, call);
    return response.label;
  }
```

Replace `withVisionContext` to use the per-call page:

```typescript
  private async withVisionContext(input: AiInspectRequest, call?: AiCallContext): Promise<AiRequest> {
    const includeScreenshot = input.includeScreenshot ?? this.config.defaultVisionContext?.includeScreenshot ?? true;
    const includeSnapshot = input.includeSnapshot ?? this.config.defaultVisionContext?.includeSnapshot ?? false;
    const page = call?.page ?? this.context.page;
    const images = [...(input.images ?? [])];
    const metadata = { ...(input.metadata ?? {}) };

    if (includeScreenshot) {
      if (!page) throw new AiInvocationError('AI vision request requires a Page in runtime context');
      const screenshot = await page.screenshot(input.screenshot ?? { pixelRatio: 1 });
      images.push({ name: 'screenshot.png', mimeType: 'image/png', data: screenshot });
    }

    if (includeSnapshot) {
      if (!page) throw new AiInvocationError('AI snapshot request requires a Page in runtime context');
      metadata.snapshot = await page.snapshot();
    }

    return { ...input, images, metadata };
  }
```

- [ ] **Step 5: Run runtime tests to verify they pass**

Run: `pnpm --filter @fliwright/core test -- tests/ai/AiRuntime.test.ts`
Expected: PASS — all existing 8 tests plus the 2 new per-call-context tests.

- [ ] **Step 6: Commit**

```bash
git add packages/fliwright-core/src/ai/types.ts packages/fliwright-core/src/ai/AiRuntime.ts packages/fliwright-core/tests/ai/AiRuntime.test.ts
git commit -m "feat(core): add per-call context override to ai runtime"
```

## Task 4: Add The Universal ai Namespace

**Files:**
- Create: `packages/fliwright-core/src/ai/capability.ts`
- Create: `packages/fliwright-core/tests/ai/capability.test.ts`
- Modify: `packages/fliwright-core/src/index.ts`

- [ ] **Step 1: Write failing capability tests**

Create `packages/fliwright-core/tests/ai/capability.test.ts`:

```typescript
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AiDisabledError, configureAi, ai, type Page } from '../../src/index.js';

function pageStub(): Page {
  return {
    screenshot: vi.fn().mockResolvedValue(Buffer.from('png')),
    snapshot: vi.fn().mockResolvedValue({ snapshot: '- button "Ok" [ref=e1]', groupId: 'g', refs: [], count: 1 }),
  } as unknown as Page;
}

beforeEach(() => {
  configureAi(undefined);
});

describe('ai namespace', () => {
  it('throws AiDisabledError when nothing is configured', async () => {
    delete process.env.FLIWRIGHT_AI_PROVIDER;
    await expect(ai.ask({ prompt: 'hi' })).rejects.toBeInstanceOf(AiDisabledError);
  });

  it('generate returns schema-validated JSON via a configured mock adapter', async () => {
    configureAi({ provider: 'mock' });
    // mock adapter with no queue returns {} for json; use a handler for control
    configureAi({ adapter: { name: 'mock', invoke: async () => ({ text: '{"phone":"13800138000"}', json: { phone: '13800138000' } }) } });
    const value = await ai.generate<{ phone: string }>({
      prompt: 'gen',
      schema: { type: 'object', properties: { phone: { type: 'string' } }, required: ['phone'] },
    });
    expect(value.phone).toBe('13800138000');
  });

  it('generate returns fallback when the adapter fails', async () => {
    configureAi({ adapter: { name: 'boom', invoke: async () => { throw new Error('down'); } } });
    await expect(ai.generate({
      prompt: 'gen',
      schema: { type: 'object' },
      fallback: { phone: 'fallback' },
    })).resolves.toEqual({ phone: 'fallback' });
  });

  it('classify returns a value within choices', async () => {
    configureAi({ adapter: { name: 'mock', invoke: async () => ({ text: '{"label":"成功"}', json: { label: '成功' } }) } });
    await expect(ai.classify({ prompt: 'c', choices: ['成功', '失败'] })).resolves.toBe('成功');
  });

  it('visible uses the page passed in options', async () => {
    const page = pageStub();
    configureAi({ adapter: { name: 'mock', invoke: async () => ({ text: '{"pass":true,"reason":"ok"}', json: { pass: true, reason: 'ok' } }) } });
    await expect(ai.visible('ok', { page })).resolves.toBeUndefined();
    expect(page.screenshot).toHaveBeenCalled();
  });

  it('visible throws AiInvocationError when page is missing', async () => {
    configureAi({ provider: 'mock' });
    await expect(ai.visible('ok')).rejects.toThrow(/Page/);
  });

  it('inspect returns schema-validated visual JSON with a passed page', async () => {
    const page = pageStub();
    configureAi({ adapter: { name: 'mock', invoke: async () => ({ text: '{"state":"success"}', json: { state: 'success' } }) } });
    await expect(ai.inspect(
      { prompt: 'state', schema: { type: 'object', properties: { state: { enum: ['success', 'error'] } }, required: ['state'] } },
      { page },
    )).resolves.toEqual({ state: 'success' });
  });

  it('preserves unique artifact directories across successive calls (shared runtime invariant)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-ai-cap-'));
    configureAi({
      artifactsDir: root,
      adapter: { name: 'mock', invoke: async () => ({ text: '{"ok":true}', json: { ok: true } }) },
    });
    const a = await ai.ask({ prompt: 'one', responseFormat: 'json' }, { runId: 'r', testName: 't' });
    const b = await ai.ask({ prompt: 'two', responseFormat: 'json' }, { runId: 'r', testName: 't' });
    expect(a.artifactsDir).not.toBe(b.artifactsDir);
    expect(a.artifactsDir).toMatch(/ai-1/);
    expect(b.artifactsDir).toMatch(/ai-2/);
  });
});
```

- [ ] **Step 2: Run capability tests to verify they fail**

Run: `pnpm --filter @fliwright/core test -- tests/ai/capability.test.ts`
Expected: FAIL — `ai` and `configureAi` are not exported.

- [ ] **Step 3: Implement the capability module**

Create `packages/fliwright-core/src/ai/capability.ts`:

```typescript
import { AiRuntime } from './AiRuntime.js';
import { resolveAiConfig } from './config.js';
import type {
  AiCallContext,
  AiClassifyRequest,
  AiGenerateRequest,
  AiInspectRequest,
  AiRequest,
  AiResponse,
  AiRuntimeConfig,
  AiVisibleOptions,
} from './types.js';

let configuredConfig: AiRuntimeConfig | undefined;
let sharedRuntime: AiRuntime | undefined;

export function configureAi(config?: AiRuntimeConfig): void {
  configuredConfig = config;
  sharedRuntime = undefined;
}

function getSharedRuntime(): AiRuntime {
  if (!sharedRuntime) {
    sharedRuntime = new AiRuntime(resolveAiConfig(configuredConfig));
  }
  return sharedRuntime;
}

export const ai = {
  ask(input: AiRequest, ctx?: AiCallContext): Promise<AiResponse> {
    return getSharedRuntime().ask(input, ctx);
  },
  generate<T = unknown>(input: AiGenerateRequest<T>, ctx?: AiCallContext): Promise<T> {
    return getSharedRuntime().generate<T>(input, ctx);
  },
  classify(input: AiClassifyRequest, ctx?: AiCallContext): Promise<string> {
    return getSharedRuntime().classify(input, ctx);
  },
  inspect<T = unknown>(input: AiInspectRequest, ctx: AiCallContext = {}): Promise<T> {
    return getSharedRuntime().inspect<T>(input, ctx);
  },
  visible(prompt: string, options: AiVisibleOptions & AiCallContext = {}): Promise<void> {
    const { page, driver, testName, runId, ...vision } = options;
    return getSharedRuntime().visible(prompt, vision, { page, driver, testName, runId });
  },
};
```

- [ ] **Step 4: Export the namespace and type from core**

In `packages/fliwright-core/src/index.ts`:

Add `AiCallContext` to the type-export block from `./ai/types.js` (the block ending at line 119). Add it alongside the other AI types.

After the `export { resolveAiConfig } ...` line added in Task 1, add:

```typescript
export { ai, configureAi } from './ai/capability.js';
```

- [ ] **Step 5: Run capability tests to verify they pass**

Run: `pnpm --filter @fliwright/core test -- tests/ai/capability.test.ts`
Expected: PASS — all 8 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/fliwright-core/src/ai/capability.ts packages/fliwright-core/src/index.ts packages/fliwright-core/tests/ai/capability.test.ts
git commit -m "feat(core): add universal ai namespace"
```

## Task 5: Rename The Vitest ai Fixture To aiRuntime

**Files:**
- Modify: `packages/fliwright-vitest/src/index.ts`
- Modify: `packages/fliwright-vitest/tests/integration.test.ts`

- [ ] **Step 1: Rename the fixture in the harness**

In `packages/fliwright-vitest/src/index.ts`:

Change the extend type (line 65):

```typescript
  const fliwrightTest = vitestTest.extend<{ page: Page; driver: FliwrightDriver; aiRuntime: AiRuntime }>({
```

Change the fixture key (line 132) from `ai:` to `aiRuntime:`:

```typescript
    aiRuntime: async ({ task }, use) => {
```

- [ ] **Step 2: Update the integration tests**

In `packages/fliwright-vitest/tests/integration.test.ts`:

Change the test at line 73 title and the comment-free assertion to refer to `aiRuntime`. The test body (line 73-80) currently asserts the test function is created with an `ai` fixture; keep the config assertion. Update the title:

```typescript
  it('creates a test function with an aiRuntime fixture when configured', () => {
    const test = createFliwrightTest({
      vmServiceUrl: 'ws://localhost:12345/ws',
      ai: { provider: 'mock' },
    });
    expect(test).toBeDefined();
    expect(typeof test).toBe('function');
  });
```

Change the test at line 120-121 (the `testWithAi` example) to destructure `aiRuntime`:

```typescript
testWithAi('provides an aiRuntime fixture to generated tests', async ({ aiRuntime }) => {
  expect(aiRuntime).toBeInstanceOf(AiRuntime);
```

Update the test at line 99 title from "exposes the AiRuntime type for ai fixture consumers" to "exposes the AiRuntime type for aiRuntime fixture consumers" (cosmetic, optional but consistent).

- [ ] **Step 3: Run vitest tests to verify they pass**

Run: `pnpm --filter @fliwright/vitest test`
Expected: PASS — all vitest tests green.

- [ ] **Step 4: Commit**

```bash
git add packages/fliwright-vitest/src/index.ts packages/fliwright-vitest/tests/integration.test.ts
git commit -m "refactor(vitest): rename ai fixture to aiRuntime"
```

## Task 6: Full Verification And Documentation

**Files:**
- No source changes unless verification finds a gap.

- [ ] **Step 1: Run focused AI test suites**

Run:
```bash
pnpm --filter @fliwright/core test -- tests/ai
pnpm --filter @fliwright/vitest test
```
Expected: PASS for all AI-related tests.

- [ ] **Step 2: Lint and build both packages**

Run:
```bash
pnpm --filter @fliwright/core lint
pnpm --filter @fliwright/core build
pnpm --filter @fliwright/vitest lint
pnpm --filter @fliwright/vitest build
```
Expected: PASS. If strict-mode errors appear, fix the exact line and rerun the same command.

- [ ] **Step 3: Run the full test suite**

Run: `pnpm test`
Expected: PASS. If unrelated pre-existing failures appear, capture the test names and confirm they do not come from these changes.

- [ ] **Step 4: Self-review security posture**

Run:
```bash
rg "shell|exec\(|execFile" packages/fliwright-core/src/ai packages/fliwright-vitest/src/index.ts
```
Expected: no shell-execution API usage; only `spawn(command, args)` in `CliJsonAdapter.ts`.

- [ ] **Step 5: Refresh feature documentation**

Run the repository feature documentation workflow: `/document-features`
Expected: `docs/features/` reflects the new `ai` namespace, `configureAi`, `resolveAiConfig`, and the renamed `aiRuntime` fixture.

- [ ] **Step 6: Commit documentation**

```bash
git add docs/features
git commit -m "docs: document ai universal capability"
```

## Plan Self-Review

- **Spec coverage:** Task 1 covers env resolution moved to core. Task 2 covers vitest rewire. Task 3 covers the per-call context override (the AiRuntime change). Task 4 covers `configureAi` + `ai` namespace + shared-runtime invariants. Task 5 covers the fixture rename. Task 6 covers verification + security + docs. All spec acceptance criteria map to a task. Out-of-scope items (cache, maxConcurrency, HTTP/MCP transport, FormHelper wiring) are intentionally absent per the spec Non-Goals.
- **Placeholder scan:** No TBD/TODO; every code step shows full code; every test step shows full test code.
- **Type consistency:** `AiCallContext` (page/driver/testName/runId) is defined in Task 3 and consumed identically in Task 4's `capability.ts`. `configureAi`, `ai`, `resolveAiConfig` names match across Task 1, Task 4, and the exports. The vitest fixture name `aiRuntime` is consistent between Task 5 step 1 and step 2. `parsePositiveInt` exists in both core `config.ts` (Task 1) and vitest (kept) with identical behavior — intentional, not a conflict.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-15-ai-universal-capability.md`. Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.
**2. Inline Execution** — execute tasks in this session with checkpoints for review.

Which approach?
