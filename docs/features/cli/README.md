---
package: "@fliwright/cli"
version: "0.1.0"
layer: integration
status: implemented
generated: "2026-06-02"
---

# @fliwright/cli

> Command-line interface for Fliwright — run tests, initialize projects, check environments, record interactions, and manage mocks.

## Modules

| Module | Description | Doc |
|--------|-------------|-----|
| `run` | Run Fliwright tests via Vitest | [run.md](./run.md) |
| `init` | Initialize Fliwright in a project | [init.md](./init.md) |
| `doctor` | Check environment prerequisites | [doctor.md](./doctor.md) |
| `record` | Record interactions and generate code | [record.md](./record.md) |
| `mock:start` | Start tool-side mock controller | [mock-start.md](./mock-start.md) |

## Dependencies

- `@fliwright/core` workspace:* — core SDK
- `commander` ^12.0.0 — CLI framework
- `chalk` ^5.3.0 — terminal colors
- `jiti` ^2.0.0 — TypeScript config loading

## Configuration

The CLI reads `fliwright.config.ts` from the project root using jiti (TypeScript support without pre-compilation).

```typescript
import { defineConfig } from '@fliwright/cli';

export default defineConfig({
  // vmServiceUrl: 'ws://127.0.0.1:8181/ws',
  timeout: 30000,
  screenshot: 'file',
  testDir: 'tests',
  reporter: 'pretty',
});
```

## Config Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `vmServiceUrl` | `string` | — | VM Service WebSocket URL |
| `timeout` | `number` | 30000 | Per-test timeout (ms) |
| `screenshot` | `'file' \| 'base64' \| 'off'` | 'file' | Screenshot mode |
| `testDir` | `string` | 'tests' | Test directory |
| `reporter` | `'pretty' \| 'json' \| 'junit'` | 'pretty' | Output format |
