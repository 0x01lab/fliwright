# Build And Test Commands

Run `pnpm install` after changing JavaScript dependencies. Use `pnpm build` to
compile TypeScript packages, `pnpm test` to run Vitest suites, and `pnpm lint`
to type-check with `tsc --noEmit`. For one package, use filters, for example
`pnpm --filter @fliwright/core test`.

For Dart packages, run `melos bootstrap` to fetch dependencies, `melos run
analyze` for `dart analyze .`, and `melos run test` for `dart test`. E2E smoke
tests require a running Flutter VM service:
`FLIWRIGHT_VM_SERVICE_URL=... pnpm --filter @fliwright/e2e-tests test:smoke`.
