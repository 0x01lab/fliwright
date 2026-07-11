# Fliwright Agent Contract

Fliwright is a TypeScript-scripted Flutter automation runtime. A Dart VM-Service
bridge (`fliwright_bridge`) runs inside the app, `@fliwright/core` drives it,
and Vitest, MCP, CLI, VS Code, and Riverpod packages integrate with that core.
Tests are scripts plus assertions; scripts can also perform arbitrary app tasks.

This file is level 0 of the repository Harness. Read it for every task. Open
only the one linked level-1 document that matches the work; do not preload
`harness/`, `docs/`, or their indexes. The complete navigation model lives in
[harness/README.md](./harness/README.md).

## Always Apply

- TypeScript is ESM, strict, Node16 resolution, and ES2022. Put source in `src`,
  export public APIs from `src/index.ts`, use `.js` in relative imports, and use
  PascalCase types/classes, camelCase values/functions, and `*.test.ts` tests.
- Dart uses standard `dart format`: two spaces, snake_case filenames, PascalCase
  classes, and camelCase members.
- Keep changes in their owning package. Do not commit `dist`, Flutter-generated
  files, local VM-service URLs, device configuration, or secrets.
- Keep fixtures deterministic. Add a regression test for selector, protocol, MCP
  tool, or code-generation changes.
- Do not add compatibility paths for behavior that the current design replaces,
  unless backward compatibility is explicitly requested.
- `docs/features/` is generated implementation reference. Do not edit it by hand;
  regenerate it with `/document-features` after significant stable source changes.

## Verify

- TypeScript: `pnpm install` after dependency changes; use `pnpm build`,
  `pnpm test`, and `pnpm lint`. Scope a package with
  `pnpm --filter @fliwright/core test`.
- Dart: use `melos bootstrap`, `melos run analyze`, and `melos run test`.
- E2E smoke requires a Flutter VM service:
  `FLIWRIGHT_VM_SERVICE_URL=... pnpm --filter @fliwright/e2e-tests test:smoke`.
- The "exio app" is `/Users/leo.he/projects/exio/exio_app`.

## Open On Demand

| Need | Open exactly this first |
| --- | --- |
| Package ownership, change impact, or source/test locations | [harness/boundaries/repository.md](./harness/boundaries/repository.md) |
| Detailed quality gates or command selection | [harness/constraints/quality.md](./harness/constraints/quality.md) |
| VM service URL, runtime state, or environment setup | [harness/memory/runtime-configuration.md](./harness/memory/runtime-configuration.md) |
| Current API or implemented behavior | [harness/memory/feature-documentation.md](./harness/memory/feature-documentation.md) |
| Product requirements, a feature design, or an implementation plan | [harness/specs/README.md](./harness/specs/README.md) |
| Commit or pull request work | [harness/workflows/delivery.md](./harness/workflows/delivery.md) |
| Existing code/docs conflict with the intended behavior | [harness/memory/development-conflict-policy.md](./harness/memory/development-conflict-policy.md) |

Each linked document may route to a narrower leaf document. Follow that route
instead of reading sibling files or a whole directory.
