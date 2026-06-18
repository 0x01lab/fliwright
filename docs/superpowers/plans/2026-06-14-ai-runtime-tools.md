# AI Runtime Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add first-class `ai.*` helpers so Fliwright tests can generate structured data and inspect live Flutter UI state through deterministic mock adapters and opt-in CLI adapters.

**Architecture:** Put the reusable AI runtime in `@fliwright/core` with narrow adapter interfaces, typed errors, schema validation, artifact writing, and page-context collection. Bind it into `@fliwright/vitest` as an `ai` fixture that receives the current `page`, `driver`, `testName`, and shared `runId`.

**Tech Stack:** TypeScript ESM, Node16 module resolution, Vitest, Node `fs/promises`, Node `child_process.spawn`, existing `Page.screenshot()` and `Page.snapshot()` APIs

---

## File Map

- Create `packages/fliwright-core/src/ai/types.ts`: public AI request, response, adapter, config, artifact, schema, and runtime context types.
- Create `packages/fliwright-core/src/ai/errors.ts`: typed AI errors with stable names and optional artifact directory metadata.
- Create `packages/fliwright-core/src/ai/AiSchemaValidator.ts`: small JSON Schema validator for object, array, primitive, enum, required, and nested property checks.
- Create `packages/fliwright-core/src/ai/AiArtifactStore.ts`: safe artifact path creation and JSON/text/binary writes under `.fliwright/ai/<runId>/<testSlug>/<callId>/`.
- Create `packages/fliwright-core/src/ai/adapters/MockAiAdapter.ts`: deterministic adapter for unit tests and CI.
- Create `packages/fliwright-core/src/ai/AiRuntime.ts`: runtime methods `ask`, `generate`, `visible`, `inspect`, and `classify`.
- Create `packages/fliwright-core/src/ai/adapters/CliJsonAdapter.ts`: base stateless child-process adapter using `spawn(command, args)`.
- Create `packages/fliwright-core/src/ai/adapters/ClaudeCliAdapter.ts`: Claude CLI wrapper over `CliJsonAdapter`.
- Create `packages/fliwright-core/src/ai/adapters/CodexCliAdapter.ts`: Codex CLI wrapper over `CliJsonAdapter`.
- Modify `packages/fliwright-core/src/index.ts`: export AI runtime, adapters, errors, and types.
- Modify `packages/fliwright-vitest/src/index.ts`: add AI config, environment parsing, adapter construction, and `ai` fixture.
- Create `packages/fliwright-core/tests/ai/AiSchemaValidator.test.ts`: schema validator unit tests.
- Create `packages/fliwright-core/tests/ai/AiRuntime.test.ts`: runtime behavior, artifact, fallback, vision context, and error tests.
- Create `packages/fliwright-core/tests/ai/CliJsonAdapter.test.ts`: fake executable tests for stdout, stderr, parse failure, exit failure, and timeout.
- Modify `packages/fliwright-vitest/tests/integration.test.ts`: type-level and config tests for the `ai` fixture.
- Modify generated docs after implementation stabilizes: run `/document-features` or update `docs/features/` through the repository feature-doc workflow.

## Implementation Notes

- Follow `AGENTS.md` (self-contained bootstrap) before editing; open on-demand `memory/` reference and the specific `docs/features/` pages only as the task requires.
- Use `.js` extensions in relative TypeScript imports.
- Do not call real Claude or Codex in default tests.
- Do not add a runtime dependency for Zod in `@fliwright/core`; use the local minimal JSON Schema validator for the MVP.
- Use `spawn(command, args)` only. Never accept or execute a shell string.
- Default provider selection must be `none` unless explicitly configured. Vitest should expose `ai` that throws a typed disabled error when no provider is configured.
- Artifact metadata must not include secrets, environment variable values, or command-line shell strings. It may include adapter name, command basename, args array, status, duration, exit code, and error type.
- Preserve the unrelated modified snapshot file currently in the worktree unless the user explicitly asks to touch it.

## Task 1: Core Types, Errors, And Schema Validation

**Files:**
- Create: `packages/fliwright-core/src/ai/types.ts`
- Create: `packages/fliwright-core/src/ai/errors.ts`
- Create: `packages/fliwright-core/src/ai/AiSchemaValidator.ts`
- Create: `packages/fliwright-core/tests/ai/AiSchemaValidator.test.ts`
- Modify: `packages/fliwright-core/src/index.ts`

- [ ] **Step 1: Write failing schema validator tests**

Create `packages/fliwright-core/tests/ai/AiSchemaValidator.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { AiSchemaValidationError, validateJsonSchema } from '../../src/index.js';

describe('validateJsonSchema', () => {
  it('accepts objects that satisfy required property schemas', () => {
    const schema = {
      type: 'object',
      properties: {
        phone: { type: 'string' },
        age: { type: 'number' },
        active: { type: 'boolean' },
      },
      required: ['phone', 'age'],
    } as const;

    expect(validateJsonSchema({ phone: '13800138000', age: 18, active: true }, schema)).toEqual({
      phone: '13800138000',
      age: 18,
      active: true,
    });
  });

  it('rejects missing required properties with a path', () => {
    const schema = {
      type: 'object',
      properties: { phone: { type: 'string' } },
      required: ['phone'],
    } as const;

    expect(() => validateJsonSchema({}, schema)).toThrow(AiSchemaValidationError);
    expect(() => validateJsonSchema({}, schema)).toThrow('$.phone is required');
  });

  it('rejects nested type mismatches with a path', () => {
    const schema = {
      type: 'object',
      properties: {
        user: {
          type: 'object',
          properties: { tags: { type: 'array', items: { type: 'string' } } },
          required: ['tags'],
        },
      },
      required: ['user'],
    } as const;

    expect(() => validateJsonSchema({ user: { tags: ['ok', 42] } }, schema)).toThrow('$.user.tags[1] expected string');
  });

  it('rejects enum values outside the allowed set', () => {
    const schema = { type: 'string', enum: ['success', 'error'] } as const;
    expect(() => validateJsonSchema('pending', schema)).toThrow('$ expected one of: success, error');
  });
});
```

- [ ] **Step 2: Run the schema validator test to verify it fails**

Run:

```bash
pnpm --filter @fliwright/core test -- tests/ai/AiSchemaValidator.test.ts
```

Expected: FAIL because `../../src/index.js` does not export `validateJsonSchema` or `AiSchemaValidationError`.

- [ ] **Step 3: Add AI public types and typed errors**

Create `packages/fliwright-core/src/ai/types.ts`:

```typescript
import type { FliwrightDriver } from '../Driver.js';
import type { Page } from '../Page.js';

export type AiResponseFormat = 'text' | 'json';
export type AiProviderName = 'mock' | 'claude' | 'codex' | 'custom-cli' | 'none';
export type AiCacheMode = 'off' | 'read' | 'write' | 'read-write';

export type JsonSchemaType = 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null';

export interface JsonSchema {
  type?: JsonSchemaType | JsonSchemaType[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  additionalProperties?: boolean;
}

export interface AiImageInput {
  name?: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  data: Buffer | string;
}

export interface AiFileInput {
  name: string;
  mimeType?: string;
  content: Buffer | string;
}

export interface AiRequest {
  prompt: string;
  system?: string;
  responseFormat?: AiResponseFormat;
  schema?: JsonSchema;
  images?: AiImageInput[];
  files?: AiFileInput[];
  timeoutMs?: number;
  temperature?: number;
  metadata?: Record<string, unknown>;
}

export interface AiGenerateRequest<TFallback = unknown> extends AiRequest {
  responseFormat?: 'json';
  fallback?: TFallback;
}

export interface AiVisionOptions {
  includeScreenshot?: boolean;
  includeSnapshot?: boolean;
  screenshot?: { pixelRatio?: number; mode?: 'auto' | 'boundary' | 'canvas' };
}

export interface AiVisibleOptions extends AiVisionOptions {
  timeoutMs?: number;
}

export interface AiInspectRequest extends AiRequest, AiVisionOptions {}

export interface AiClassifyRequest extends AiRequest {
  choices: string[];
}

export interface AiResponse {
  text: string;
  json?: unknown;
  metadata?: AiAdapterResponse['metadata'];
  artifactsDir?: string;
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

export interface AiInvocationContext {
  callId: string;
  timeoutMs: number;
  signal: AbortSignal;
  runtime: AiRuntimeContext;
  artifactsDir?: string;
}

export interface AiAdapter {
  readonly name: string;
  invoke(request: AiRequest, context: AiInvocationContext): Promise<AiAdapterResponse>;
}

export interface AiRuntimeContext {
  page?: Page;
  driver?: FliwrightDriver;
  testName?: string;
  runId?: string;
  cwd?: string;
}

export interface AiRuntimeConfig {
  provider?: AiProviderName;
  adapter?: AiAdapter | AiCliAdapterOptions;
  timeoutMs?: number;
  artifactsDir?: string;
  cache?: AiCacheMode;
  maxConcurrency?: number;
  enabled?: boolean;
  defaultVisionContext?: AiVisionOptions;
}

export interface AiCliAdapterOptions {
  provider?: 'claude' | 'codex' | 'custom-cli';
  command: string;
  args?: string[];
  cwd?: string;
  inputMode?: 'stdin-json' | 'request-file';
}

export interface AiArtifactMeta {
  provider: string;
  status: 'passed' | 'failed';
  durationMs: number;
  command?: string;
  args?: string[];
  exitCode?: number | null;
  errorType?: string;
}
```

Create `packages/fliwright-core/src/ai/errors.ts`:

```typescript
export class AiInvocationError extends Error {
  readonly artifactsDir?: string;

  constructor(message: string, options: { cause?: unknown; artifactsDir?: string } = {}) {
    super(message);
    this.name = new.target.name;
    this.cause = options.cause;
    this.artifactsDir = options.artifactsDir;
  }
}

export class AiDisabledError extends AiInvocationError {}
export class AiTimeoutError extends AiInvocationError {}
export class AiParseError extends AiInvocationError {}
export class AiSchemaValidationError extends AiInvocationError {}
export class AiAssertionError extends AiInvocationError {
  readonly reason: string;

  constructor(reason: string, options: { artifactsDir?: string } = {}) {
    super(`AI assertion failed: ${reason}`, options);
    this.reason = reason;
  }
}
```

- [ ] **Step 4: Add the schema validator**

Create `packages/fliwright-core/src/ai/AiSchemaValidator.ts`:

```typescript
import { AiSchemaValidationError } from './errors.js';
import type { JsonSchema, JsonSchemaType } from './types.js';

export function validateJsonSchema<T = unknown>(value: unknown, schema: JsonSchema): T {
  validateValue(value, schema, '$');
  return value as T;
}

function validateValue(value: unknown, schema: JsonSchema, path: string): void {
  if (schema.enum && !schema.enum.some((candidate) => Object.is(candidate, value))) {
    throw new AiSchemaValidationError(`${path} expected one of: ${schema.enum.map(String).join(', ')}`);
  }

  if (schema.type) {
    const allowed = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!allowed.some((type) => matchesType(value, type))) {
      throw new AiSchemaValidationError(`${path} expected ${allowed.join(' or ')}`);
    }
  }

  if (schema.type === 'object' || schema.properties) {
    if (!isRecord(value)) throw new AiSchemaValidationError(`${path} expected object`);
    for (const key of schema.required ?? []) {
      if (!(key in value)) throw new AiSchemaValidationError(`${path}.${key} is required`);
    }
    for (const [key, childSchema] of Object.entries(schema.properties ?? {})) {
      if (key in value) validateValue(value[key], childSchema, `${path}.${key}`);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!schema.properties?.[key]) throw new AiSchemaValidationError(`${path}.${key} is not allowed`);
      }
    }
  }

  if (schema.type === 'array' || schema.items) {
    if (!Array.isArray(value)) throw new AiSchemaValidationError(`${path} expected array`);
    if (schema.items) {
      value.forEach((item, index) => validateValue(item, schema.items!, `${path}[${index}]`));
    }
  }
}

function matchesType(value: unknown, type: JsonSchemaType): boolean {
  if (type === 'array') return Array.isArray(value);
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'null') return value === null;
  if (type === 'object') return isRecord(value);
  return typeof value === type;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
```

- [ ] **Step 5: Export the new API**

Modify `packages/fliwright-core/src/index.ts`:

```typescript
export type {
  AiAdapter,
  AiAdapterResponse,
  AiArtifactMeta,
  AiCacheMode,
  AiClassifyRequest,
  AiCliAdapterOptions,
  AiFileInput,
  AiGenerateRequest,
  AiImageInput,
  AiInspectRequest,
  AiInvocationContext,
  AiProviderName,
  AiRequest,
  AiResponse,
  AiResponseFormat,
  AiRuntimeConfig,
  AiRuntimeContext,
  AiVisibleOptions,
  AiVisionOptions,
  JsonSchema,
  JsonSchemaType,
} from './ai/types.js';
export {
  AiAssertionError,
  AiDisabledError,
  AiInvocationError,
  AiParseError,
  AiSchemaValidationError,
  AiTimeoutError,
} from './ai/errors.js';
export { validateJsonSchema } from './ai/AiSchemaValidator.js';
```

- [ ] **Step 6: Run the schema validator test to verify it passes**

Run:

```bash
pnpm --filter @fliwright/core test -- tests/ai/AiSchemaValidator.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 1**

Run:

```bash
git add packages/fliwright-core/src/index.ts packages/fliwright-core/src/ai/types.ts packages/fliwright-core/src/ai/errors.ts packages/fliwright-core/src/ai/AiSchemaValidator.ts packages/fliwright-core/tests/ai/AiSchemaValidator.test.ts
git commit -m "feat(core): add ai runtime types"
```

## Task 2: Artifact Store And Mock Adapter

**Files:**
- Create: `packages/fliwright-core/src/ai/AiArtifactStore.ts`
- Create: `packages/fliwright-core/src/ai/adapters/MockAiAdapter.ts`
- Create: `packages/fliwright-core/tests/ai/AiArtifactStore.test.ts`
- Create: `packages/fliwright-core/tests/ai/MockAiAdapter.test.ts`
- Modify: `packages/fliwright-core/src/index.ts`

- [ ] **Step 1: Write failing artifact and mock adapter tests**

Create `packages/fliwright-core/tests/ai/AiArtifactStore.test.ts`:

```typescript
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AiArtifactStore } from '../../src/index.js';

describe('AiArtifactStore', () => {
  it('writes request, prompt, response, screenshot, snapshot, stderr, and meta artifacts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-ai-artifacts-'));
    const store = new AiArtifactStore(root);
    const dir = await store.createInvocationDir({ runId: 'run/1', testName: 'signup submits', callId: 'call:1' });

    await store.writeRequest(dir, { prompt: 'Make data' });
    await store.writePrompt(dir, 'Make data');
    await store.writeResponseText(dir, 'ok');
    await store.writeResponseJson(dir, { ok: true });
    await store.writeScreenshot(dir, Buffer.from('png'));
    await store.writeSnapshot(dir, { snapshot: 'tree' });
    await store.writeStderr(dir, 'warning');
    await store.writeMeta(dir, { provider: 'mock', status: 'passed', durationMs: 7 });

    expect(await readFile(join(dir, 'request.json'), 'utf8')).toContain('"prompt": "Make data"');
    expect(await readFile(join(dir, 'prompt.md'), 'utf8')).toBe('Make data');
    expect(await readFile(join(dir, 'response.txt'), 'utf8')).toBe('ok');
    expect(await readFile(join(dir, 'response.json'), 'utf8')).toContain('"ok": true');
    expect(await readFile(join(dir, 'screenshot.png'))).toEqual(Buffer.from('png'));
    expect(await readFile(join(dir, 'snapshot.json'), 'utf8')).toContain('"snapshot": "tree"');
    expect(await readFile(join(dir, 'stderr.txt'), 'utf8')).toBe('warning');
    expect(await readFile(join(dir, 'meta.json'), 'utf8')).toContain('"provider": "mock"');
    expect(dir).toContain('run_1');
    expect(dir).toContain('signup_submits');
    expect(dir).toContain('call_1');
  });
});
```

Create `packages/fliwright-core/tests/ai/MockAiAdapter.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { MockAiAdapter } from '../../src/index.js';

describe('MockAiAdapter', () => {
  it('returns the next queued response', async () => {
    const adapter = new MockAiAdapter([{ text: '{"ok":true}', json: { ok: true } }]);
    const response = await adapter.invoke(
      { prompt: 'return ok', responseFormat: 'json' },
      { callId: 'call-1', timeoutMs: 1000, signal: new AbortController().signal, runtime: {} },
    );

    expect(response.text).toBe('{"ok":true}');
    expect(response.json).toEqual({ ok: true });
  });

  it('throws queued errors', async () => {
    const adapter = new MockAiAdapter([new Error('adapter failed')]);
    await expect(adapter.invoke(
      { prompt: 'fail' },
      { callId: 'call-1', timeoutMs: 1000, signal: new AbortController().signal, runtime: {} },
    )).rejects.toThrow('adapter failed');
  });

  it('builds deterministic JSON from a handler', async () => {
    const adapter = new MockAiAdapter(async (request) => ({
      text: JSON.stringify({ prompt: request.prompt }),
      json: { prompt: request.prompt },
    }));

    const response = await adapter.invoke(
      { prompt: 'hello', responseFormat: 'json' },
      { callId: 'call-1', timeoutMs: 1000, signal: new AbortController().signal, runtime: {} },
    );

    expect(response.json).toEqual({ prompt: 'hello' });
  });
});
```

- [ ] **Step 2: Run artifact and mock adapter tests to verify they fail**

Run:

```bash
pnpm --filter @fliwright/core test -- tests/ai/AiArtifactStore.test.ts tests/ai/MockAiAdapter.test.ts
```

Expected: FAIL because `AiArtifactStore` and `MockAiAdapter` are not exported.

- [ ] **Step 3: Implement artifact store**

Create `packages/fliwright-core/src/ai/AiArtifactStore.ts`:

```typescript
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { AiArtifactMeta, AiRequest } from './types.js';

export interface AiArtifactPathInput {
  runId?: string;
  testName?: string;
  callId: string;
}

export class AiArtifactStore {
  constructor(private readonly rootDir: string) {}

  async createInvocationDir(input: AiArtifactPathInput): Promise<string> {
    const run = sanitizeSegment(input.runId ?? 'run');
    const test = sanitizeSegment(input.testName ?? 'unknown-test');
    const call = sanitizeSegment(input.callId);
    const dir = resolve(this.rootDir, run, test, call);
    await mkdir(dir, { recursive: true });
    return dir;
  }

  async writeRequest(dir: string, request: AiRequest): Promise<void> {
    await writeJson(dir, 'request.json', request);
  }

  async writePrompt(dir: string, prompt: string): Promise<void> {
    await writeFile(resolve(dir, 'prompt.md'), prompt);
  }

  async writeResponseText(dir: string, text: string): Promise<void> {
    await writeFile(resolve(dir, 'response.txt'), text);
  }

  async writeResponseJson(dir: string, json: unknown): Promise<void> {
    await writeJson(dir, 'response.json', json);
  }

  async writeScreenshot(dir: string, screenshot: Buffer): Promise<void> {
    await writeFile(resolve(dir, 'screenshot.png'), screenshot);
  }

  async writeSnapshot(dir: string, snapshot: unknown): Promise<void> {
    await writeJson(dir, 'snapshot.json', snapshot);
  }

  async writeStderr(dir: string, stderr: string): Promise<void> {
    await writeFile(resolve(dir, 'stderr.txt'), stderr);
  }

  async writeMeta(dir: string, meta: AiArtifactMeta): Promise<void> {
    await writeJson(dir, 'meta.json', meta);
  }
}

async function writeJson(dir: string, filename: string, value: unknown): Promise<void> {
  await writeFile(resolve(dir, filename), `${JSON.stringify(value, null, 2)}\n`);
}

function sanitizeSegment(value: string): string {
  const sanitized = value.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 80);
  return sanitized.length > 0 ? sanitized : 'unknown';
}
```

- [ ] **Step 4: Implement mock adapter**

Create `packages/fliwright-core/src/ai/adapters/MockAiAdapter.ts`:

```typescript
import type { AiAdapter, AiAdapterResponse, AiInvocationContext, AiRequest } from '../types.js';

export type MockAiAdapterHandler = (
  request: AiRequest,
  context: AiInvocationContext,
) => AiAdapterResponse | Promise<AiAdapterResponse>;

export type MockAiAdapterItem = AiAdapterResponse | Error;

export class MockAiAdapter implements AiAdapter {
  readonly name = 'mock';
  private readonly queue: MockAiAdapterItem[] = [];
  private readonly handler?: MockAiAdapterHandler;

  constructor(itemsOrHandler: MockAiAdapterItem[] | MockAiAdapterHandler = []) {
    if (typeof itemsOrHandler === 'function') {
      this.handler = itemsOrHandler;
    } else {
      this.queue = [...itemsOrHandler];
    }
  }

  async invoke(request: AiRequest, context: AiInvocationContext): Promise<AiAdapterResponse> {
    if (this.handler) return this.handler(request, context);

    const next = this.queue.shift();
    if (next instanceof Error) throw next;
    if (next) return next;

    if (request.responseFormat === 'json') {
      return { text: '{}', json: {} };
    }
    return { text: '' };
  }
}
```

- [ ] **Step 5: Export artifact store and mock adapter**

Modify `packages/fliwright-core/src/index.ts`:

```typescript
export { AiArtifactStore } from './ai/AiArtifactStore.js';
export type { AiArtifactPathInput } from './ai/AiArtifactStore.js';
export { MockAiAdapter } from './ai/adapters/MockAiAdapter.js';
export type { MockAiAdapterHandler, MockAiAdapterItem } from './ai/adapters/MockAiAdapter.js';
```

- [ ] **Step 6: Run artifact and mock adapter tests to verify they pass**

Run:

```bash
pnpm --filter @fliwright/core test -- tests/ai/AiArtifactStore.test.ts tests/ai/MockAiAdapter.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 2**

Run:

```bash
git add packages/fliwright-core/src/index.ts packages/fliwright-core/src/ai/AiArtifactStore.ts packages/fliwright-core/src/ai/adapters/MockAiAdapter.ts packages/fliwright-core/tests/ai/AiArtifactStore.test.ts packages/fliwright-core/tests/ai/MockAiAdapter.test.ts
git commit -m "feat(core): add ai artifacts and mock adapter"
```

## Task 3: AiRuntime Ask, Generate, Visible, Inspect, And Classify

**Files:**
- Create: `packages/fliwright-core/src/ai/AiRuntime.ts`
- Create: `packages/fliwright-core/tests/ai/AiRuntime.test.ts`
- Modify: `packages/fliwright-core/src/index.ts`

- [ ] **Step 1: Write failing runtime tests**

Create `packages/fliwright-core/tests/ai/AiRuntime.test.ts`:

```typescript
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  AiAssertionError,
  AiRuntime,
  MockAiAdapter,
  type AgentSnapshotResult,
  type Page,
} from '../../src/index.js';

function pageStub(): Page {
  return {
    screenshot: vi.fn().mockResolvedValue(Buffer.from('png')),
    snapshot: vi.fn().mockResolvedValue({
      snapshot: '- button "Success" [ref=e1]',
      groupId: 'group-1',
      refs: [],
      count: 1,
    } satisfies AgentSnapshotResult),
  } as unknown as Page;
}

describe('AiRuntime', () => {
  it('generate returns schema-validated adapter JSON', async () => {
    const runtime = new AiRuntime({
      adapter: new MockAiAdapter([{ text: '{"phone":"13800138000"}', json: { phone: '13800138000' } }]),
    });

    const value = await runtime.generate<{ phone: string }>({
      prompt: 'Generate a user',
      schema: {
        type: 'object',
        properties: { phone: { type: 'string' } },
        required: ['phone'],
      },
    });

    expect(value.phone).toBe('13800138000');
  });

  it('generate uses fallback when adapter invocation fails', async () => {
    const runtime = new AiRuntime({
      adapter: new MockAiAdapter([new Error('provider down')]),
    });

    await expect(runtime.generate({
      prompt: 'Generate a user',
      schema: { type: 'object' },
      fallback: { phone: 'fallback' },
    })).resolves.toEqual({ phone: 'fallback' });
  });

  it('visible captures screenshot and snapshot, then passes on provider pass true', async () => {
    const page = pageStub();
    const adapter = new MockAiAdapter(async (request) => {
      expect(request.images?.[0]?.mimeType).toBe('image/png');
      expect(request.metadata?.snapshot).toEqual({
        snapshot: '- button "Success" [ref=e1]',
        groupId: 'group-1',
        refs: [],
        count: 1,
      });
      return { text: '{"pass":true,"reason":"looks good"}', json: { pass: true, reason: 'looks good' } };
    });
    const runtime = new AiRuntime({ adapter }, { page });

    await expect(runtime.visible('Success is visible', { includeSnapshot: true })).resolves.toBeUndefined();
    expect(page.screenshot).toHaveBeenCalledWith({ pixelRatio: 1 });
    expect(page.snapshot).toHaveBeenCalled();
  });

  it('visible throws AiAssertionError on provider pass false', async () => {
    const runtime = new AiRuntime(
      { adapter: new MockAiAdapter([{ text: '{"pass":false,"reason":"error banner"}', json: { pass: false, reason: 'error banner' } }]) },
      { page: pageStub() },
    );
    const result = runtime.visible('No error banner');

    await expect(result).rejects.toBeInstanceOf(AiAssertionError);
    await expect(result).rejects.toThrow('error banner');
  });

  it('inspect returns schema-validated visual JSON', async () => {
    const runtime = new AiRuntime(
      { adapter: new MockAiAdapter([{ text: '{"state":"success"}', json: { state: 'success' } }]) },
      { page: pageStub() },
    );

    await expect(runtime.inspect({
      prompt: 'Classify page state',
      schema: { type: 'object', properties: { state: { enum: ['success', 'error'] } }, required: ['state'] },
    })).resolves.toEqual({ state: 'success' });
  });

  it('classify only returns one of the supplied choices', async () => {
    const runtime = new AiRuntime({
      adapter: new MockAiAdapter([{ text: '{"label":"success"}', json: { label: 'success' } }]),
    });

    await expect(runtime.classify({ prompt: 'Classify', choices: ['success', 'error'] })).resolves.toBe('success');
  });

  it('writes artifacts for successful invocations', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-ai-runtime-'));
    const runtime = new AiRuntime(
      {
        artifactsDir: root,
        adapter: new MockAiAdapter([{ text: '{"ok":true}', json: { ok: true } }]),
      },
      { runId: 'run-1', testName: 'artifact test' },
    );

    const response = await runtime.ask({ prompt: 'Return ok', responseFormat: 'json' });

    expect(response.artifactsDir).toBeDefined();
    expect(await readFile(join(response.artifactsDir!, 'request.json'), 'utf8')).toContain('"prompt": "Return ok"');
    expect(await readFile(join(response.artifactsDir!, 'response.json'), 'utf8')).toContain('"ok": true');
    expect(await readFile(join(response.artifactsDir!, 'meta.json'), 'utf8')).toContain('"status": "passed"');
  });
});
```

- [ ] **Step 2: Run runtime tests to verify they fail**

Run:

```bash
pnpm --filter @fliwright/core test -- tests/ai/AiRuntime.test.ts
```

Expected: FAIL because `AiRuntime` is not exported.

- [ ] **Step 3: Implement AiRuntime**

Create `packages/fliwright-core/src/ai/AiRuntime.ts`:

```typescript
import { AiArtifactStore } from './AiArtifactStore.js';
import { validateJsonSchema } from './AiSchemaValidator.js';
import { AiAssertionError, AiDisabledError, AiInvocationError, AiParseError, AiTimeoutError } from './errors.js';
import type {
  AiAdapter,
  AiArtifactMeta,
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

export class AiRuntime {
  private callCounter = 0;

  constructor(
    private readonly config: AiRuntimeConfig = {},
    private readonly context: AiRuntimeContext = {},
  ) {}

  async ask(input: AiRequest): Promise<AiResponse> {
    const adapter = this.resolveAdapter();
    const callId = `ai-${++this.callCounter}`;
    const timeoutMs = input.timeoutMs ?? this.config.timeoutMs ?? 60_000;
    const store = this.config.artifactsDir ? new AiArtifactStore(this.config.artifactsDir) : undefined;
    const artifactsDir = store
      ? await store.createInvocationDir({ runId: this.context.runId, testName: this.context.testName, callId })
      : undefined;
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      await store?.writeRequest(artifactsDir!, input);
      await store?.writePrompt(artifactsDir!, input.prompt);
      const response = await adapter.invoke(input, {
        callId,
        timeoutMs,
        signal: controller.signal,
        runtime: this.context,
        artifactsDir,
      });
      if (controller.signal.aborted) throw new AiTimeoutError(`AI invocation timed out after ${timeoutMs}ms`, { artifactsDir });
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
      clearTimeout(timeout);
    }
  }

  async generate<T = unknown>(input: AiGenerateRequest<T>): Promise<T> {
    try {
      const response = await this.ask({ ...input, responseFormat: 'json' });
      const json = response.json ?? parseJsonIfNeeded(response.text, 'json', response.artifactsDir);
      return input.schema ? validateJsonSchema<T>(json, input.schema) : json as T;
    } catch (error) {
      if ('fallback' in input) return input.fallback as T;
      throw error;
    }
  }

  async visible(prompt: string, options: AiVisibleOptions = {}): Promise<void> {
    const result = await this.inspect<{ pass: boolean; reason: string }>({
      prompt,
      responseFormat: 'json',
      schema: visibleSchema,
      includeScreenshot: options.includeScreenshot ?? true,
      includeSnapshot: options.includeSnapshot ?? false,
      screenshot: options.screenshot,
      timeoutMs: options.timeoutMs,
    });
    if (!result.pass) throw new AiAssertionError(result.reason || 'provider returned pass=false');
  }

  async inspect<T = unknown>(input: AiInspectRequest): Promise<T> {
    const request = await this.withVisionContext(input);
    const response = await this.ask({ ...request, responseFormat: 'json' });
    const json = response.json ?? parseJsonIfNeeded(response.text, 'json', response.artifactsDir);
    return input.schema ? validateJsonSchema<T>(json, input.schema) : json as T;
  }

  async classify(input: AiClassifyRequest): Promise<string> {
    const response = await this.generate<{ label: string }>({
      ...input,
      schema: { type: 'object', properties: { label: { type: 'string', enum: input.choices } }, required: ['label'] },
    });
    return response.label;
  }

  private async withVisionContext(input: AiInspectRequest): Promise<AiRequest> {
    const includeScreenshot = input.includeScreenshot ?? this.config.defaultVisionContext?.includeScreenshot ?? true;
    const includeSnapshot = input.includeSnapshot ?? this.config.defaultVisionContext?.includeSnapshot ?? false;
    const images = [...(input.images ?? [])];
    const metadata = { ...(input.metadata ?? {}) };

    if (includeScreenshot) {
      if (!this.context.page) throw new AiInvocationError('AI vision request requires a Page in runtime context');
      const screenshot = await this.context.page.screenshot(input.screenshot ?? { pixelRatio: 1 });
      images.push({ name: 'screenshot.png', mimeType: 'image/png', data: screenshot });
    }

    if (includeSnapshot) {
      if (!this.context.page) throw new AiInvocationError('AI snapshot request requires a Page in runtime context');
      metadata.snapshot = await this.context.page.snapshot();
    }

    return { ...input, images, metadata };
  }

  private resolveAdapter(): AiAdapter {
    if (this.config.enabled === false || this.config.provider === 'none') {
      throw new AiDisabledError('AI runtime is disabled. Configure FLIWRIGHT_AI_PROVIDER or createFliwrightTest({ ai }).');
    }
    const adapter = this.config.adapter;
    if (!adapter || !('invoke' in adapter)) {
      throw new AiDisabledError('AI runtime has no adapter. Configure provider mock, claude, codex, or custom-cli.');
    }
    return adapter;
  }
}

const visibleSchema: JsonSchema = {
  type: 'object',
  properties: {
    pass: { type: 'boolean' },
    reason: { type: 'string' },
  },
  required: ['pass', 'reason'],
};

function parseJsonIfNeeded(text: string, responseFormat: AiRequest['responseFormat'], artifactsDir?: string): unknown {
  if (responseFormat !== 'json') return undefined;
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new AiParseError('AI response was not valid JSON', { cause, artifactsDir });
  }
}

function normalizeError(error: unknown, artifactsDir?: string): AiInvocationError {
  if (error instanceof AiInvocationError) return error;
  if (error instanceof Error) return new AiInvocationError(error.message, { cause: error, artifactsDir });
  return new AiInvocationError(String(error), { artifactsDir });
}

function buildMeta(provider: string, status: AiArtifactMeta['status'], startedAt: number, raw: unknown): AiArtifactMeta {
  const rawMeta = isRecord(raw) ? raw : {};
  return {
    provider,
    status,
    durationMs: Date.now() - startedAt,
    exitCode: typeof rawMeta.exitCode === 'number' || rawMeta.exitCode === null ? rawMeta.exitCode : undefined,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
```

- [ ] **Step 4: Export AiRuntime**

Modify `packages/fliwright-core/src/index.ts`:

```typescript
export { AiRuntime } from './ai/AiRuntime.js';
```

- [ ] **Step 5: Run runtime tests to verify they pass**

Run:

```bash
pnpm --filter @fliwright/core test -- tests/ai/AiRuntime.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 3**

Run:

```bash
git add packages/fliwright-core/src/index.ts packages/fliwright-core/src/ai/AiRuntime.ts packages/fliwright-core/tests/ai/AiRuntime.test.ts
git commit -m "feat(core): add ai runtime helpers"
```

## Task 4: CLI JSON Adapter And Claude/Codex Wrappers

**Files:**
- Create: `packages/fliwright-core/src/ai/adapters/CliJsonAdapter.ts`
- Create: `packages/fliwright-core/src/ai/adapters/ClaudeCliAdapter.ts`
- Create: `packages/fliwright-core/src/ai/adapters/CodexCliAdapter.ts`
- Create: `packages/fliwright-core/tests/ai/CliJsonAdapter.test.ts`
- Modify: `packages/fliwright-core/src/index.ts`

- [ ] **Step 1: Write failing CLI adapter tests**

Create `packages/fliwright-core/tests/ai/CliJsonAdapter.test.ts`:

```typescript
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AiParseError, AiTimeoutError, CliJsonAdapter } from '../../src/index.js';

async function fakeCli(source: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'fliwright-ai-cli-'));
  const path = join(dir, 'fake-cli.mjs');
  await writeFile(path, source, { mode: 0o755 });
  return path;
}

describe('CliJsonAdapter', () => {
  it('passes normalized request JSON over stdin and parses stdout JSON', async () => {
    const command = await fakeCli(`
      let input = '';
      process.stdin.on('data', chunk => input += chunk);
      process.stdin.on('end', () => {
        const request = JSON.parse(input);
        process.stdout.write(JSON.stringify({ text: JSON.stringify({ prompt: request.prompt }), json: { prompt: request.prompt } }));
      });
    `);
    const adapter = new CliJsonAdapter({ command: process.execPath, args: [command], inputMode: 'stdin-json' });

    const response = await adapter.invoke(
      { prompt: 'hello', responseFormat: 'json' },
      { callId: 'call-1', timeoutMs: 1000, signal: new AbortController().signal, runtime: {} },
    );

    expect(response.json).toEqual({ prompt: 'hello' });
  });

  it('parses a fenced JSON block when stdout has surrounding text', async () => {
    const command = await fakeCli(`
      process.stdin.resume();
      process.stdin.on('end', () => {
        process.stdout.write('Result:\\n\\\`\\\`\\\`json\\n{"text":"ok","json":{"ok":true}}\\n\\\`\\\`\\\`\\n');
      });
    `);
    const adapter = new CliJsonAdapter({ command: process.execPath, args: [command], inputMode: 'stdin-json' });

    await expect(adapter.invoke(
      { prompt: 'ok', responseFormat: 'json' },
      { callId: 'call-1', timeoutMs: 1000, signal: new AbortController().signal, runtime: {} },
    )).resolves.toMatchObject({ json: { ok: true } });
  });

  it('throws AiParseError for non-json output when json is required', async () => {
    const command = await fakeCli(`process.stdout.write('not json');`);
    const adapter = new CliJsonAdapter({ command: process.execPath, args: [command], inputMode: 'stdin-json' });

    await expect(adapter.invoke(
      { prompt: 'bad', responseFormat: 'json' },
      { callId: 'call-1', timeoutMs: 1000, signal: new AbortController().signal, runtime: {} },
    )).rejects.toBeInstanceOf(AiParseError);
  });

  it('throws with stderr when the process exits non-zero', async () => {
    const command = await fakeCli(`process.stderr.write('boom'); process.exit(2);`);
    const adapter = new CliJsonAdapter({ command: process.execPath, args: [command], inputMode: 'stdin-json' });

    await expect(adapter.invoke(
      { prompt: 'fail' },
      { callId: 'call-1', timeoutMs: 1000, signal: new AbortController().signal, runtime: {} },
    )).rejects.toThrow('boom');
  });

  it('kills the process and throws AiTimeoutError on timeout', async () => {
    const command = await fakeCli(`setTimeout(() => process.stdout.write('late'), 2000);`);
    const adapter = new CliJsonAdapter({ command: process.execPath, args: [command], inputMode: 'stdin-json' });

    await expect(adapter.invoke(
      { prompt: 'slow' },
      { callId: 'call-1', timeoutMs: 10, signal: new AbortController().signal, runtime: {} },
    )).rejects.toBeInstanceOf(AiTimeoutError);
  });
});
```

- [ ] **Step 2: Run CLI adapter tests to verify they fail**

Run:

```bash
pnpm --filter @fliwright/core test -- tests/ai/CliJsonAdapter.test.ts
```

Expected: FAIL because `CliJsonAdapter` is not exported.

- [ ] **Step 3: Implement the CLI JSON adapter**

Create `packages/fliwright-core/src/ai/adapters/CliJsonAdapter.ts`:

```typescript
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { spawn } from 'node:child_process';
import { AiInvocationError, AiParseError, AiTimeoutError } from '../errors.js';
import type { AiAdapter, AiAdapterResponse, AiCliAdapterOptions, AiInvocationContext, AiRequest } from '../types.js';

export class CliJsonAdapter implements AiAdapter {
  readonly name: string;
  private readonly args: string[];
  private readonly inputMode: 'stdin-json' | 'request-file';

  constructor(private readonly options: AiCliAdapterOptions) {
    this.name = options.provider ?? 'custom-cli';
    this.args = options.args ?? [];
    this.inputMode = options.inputMode ?? 'stdin-json';
  }

  async invoke(request: AiRequest, context: AiInvocationContext): Promise<AiAdapterResponse> {
    const normalized = normalizeRequest(request);
    const { args, stdin } = await this.buildInput(normalized);
    return new Promise<AiAdapterResponse>((resolve, reject) => {
      const child = spawn(this.options.command, [...this.args, ...args], {
        cwd: this.options.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill('SIGTERM');
        reject(new AiTimeoutError(`AI CLI timed out after ${context.timeoutMs}ms`, { artifactsDir: context.artifactsDir }));
      }, context.timeoutMs);

      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', chunk => { stdout += chunk; });
      child.stderr.on('data', chunk => { stderr += chunk; });
      child.on('error', error => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(new AiInvocationError(error.message, { cause: error, artifactsDir: context.artifactsDir }));
      });
      child.on('close', code => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (code !== 0) {
          reject(new AiInvocationError(stderr.trim() || `AI CLI exited with code ${code}`, { artifactsDir: context.artifactsDir }));
          return;
        }
        try {
          resolve(parseCliOutput(stdout, request.responseFormat, { exitCode: code, stderr, command: basename(this.options.command), args: this.args }));
        } catch (error) {
          reject(error);
        }
      });
      child.stdin.end(stdin);
    });
  }

  private async buildInput(request: unknown): Promise<{ args: string[]; stdin: string }> {
    const json = `${JSON.stringify(request, null, 2)}\n`;
    if (this.inputMode === 'request-file') {
      const dir = await mkdtemp(join(tmpdir(), 'fliwright-ai-request-'));
      const path = join(dir, 'request.json');
      await writeFile(path, json);
      return { args: [path], stdin: '' };
    }
    return { args: [], stdin: json };
  }
}

function normalizeRequest(request: AiRequest): Record<string, unknown> {
  return {
    ...request,
    images: request.images?.map(image => ({
      name: image.name,
      mimeType: image.mimeType,
      data: Buffer.isBuffer(image.data) ? image.data.toString('base64') : image.data,
    })),
    files: request.files?.map(file => ({
      name: file.name,
      mimeType: file.mimeType,
      content: Buffer.isBuffer(file.content) ? file.content.toString('base64') : file.content,
    })),
  };
}

function parseCliOutput(stdout: string, responseFormat: AiRequest['responseFormat'], raw: unknown): AiAdapterResponse {
  const jsonText = extractJson(stdout);
  if (!jsonText) {
    if (responseFormat === 'json') throw new AiParseError('AI CLI did not return JSON');
    return { text: stdout, raw };
  }
  try {
    const parsed = JSON.parse(jsonText) as Partial<AiAdapterResponse>;
    return {
      text: typeof parsed.text === 'string' ? parsed.text : jsonText,
      json: parsed.json,
      metadata: parsed.metadata,
      raw,
    };
  } catch (cause) {
    throw new AiParseError('AI CLI returned invalid JSON', { cause });
  }
}

function extractJson(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed;
  const fenced = trimmed.match(/```json\s*([\s\S]*?)\s*```/i);
  return fenced?.[1]?.trim() ?? null;
}
```

- [ ] **Step 4: Add Claude and Codex wrappers**

Create `packages/fliwright-core/src/ai/adapters/ClaudeCliAdapter.ts`:

```typescript
import { CliJsonAdapter } from './CliJsonAdapter.js';
import type { AiCliAdapterOptions } from '../types.js';

export class ClaudeCliAdapter extends CliJsonAdapter {
  constructor(options: Omit<AiCliAdapterOptions, 'provider'> = { command: 'claude' }) {
    super({ inputMode: 'stdin-json', ...options, provider: 'claude' });
  }
}
```

Create `packages/fliwright-core/src/ai/adapters/CodexCliAdapter.ts`:

```typescript
import { CliJsonAdapter } from './CliJsonAdapter.js';
import type { AiCliAdapterOptions } from '../types.js';

export class CodexCliAdapter extends CliJsonAdapter {
  constructor(options: Omit<AiCliAdapterOptions, 'provider'> = { command: 'codex', args: ['exec', '--json'] }) {
    super({ inputMode: 'stdin-json', ...options, provider: 'codex' });
  }
}
```

- [ ] **Step 5: Export CLI adapters**

Modify `packages/fliwright-core/src/index.ts`:

```typescript
export { CliJsonAdapter } from './ai/adapters/CliJsonAdapter.js';
export { ClaudeCliAdapter } from './ai/adapters/ClaudeCliAdapter.js';
export { CodexCliAdapter } from './ai/adapters/CodexCliAdapter.js';
```

- [ ] **Step 6: Run CLI adapter tests to verify they pass**

Run:

```bash
pnpm --filter @fliwright/core test -- tests/ai/CliJsonAdapter.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 4**

Run:

```bash
git add packages/fliwright-core/src/index.ts packages/fliwright-core/src/ai/adapters/CliJsonAdapter.ts packages/fliwright-core/src/ai/adapters/ClaudeCliAdapter.ts packages/fliwright-core/src/ai/adapters/CodexCliAdapter.ts packages/fliwright-core/tests/ai/CliJsonAdapter.test.ts
git commit -m "feat(core): add ai cli adapters"
```

## Task 5: Vitest AI Fixture And Environment Configuration

**Files:**
- Modify: `packages/fliwright-vitest/src/index.ts`
- Modify: `packages/fliwright-vitest/tests/integration.test.ts`

- [ ] **Step 1: Write failing Vitest fixture tests**

Modify `packages/fliwright-vitest/tests/integration.test.ts` to add imports:

```typescript
import { AiRuntime } from '@fliwright/core';
```

Add tests under `describe('createFliwrightTest', () => { ... })`:

```typescript
  it('creates a test function with an ai fixture when configured', () => {
    const test = createFliwrightTest({
      vmServiceUrl: 'ws://localhost:12345/ws',
      ai: { provider: 'mock' },
    });
    expect(test).toBeDefined();
    expect(typeof test).toBe('function');
  });

  it('defineConfig preserves ai options', () => {
    const config = defineConfig({
      vmServiceUrl: 'ws://localhost:12345/ws',
      ai: {
        provider: 'mock',
        timeoutMs: 1234,
        artifactsDir: '.fliwright/ai-test',
      },
    });

    expect(config.ai).toMatchObject({
      provider: 'mock',
      timeoutMs: 1234,
      artifactsDir: '.fliwright/ai-test',
    });
  });

  it('exports AiRuntime through fixture types', () => {
    const runtime: AiRuntime | undefined = undefined;
    expect(runtime).toBeUndefined();
  });
```

- [ ] **Step 2: Run Vitest package tests to verify they fail**

Run:

```bash
pnpm --filter @fliwright/vitest test -- tests/integration.test.ts
```

Expected: FAIL because `FliwrightConfig` does not include `ai`.

- [ ] **Step 3: Add AI imports and fixture types**

Modify the imports in `packages/fliwright-vitest/src/index.ts`:

```typescript
import {
  AiRuntime,
  ClaudeCliAdapter,
  CodexCliAdapter,
  MockAiAdapter,
  AssertionError,
  Assertion,
  FailureCollector,
  FliwrightDriver,
  TraceCollector,
  TraceStore,
  isActionMethod,
  createExpect,
} from '@fliwright/core';
import type { AiAdapter, AiRuntimeConfig, FailureContext, HealingReport, Locator, Page, VMServiceEvent, TraceMode } from '@fliwright/core';
```

Modify `FliwrightConfig`:

```typescript
export interface FliwrightConfig {
  vmServiceUrl: string;
  timeout?: number;
  screenshot?: 'file' | 'base64' | 'off';
  ai?: AiRuntimeConfig;
}
```

Modify `createFliwrightTest` fixture type:

```typescript
const fliwrightTest = vitestTest.extend<{ page: Page; driver: FliwrightDriver; ai: AiRuntime }>({
```

- [ ] **Step 4: Add the `ai` fixture**

Inside the object passed to `vitestTest.extend`, after the `page` fixture, add:

```typescript
    ai: async ({ task }, use) => {
      const driver = await getSharedDriver(config);
      const testName = getTestName(task);
      const runtime = createAiRuntime(config.ai, {
        page: driver.page,
        driver,
        testName,
        runId,
        cwd: process.cwd(),
      });
      await use(runtime);
    },
```

Add helper functions near the existing parsers:

```typescript
function createAiRuntime(config: AiRuntimeConfig | undefined, context: ConstructorParameters<typeof AiRuntime>[1]): AiRuntime {
  const resolved = resolveAiConfig(config);
  return new AiRuntime(resolved, context);
}

function resolveAiConfig(config: AiRuntimeConfig | undefined): AiRuntimeConfig {
  const provider = config?.provider ?? parseAiProvider(process.env.FLIWRIGHT_AI_PROVIDER);
  const enabled = config?.enabled ?? parseAiEnabled(process.env.FLIWRIGHT_AI_ENABLED, provider);
  return {
    provider,
    timeoutMs: config?.timeoutMs ?? parsePositiveInt(process.env.FLIWRIGHT_AI_TIMEOUT_MS) ?? 60_000,
    artifactsDir: config?.artifactsDir ?? process.env.FLIWRIGHT_AI_ARTIFACTS_DIR ?? '.fliwright/ai',
    cache: config?.cache ?? parseAiCache(process.env.FLIWRIGHT_AI_CACHE),
    maxConcurrency: config?.maxConcurrency ?? 1,
    defaultVisionContext: config?.defaultVisionContext,
    enabled,
    adapter: config?.adapter && 'invoke' in config.adapter ? config.adapter : createAiAdapter(config),
  };
}

function createAiAdapter(config: AiRuntimeConfig | undefined): AiAdapter | undefined {
  if (config?.adapter && 'invoke' in config.adapter) return config.adapter;
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
  return undefined;
}

function parseAiProvider(value: string | undefined): AiRuntimeConfig['provider'] {
  if (value === 'mock' || value === 'claude' || value === 'codex' || value === 'custom-cli' || value === 'none') return value;
  return 'none';
}

function parseAiCache(value: string | undefined): AiRuntimeConfig['cache'] {
  if (value === 'read' || value === 'write' || value === 'read-write') return value;
  return 'off';
}

function parseAiEnabled(value: string | undefined, provider: AiRuntimeConfig['provider']): boolean {
  if (value === 'false') return false;
  if (value === 'true') return true;
  return provider !== 'none';
}

function parseAiArgs(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  return value.split(',').map(arg => arg.trim()).filter(Boolean);
}
```

- [ ] **Step 5: Run Vitest package tests to verify they pass**

Run:

```bash
pnpm --filter @fliwright/vitest test -- tests/integration.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 5**

Run:

```bash
git add packages/fliwright-vitest/src/index.ts packages/fliwright-vitest/tests/integration.test.ts
git commit -m "feat(vitest): add ai fixture"
```

## Task 6: Runtime Hardening, Typecheck, And Documentation Refresh

**Files:**
- Modify: `docs/features/index.md` and relevant generated feature docs only through the repository feature documentation workflow.
- Modify: any AI source/tests from earlier tasks if verification finds strict-mode or behavior gaps.

- [ ] **Step 1: Run focused AI test suite**

Run:

```bash
pnpm --filter @fliwright/core test -- tests/ai
pnpm --filter @fliwright/vitest test -- tests/integration.test.ts
```

Expected: PASS for all AI-related tests.

- [ ] **Step 2: Run package lint/typecheck**

Run:

```bash
pnpm --filter @fliwright/core lint
pnpm --filter @fliwright/vitest lint
```

Expected: PASS. If strict-mode errors appear, fix the exact typed line and rerun the same command.

- [ ] **Step 3: Run package build**

Run:

```bash
pnpm --filter @fliwright/core build
pnpm --filter @fliwright/vitest build
```

Expected: PASS and generated `dist` output for both packages.

- [ ] **Step 4: Run full TypeScript tests if package checks pass**

Run:

```bash
pnpm test
```

Expected: PASS. If unrelated existing failures appear, capture the failing test names and confirm they do not come from the AI runtime changes.

- [ ] **Step 5: Refresh AI-consumable feature documentation**

Run the repository feature documentation workflow:

```bash
/document-features
```

Expected: `docs/features/` includes `@fliwright/core` AI runtime exports and the `@fliwright/vitest` `ai` fixture. If the slash command is unavailable, update the smallest relevant generated docs manually: `docs/features/index.md`, `docs/features/core/README.md`, and `docs/features/vitest/test.md`.

- [ ] **Step 6: Self-review artifacts and security posture**

Check the implementation manually:

```bash
rg "shell|exec\\(|execFile|process\\.env" packages/fliwright-core/src/ai packages/fliwright-vitest/src/index.ts
rg "api[_-]?key|token|secret|password" packages/fliwright-core/src/ai packages/fliwright-vitest/src/index.ts
```

Expected: no shell execution API usage; environment variables are read only for configuration; artifact metadata does not write secret values.

- [ ] **Step 7: Commit Task 6**

Run:

```bash
git add packages/fliwright-core packages/fliwright-vitest docs/features
git commit -m "docs: document ai runtime tools"
```

## Plan Self-Review

- Spec coverage: Task 1 covers public types, typed errors, and schema validation. Task 2 covers artifacts and deterministic mock adapter. Task 3 covers `ask`, `generate`, `visible`, `inspect`, `classify`, screenshot/snapshot collection, fallback, and assertion behavior. Task 4 covers safe CLI process adapters for Claude/Codex and parse/timeout failures. Task 5 covers Vitest fixture injection and environment configuration. Task 6 covers verification, security checks, and feature docs.
- Scope check: This is one implementation plan for the MVP in the approved design. Advanced report integration, persistent sessions, MCP runtime transport, HTTP providers, and cache read/write implementation remain deferred as designed.
- Placeholder scan: No task uses placeholder markers, vague "add tests" instructions, or references to undefined task-local APIs without showing expected files and snippets.
- Type consistency: The plan consistently uses `AiRuntime`, `AiRuntimeConfig`, `AiAdapter`, `AiRequest`, `AiAdapterResponse`, `JsonSchema`, `MockAiAdapter`, `CliJsonAdapter`, `ClaudeCliAdapter`, and `CodexCliAdapter`.
