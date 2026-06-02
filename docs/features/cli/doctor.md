---
module: "doctorCommand"
package: "@fliwright/cli"
source: "src/commands/doctor.ts"
generated: "2026-06-02"
---

# `fliwright doctor`

> Runs six environment checks (Node, Flutter, packages, config, VM Service) and prints a pass/warn summary so you can diagnose setup issues fast.

## Overview

`doctorCommand(projectDir)` runs a fixed list of checks, each producing a `CheckResult { name, passed, message }`. Results are printed with green check / yellow warning icons via `chalk` and the array is returned for programmatic use (handy in tests).

## Signature

```typescript
export interface CheckResult {
  name: string;
  passed: boolean;
  message: string;
}

export async function doctorCommand(projectDir: string): Promise<CheckResult[]>;
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `projectDir` | `string` | Yes | Absolute path to the project root (used for the config-file check). |

**Returns:** `Promise<CheckResult[]>` — ordered list of check results; `passed: false` does not abort the run.

## Checks

| # | Check | Method | Pass Condition |
|---|-------|--------|----------------|
| 1 | `Node.js` | `process.version` | Major version `>= 18`. |
| 2 | `Flutter SDK` | `execFile('flutter', ['--version'])` (5s timeout) | `flutter` resolves on PATH; first stdout line is printed. |
| 3 | `@fliwright/core` | `import.meta.resolve('@fliwright/core/package.json')` + JSON import | Package is importable from the current project; reports installed version. |
| 4 | `@fliwright/vitest` | Same as above | Same as above. |
| 5 | `fliwright.config.ts` | `stat(<projectDir>/fliwright.config.ts)` | File exists. |
| 6 | `VM Service` | [`discoverVmServiceUrl()`](./vm-discovery.md) | A `200` from `http://127.0.0.1:<port>/json/version` on one of the scan ports. |

Each check is wrapped in try/catch so failures produce a friendly `CheckResult` rather than throwing.

## Output

```
✅ Node.js: v20.11.0
✅ Flutter SDK: Flutter 3.22.1 • channel stable
✅ @fliwright/core: 0.1.0 installed
✅ @fliwright/vitest: 0.1.0 installed
✅ fliwright.config.ts: found
⚠️  VM Service: no Flutter app detected (run `flutter run` to start one)
```

## Example

```bash
npx fliwright doctor
```

Programmatic:

```typescript
import { doctorCommand } from '@fliwright/cli';

const results = await doctorCommand(process.cwd());
const allPassed = results.every((r) => r.passed);
if (!allPassed) process.exit(1);
```

## Related

- **Depends on:** `node:child_process`, `node:fs/promises`, `chalk`, [vm-discovery](./vm-discovery.md)
- **Used by:** Users debugging installation; CI health checks
- **Source:** `packages/fliwright-cli/src/commands/doctor.ts`
