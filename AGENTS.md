# Repository Guidelines

## Project Structure & Module Organization
This is a mixed TypeScript and Dart/Flutter workspace. TypeScript packages live under `packages/*/src` with tests in matching `packages/*/tests` directories. Core automation APIs are in `packages/fliwright-core`; the MCP server is in `packages/fliwright-mcp`; Vitest integration is in `packages/fliwright-vitest`; Riverpod support is in `packages/fliwright-plugin-riverpod`. The Dart bridge lives in `packages/fliwright-bridge/lib` with tests in `packages/fliwright-bridge/test`. End-to-end smoke tests are in `e2e`, the Flutter demo app is in `examples/riverpod_demo`, and design notes are in `docs`.

## Build, Test, and Development Commands
Run `pnpm install` after changing JavaScript dependencies. Use `pnpm build` to compile TypeScript packages, `pnpm test` to run Vitest suites, and `pnpm lint` to type-check with `tsc --noEmit`. For one package, use filters, for example `pnpm --filter @fliwright/core test`.

For Dart packages, run `melos bootstrap` to fetch dependencies, `melos run analyze` for `dart analyze .`, and `melos run test` for `dart test`. E2E smoke tests require a running Flutter VM service: `FLIWRIGHT_VM_SERVICE_URL=... pnpm --filter @fliwright/e2e-tests test:smoke`.

## Coding Style & Naming Conventions
TypeScript uses ESM, strict mode, Node16 module resolution, and ES2022 targets. Keep source files in `src`, export public APIs from `src/index.ts`, and include `.js` extensions in relative imports. Use PascalCase for classes and types, camelCase for functions and variables, and `*.test.ts` for Vitest tests.

Dart code follows standard `dart format` conventions with two-space indentation. Use snake_case filenames, PascalCase classes, and camelCase members.

## Testing Guidelines
Vitest is the TypeScript test framework. Place focused unit tests beside each package in `tests`, mirroring the source subject, for example `Locator.test.ts` or `runTest.test.ts`. Add regression tests when changing selectors, protocol behavior, MCP tools, or code generation. Dart bridge tests use `dart test`; Flutter demo tests live under `examples/riverpod_demo/test`.

## Commit & Pull Request Guidelines
Git history uses Conventional Commit style such as `feat(mcp): add fliwright_run tool`, `fix(core): call service extensions with isolate id`, and `chore: ignore flutter generated files`. Keep messages scoped and imperative.

Pull requests should describe the behavior change, list test commands run, link related issues or design docs, and include screenshots or logs for Flutter/UI or E2E changes. Note any required VM service URL or device setup.

## Security & Configuration Tips
Do not commit generated build output such as `dist`, Flutter generated files, local VM service URLs, or device-specific configuration. Keep test fixtures deterministic and avoid embedding secrets in docs, examples, or generated tests.

## Feature Documentation

AI-consumable feature documentation lives in `docs/features/`. These docs summarize every implemented feature with full API signatures, type definitions, and usage examples, organized for fast lookup by AI agents.

- **Start here:** [docs/features/index.md](./docs/features/index.md) — routing table by package and by feature slice, MCP tool quick reference, agent quick-start guide
- **Per-package overviews:** [core/README.md](./docs/features/core/README.md) · [mcp/README.md](./docs/features/mcp/README.md) · [vitest/README.md](./docs/features/vitest/README.md) · [cli/README.md](./docs/features/cli/README.md) · [plugin-riverpod/README.md](./docs/features/plugin-riverpod/README.md) · [ai-plugin/README.md](./docs/features/ai-plugin/README.md) · [vscode/README.md](./docs/features/vscode/README.md) · [bridge/README.md](./docs/features/bridge/README.md)
- **Per-class detailed docs:** Each package sub-directory contains one `.md` per exported class/utility — e.g., [core/FliwrightDriver.md](./docs/features/core/FliwrightDriver.md), [core/Page.md](./docs/features/core/Page.md)
- **Cross-cutting pipelines:** [self-healing-pipeline.md](./docs/features/self-healing-pipeline.md) · [recording-pipeline.md](./docs/features/recording-pipeline.md) · [form-filling-pipeline.md](./docs/features/form-filling-pipeline.md) · [mcp-integration.md](./docs/features/mcp-integration.md)

Regenerate with `/document-features` when source code changes significantly.
