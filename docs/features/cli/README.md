---
package: "@fliwright/cli"
version: "0.1.0"
layer: transport
status: implemented
generated: "2026-06-01"
---

# @fliwright/cli

> Command-line interface for running Fliwright tests, initializing projects, diagnosing environments, and recording interactions.

## Commands

| Command | Description | Doc |
|---------|-------------|-----|
| `run` | Run Fliwright tests | [run.md](./run.md) |
| `init` | Initialize Fliwright in a project | [init.md](./init.md) |
| `doctor` | Check environment setup | [doctor.md](./doctor.md) |
| `record` | Record interactions and generate test code | [record.md](./record.md) |

## Config System

Configuration is loaded from `fliwright.config.ts` using `jiti`. Supports both default and named exports.

### FliwrightCliConfig

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `vmServiceUrl` | `string?` | — | Default VM Service URL |
| `timeout` | `number` | `30000` | Per-test timeout in ms |
| `screenshot` | `'file' \| 'base64' \| 'off'` | `'file'` | Screenshot mode |
| `testDir` | `string` | `'tests'` | Test directory |
| `reporter` | `'pretty' \| 'json' \| 'junit'` | `'pretty'` | Output reporter |

### VM URL Discovery Priority

1. CLI `--vm-url` flag
2. Config file `vmServiceUrl`
3. `FLIWRIGHT_VM_URL` environment variable
4. Port scan (future)

## Dependencies

- `@fliwright/core` — workspace:*
- `commander` — ^12.0.0
- `chalk` — ^5.3.0
- `jiti` — ^2.0.0

## Usage

```bash
# Initialize project
fliwright init

# Check environment
fliwright doctor

# Run tests
fliwright run --test tests/login.test.ts --vm-url ws://localhost:12345/ws

# Record interactions
fliwright record --vm-url ws://localhost:12345/ws --output test.ts --lang ts
```
