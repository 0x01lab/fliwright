# Vitest 2.1.9 Focused Rerun Recipe — 2026-06-22

Verdict: PASS.

The installed Vitest 2.1.9 type/runtime surface exposes:

- `Vitest.changeNamePattern(pattern, files?, trigger?)`
- `Vitest.changeFilenamePattern(pattern, files?)`
- `Vitest.rerunFiles(files?, trigger?, allTestsRun?)`

Important quirk: `changeNamePattern` and `changeFilenamePattern` call `rerunFiles` internally in
Vitest 2.1.9, so the focused recipe must not blindly call `rerunFiles` again afterward.

Winning recipe for a named test:

```ts
await vitest.changeNamePattern(testName, [absoluteFile], 'fliwright tdd focused rerun');
```

Result collection uses a custom reporter's `onFinished(files)` hook and walks the returned Vitest
task tree for `task.type === 'test'` plus `task.result.state`.

The runnable probe is `packages/fliwright-tdd/spike/probe-vitest-rerun.mjs`.
