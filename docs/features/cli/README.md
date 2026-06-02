---
package: "@fliwright/cli"
version: "0.1.0"
layer: transport
status: implemented
generated: "2026-06-02"
---

# @fliwright/cli

> Command-line entry point (`fliwright`) that runs Fliwright tests via Vitest, initializes projects, records user interactions, and diagnoses environment issues.

## Modules

| Module | Description | Doc |
|--------|-------------|-----|
| `run` command | Runs Vitest with the right VM Service URL and failure-context env vars. | [run.md](./run.md) |
| `init` command | Scaffolds `fliwright.config.ts` and an example test file. | [init.md](./init.md) |
| `doctor` command | Checks Node, Flutter, packages, config, and VM Service availability. | [doctor.md](./doctor.md) |
| `record` command | Records user interactions and emits TypeScript or Dart test code with assertion suggestions. | [record.md](./record.md) |
| `config` | Loads `fliwright.config.ts` via `jiti` and merges with defaults. | [config.md](./config.md) |
| `vm-discovery` | Resolves a VM Service URL from CLI flag, env var, config, or port scan. | [vm-discovery.md](./vm-discovery.md) |
| `reporter` | Pretty / JSON / JUnit output formatters for `CliRunResult`. | [reporter.md](./reporter.md) |

## Dependencies

- `@fliwright/core` — `workspace:*`
- `commander` — `^12.0.0` (CLI parser)
- `chalk` — `^5.3.0` (colored output)
- `jiti` — `^2.0.0` (TypeScript config loader)
- Peer: `vitest` `^2.0.0`, optional peer: `@fliwright/vitest` `workspace:*`

## Usage Example

```bash
# Scaffold a new project
npx fliwright init

# Start your Flutter app in another terminal
flutter run

# Run tests (auto-discovers VM Service on ports 8181/9189/54321)
npx fliwright run

# JSON output for CI
npx fliwright run --reporter json --timeout 60000

# Record a session and emit Dart code
npx fliwright record --lang dart --output tests/recorded.dart

# Diagnose setup issues
npx fliwright doctor
```
