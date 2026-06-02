---
module: "runner"
package: "@fliwright/vscode"
source: "src/runner/"
generated: "2026-06-02"
---

# Runner

> Discover test files, run them via Vitest, surface results in the Runs view, and add CodeLens `Run Current Test` indicators.

## Modules

| File | Role |
|------|------|
| `src/runner/TestDiscoveryService.ts` | Scan workspace for `*.test.ts` files |
| `src/runner/VitestRunner.ts` | Spawn Vitest with the right env vars (VM URL + failure-context path) |
| `src/runner/FliwrightCodeLensProvider.ts` | Add `Run Current Test` CodeLens above `test()` blocks |

## Commands

| Command | Action |
|---------|--------|
| `fliwright.runCurrentTest` | Run the test under the cursor |
| `fliwright.runWorkspaceTests` | Run every discovered test file |

## CodeLens

Registered for `typescript` and `typescriptreact` files. Each `test(...)` block gets a `Run Current Test` CodeLens that invokes `fliwright.runCurrentTest`.

## Related

- **Source:** `packages/fliwright-vscode/src/runner/`
