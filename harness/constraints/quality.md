# Quality Constraints

`AGENTS.md` contains the always-active summary. Open this document only when
choosing verification scope or interpreting a quality rule.

## Source And Tests

- Keep TypeScript source in the owning package's `src/` and focused Vitest tests
  in its `tests/` directory, using matching subject names where practical.
- Use `dart test` for bridge tests and Flutter tests under
  `examples/riverpod_demo/test` for demo behavior.
- A selector, wire/protocol, MCP tool, or code-generation behavior change needs
  a focused regression test. Broaden testing when shared contracts change.
- Run the narrowest meaningful check first, then run broader package/workspace
  checks when the blast radius warrants it.

## Commands

| Work | Command |
| --- | --- |
| One TypeScript package | `pnpm --filter @fliwright/<package> test` |
| TypeScript workspace | `pnpm test`, `pnpm build`, or `pnpm lint` |
| Dart workspace | `melos bootstrap`, `melos run analyze`, or `melos run test` |
| Flutter VM smoke test | `FLIWRIGHT_VM_SERVICE_URL=... pnpm --filter @fliwright/e2e-tests test:smoke` |

If `pub.dev` is unavailable, source `scripts/use-cn-pub-mirror.sh` in the
current shell before Dart or Flutter package-resolution commands. It is
session-scoped and does not alter resolved versions.

## Configuration Safety

Never commit generated output, VM service URLs, device-specific state, or
secrets. Local `.fliwright/config.json` is runtime state; open
[../memory/runtime-configuration.md](../memory/runtime-configuration.md) when
its precedence or shape matters.
