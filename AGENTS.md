# Repository Agent Instructions

Fliwright is a TypeScript-scripted Flutter automation & E2E-testing platform: a
Dart VM-Service bridge (`fliwright_bridge`) instrumented inside the app, a TS
core (`@fliwright/core`) that drives it, and integrations for Vitest, an MCP
server, a CLI, a VS Code extension, and a Riverpod state plugin. It is an
**automation runtime**, not only a test framework — tests are scripts plus
assertions; scripts can also drive the app to perform arbitrary tasks.

This file is intentionally **self-contained**. The hard constraints below are all
you need for typical work, so no other file must be read up front. Everything
else is linked as **on-demand reference** — open it only when the task actually
needs it, never as a routine. Keeping the loaded context small is an explicit
goal; do not pre-read `docs/` or `memory/` "just in case".

## Hard constraints (apply always)

### Coding style

**TypeScript** — ESM, strict mode, Node16 module resolution, ES2022 targets.
Keep source in `src`, export public APIs from `src/index.ts`, and include `.js`
extensions in relative imports. PascalCase for classes/types, camelCase for
functions/variables, `*.test.ts` for Vitest tests.

**Dart** — standard `dart format` with two-space indentation. snake_case
filenames, PascalCase classes, camelCase members.

### Build & test commands

- TS: `pnpm install` after dependency changes; `pnpm build`; `pnpm test`;
  `pnpm lint` (runs `tsc --noEmit`); scope to one package with
  `pnpm --filter @fliwright/core test`.
- Dart: `melos bootstrap` to fetch dependencies; `melos run analyze`
  (`dart analyze .`); `melos run test` (`dart test`).
- China pub mirror (optional — use when pub.dev is unreachable): source
  `scripts/use-cn-pub-mirror.sh` to route Flutter/Dart package resolution
  through `pub.flutter-io.cn` before `flutter pub get` / `dart test`. It is
  opt-in, session-scoped, and does not change resolved versions.
- E2E smoke tests require a running Flutter VM service:
  `FLIWRIGHT_VM_SERVICE_URL=... pnpm --filter @fliwright/e2e-tests test:smoke`.
- When someone mentions the "exio app", they mean the project at
  `/Users/leo.he/projects/exio/exio_app`, which can be used for debugging.

### Testing

Vitest is the TypeScript test framework. Place focused unit tests beside each
package under `tests`, mirroring the source subject (e.g. `Locator.test.ts`,
`runTest.test.ts`). **Add a regression test whenever you change selectors,
protocol behavior, MCP tools, or code generation.** Dart bridge tests use
`dart test`; Flutter demo tests live under `examples/riverpod_demo/test`.

### Security & configuration

Do not commit generated build output (`dist`), Flutter-generated files, local VM
service URLs, or device-specific configuration. Keep test fixtures deterministic
and never embed secrets in docs, examples, or generated tests.

## On-demand reference (open only if the task needs it)

- [Project structure](./memory/repository-guidelines/project-structure.md) —
  where each TS/Dart package, its tests, examples, and docs live.
- [Commit & PR guidelines](./memory/repository-guidelines/commit-and-pr-guidelines.md)
  — Conventional Commit scopes and PR expectations (read when committing or
  opening a PR).
- [Feature documentation](./memory/repository-guidelines/feature-documentation.md)
  — how `docs/features/` is organized and regenerated.

## `docs/` is strictly on-demand

`docs/features/` is the generated source of truth for implemented APIs. When you
need the *current* API of the exact component you are changing, open **that
specific per-class doc** (for example `docs/features/core/Selector.md`) — do
**not** load `docs/features/index.md` as a routine; it is a ~23 KB lookup table,
use it for lookup only. `docs/superpowers/` (plans and specs) is historical
background — read a slice's design only when extending that slice. Regenerate
`docs/features/` with the `/document-features` command after significant source
changes.

## Feature Documentation

AI-consumable feature documentation lives in `docs/features/`. These docs summarize
every implemented feature with full API signatures, type definitions, and usage
examples, organized for fast lookup by AI agents.

- **Start here:** [docs/features/index.md](./docs/features/index.md) — routing table
  by package and by feature slice, MCP tool quick reference, agent quick-start guide
- **Per-package overviews:** each package has a `README.md` under
  `docs/features/<package>/`
- **Per-class detailed docs:** one `.md` per exported class/tool/command inside each
  package directory
- **Cross-cutting pipelines:** top-level `*-pipeline.md` / `*-integration.md` files

Regenerate with `/document-features` when source code changes significantly.
