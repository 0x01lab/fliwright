# AI As A Universal Capability — Design

**Date:** 2026-06-15
**Status:** Approved design (pending implementation plan)
**Supersedes / extends:** `2026-06-14-ai-runtime-tools-design.md` (the MVP runtime stays; this adds a universal access layer)

## Goal

Make the `ai.*` tool functions a **general-purpose capability** that any fliwright tool can call directly — in `@fliwright/core` internals, `@fliwright/vitest` tests, `@fliwright/mcp` agent tools, and `@fliwright/vscode` — without dependency injection, fixture objects, or per-host ceremony.

The user-facing contract: import `ai`, call it.

```ts
import { ai, configureAi } from '@fliwright/core';

await ai.generate({ prompt, schema, fallback: { phone: '13800138000' } });
const label = await ai.classify({ prompt, choices: ['成功', '失败'] });
await ai.visible('登录成功', { page });
await ai.inspect({ prompt, schema }, { page });
```

## Non-Goals

- **Caching / record-replay** is explicitly out of scope (deferred per earlier discussion).
- **HTTP provider, MCP client transport, persistent multi-turn sessions** remain deferred (Phase 5 of the MVP design).
- **`maxConcurrency` enforcement** is out of scope here (still dead config; tracked separately).
- **FormHelper async refactor** is a *consumer* task, not part of this capability. FormHelper is named below as the canonical first consumer; its sync value-contract change is planned separately and only blocks FormHelper's adoption, not the capability itself.

## Architecture

A thin **capability module** sits on top of the existing `AiRuntime` engine. It owns a single long-lived `AiRuntime` instance and exposes the five methods as a module-level `ai` namespace. `AiRuntime` is unchanged in behavior; it gains one backward-compatible addition so per-call page context can flow in without constructing a new runtime.

```
@fliwright/core/src/ai/
  AiRuntime.ts          (engine, unchanged behavior + per-call page override)
  config.ts             (NEW — env resolution + adapter factory, moved out of vitest)
  capability.ts         (NEW — shared runtime, configureAi(), ai namespace)
  types.ts errors.ts AiSchemaValidator.ts AiArtifactStore.ts adapters/*  (unchanged)
```

`@fliwright/core` re-exports `ai` and `configureAi`. Every other package imports them from `@fliwright/core`.

### Why one shared long-lived runtime

`AiRuntime.callCounter` increments per call to produce unique `callId`s, which feed the artifact path `<runId>/<testSlug>/<callId>/`. Constructing a fresh runtime per call would reset the counter to `ai-1` every time and **collide artifact directories**. Therefore the capability module must hold a single `AiRuntime` whose counter persists across calls.

This is why per-call page context cannot come from "construct a runtime with this page." Instead, `AiRuntime` accepts an optional `page`/`driver` override on the vision options (see below), and the namespace forwards the caller's page into the existing shared runtime.

## API Surface

### `configureAi(config?: AiRuntimeConfig): void`

Sets the configuration for the shared runtime. Safe to call multiple times; the shared runtime is rebuilt on the next `ai.*` call. If `config.adapter` is omitted, an adapter is resolved from `config.provider` (or env). Called once at host startup (MCP server init, VSCode activation, optional vitest setup).

If never called, the shared runtime is resolved lazily from environment variables on the first `ai.*` call.

### The `ai` namespace

| Function | Signature | Page required |
|----------|-----------|---------------|
| `ai.ask(req)` | `(req: AiRequest) => Promise<AiResponse>` | no |
| `ai.generate<T>(req)` | `(req: AiGenerateRequest<T>) => Promise<T>` | no |
| `ai.classify(req)` | `(req: AiClassifyRequest) => Promise<string>` | no |
| `ai.visible(prompt, opts)` | `(prompt: string, opts: AiVisibleOptions & { page, driver? }) => Promise<void>` | **yes** |
| `ai.inspect<T>(req, opts)` | `(req: AiInspectRequest, opts: { page, driver? }) => Promise<T>` | **yes** |

`page` and `driver` are forwarded into the runtime's per-call vision context. `testName` and `runId` may be passed via the same options to tag artifacts; when omitted they default to `'unknown'` / `'run'` as today.

To keep the signature uniform, **every** namespace method accepts an optional trailing options object `{ page?, driver?, testName?, runId? }`. For `ask`/`generate`/`classify` only `testName`/`runId` are consumed (artifact tagging); `page`/`driver` are ignored. For `visible`/`inspect` all four apply.

`ai.visible` / `ai.inspect` throw `AiInvocationError` when `page` is missing (cannot capture screenshot/snapshot).

## Configuration & Lifecycle

- **Lazy env resolution** (moved into `@fliwright/core/src/ai/config.ts`, re-used by vitest): `FLIWRIGHT_AI_PROVIDER`, `FLIWRIGHT_AI_ENABLED`, `FLIWRIGHT_AI_TIMEOUT_MS`, `FLIWRIGHT_AI_ARTIFACTS_DIR`, `FLIWRIGHT_AI_CACHE`, `FLIWRIGHT_AI_COMMAND`, `FLIWRIGHT_AI_ARGS`. Default provider is `none`.
- **Default-off safety**: with no provider configured, every `ai.*` call throws `AiDisabledError`. CI stays free of real provider calls and unexpected cost unless explicitly enabled.
- **Determinism**: `configureAi({ provider: 'mock' })` (or `FLIWRIGHT_AI_PROVIDER=mock`) yields deterministic output via the existing `MockAiAdapter`.
- **Default artifacts dir**: `.fliwright/ai`, unchanged.

## Per-Call Context Override (the one `AiRuntime` change)

Because the capability holds a single long-lived runtime, per-call context must flow in as method-level overrides rather than via construction. `AiRuntime` methods gain an optional trailing `callContext?: { page?, driver?, testName?, runId? }`:

- `withVisionContext` uses `input.page ?? callContext?.page ?? this.context.page` (and `driver` likewise).
- `ask` uses `callContext?.runId ?? this.context.runId` and `callContext?.testName ?? this.context.testName` when building the artifact directory.

This is purely additive: existing callers that supply context via the runtime constructor keep working unchanged; every existing test omits the new optional arg and behaves identically. No existing test changes.

## Consumer Wiring

| Consumer | How it uses the capability |
|----------|---------------------------|
| `@fliwright/core` internals (e.g. FormHelper, FailureCollector) | `import { ai } from '../...';` and call directly. |
| `@fliwright/vitest` | `ai` namespace available globally. The existing per-test fixture is **renamed `aiRuntime`** (returns an `AiRuntime` with page pre-bound) and kept for backward-compatible ergonomics; new code uses the global `ai`. |
| `@fliwright/mcp` | `server.ts` calls `configureAi(...)` at startup. Tools `import { ai }` and call. (`ServerState` may expose `getAi()` but direct import is preferred.) |
| `@fliwright/vscode` | Activation calls `configureAi(...)` when an AI provider is configured; commands call `ai.*`. |

## Relationship To Existing Code

- **`AiRuntime` class**: retained as the engine; behavior unchanged except the additive per-call page override. All 27 existing AI tests continue to pass.
- **Env resolution (`resolveAiConfig`, `createAiAdapter`, `parseAi*`)**: currently lives in `packages/fliwright-vitest/src/index.ts`. It moves to `packages/fliwright-core/src/ai/config.ts`; vitest imports it from core to avoid duplication and to let the capability self-resolve.
- **vitest `ai` fixture**: renamed to `aiRuntime`. The fixture's type in `createFliwrightTest` becomes `{ page, driver, aiRuntime }`. Existing test files that destructure `({ ai })` are updated to `({ aiRuntime })`. (The integration tests already reference it; they move with the rename.)

## Error Handling & Fallback

Unchanged from the MVP:

- All failures normalize to typed errors: `AiInvocationError`, `AiTimeoutError`, `AiParseError`, `AiSchemaValidationError`, `AiAssertionError`.
- `ai.generate` honors `fallback` and returns it on any failure instead of throwing.
- `ai.visible` throws `AiAssertionError` (no fallback) so the verified state is never hidden.
- Missing page on a vision call throws `AiInvocationError` with a clear message.

## Security

Unchanged. Only `spawn(command, args)`; no shell strings. Artifact `meta.json` records provider, command basename, args, status, duration, exit code, error type — never secrets or env values. Screenshots/snapshots sent only for vision calls.

## Testing Strategy

Unit tests in `packages/fliwright-core/tests/ai/`:

- `capability.test.ts`:
  - `ai.generate` returns schema-validated JSON through a configured `MockAiAdapter`.
  - `ai.generate` returns `fallback` when the adapter fails.
  - `ai.classify` returns a value within `choices`.
  - `ai.visible(prompt, { page })` captures screenshot via the passed page and passes/fails on provider verdict.
  - `ai.visible` throws `AiInvocationError` when `page` is omitted.
  - `ai.inspect` returns schema-validated visual JSON with a passed page.
  - Unconfigured `ai.generate` throws `AiDisabledError`.
  - `configureAi({ provider: 'mock', adapter })` is honored; subsequent calls use the new adapter.
  - Shared runtime preserves unique `callId`s / artifact directories across successive calls (the long-lived-runtime invariant).
- `config.test.ts`: env parsing moved to core is covered (`FLIWRIGHT_AI_*` → `AiRuntimeConfig`, default provider `none`).

Vitest integration: `createFliwrightTest` fixture is `aiRuntime`; `defineConfig({ ai })` still preserves options.

Live Claude/Codex smoke tests remain opt-in behind `FLIWRIGHT_AI_LIVE=1` (still not implemented in this slice; tracked separately — see Gap D in the earlier audit).

## Open Decisions Resolved

1. **Access model**: module-level `ai` namespace + `configureAi()` (user choice: "just a set of functions, call directly").
2. **Vision page source**: explicit `page` parameter on `ai.visible` / `ai.inspect` (user choice).
3. **Config lifecycle**: lazy env resolution + optional `configureAi()`; default-off.
4. **Naming collision**: global namespace stays `ai`; vitest fixture renamed `aiRuntime` (user choice).

## Acceptance Criteria

- `@fliwright/core` exports `ai` (namespace) and `configureAi`.
- Any package can `import { ai } from '@fliwright/core'` and call `ai.generate` / `ai.classify` / `ai.visible` / `ai.inspect` / `ai.ask` with no fixture or DI.
- `ai.visible` / `ai.inspect` accept an explicit `page` and throw `AiInvocationError` without it.
- Unconfigured usage throws `AiDisabledError`; `configureAi({ provider: 'mock' })` makes calls deterministic.
- The shared runtime preserves unique artifact directories across calls.
- Env-resolution logic lives in `@fliwright/core` and is shared by vitest.
- The vitest fixture is renamed `aiRuntime`; existing tests updated.
- All existing AI tests (27) and the full core suite remain green; new capability/config tests added.
- No breaking change to `AiRuntime`'s public surface beyond the additive per-call context override (`page`/`driver`/`testName`/`runId`).

## Delivery Plan

1. Move env/adapter resolution into `@fliwright/core/src/ai/config.ts`; vitest imports it.
2. Add per-call context override (`page`/`driver`/`testName`/`runId`) to `AiRuntime` methods.
3. Add `@fliwright/core/src/ai/capability.ts` (`configureAi`, shared runtime, `ai` namespace); export from index.
4. Rename vitest `ai` fixture → `aiRuntime`; update its integration tests.
5. Add capability + config unit tests; run full core/vitest suites.
6. (Optional first consumer, separate task) Wire `ai.generate` into FormHelper as a value source with faker fallback — gated on the FormHelper sync-contract decision.
