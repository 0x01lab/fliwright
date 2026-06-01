---
module: "test"
package: "@fliwright/vitest"
source: "src/index.ts"
generated: "2026-06-01"
---

# test

> Vitest test extension with auto-managed FliwrightDriver lifecycle.

## Overview

The `test` export is a pre-configured Vitest test function that reads `FLIWRIGHT_VM_URL` from the environment. It provides a `page` fixture that auto-connects the driver before each test and disconnects after.

## createFliwrightTest(config)

Creates a custom test function with explicit configuration.

```typescript
function createFliwrightTest(config: FliwrightConfig): Vitest.TestAPI<{ page: Page }>
```

### FliwrightConfig

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `vmServiceUrl` | `string` | Yes | — | VM Service WebSocket URL |
| `timeout` | `number` | No | `5000` | Per-assertion timeout |
| `screenshot` | `'file' \| 'base64' \| 'off'` | No | `'file'` | Screenshot capture mode |

## defineConfig(overrides)

```typescript
function defineConfig(overrides: Partial<FliwrightConfig> & { vmServiceUrl: string }): FliwrightConfig
```

Merges user overrides with defaults.

## Behavior

- **Before first test:** Creates a shared `FliwrightDriver`, connects to VM Service
- **Each test:** Provides `page` fixture via `AsyncLocalStorage`
- **On failure:** Writes MCP failure context for `fliwright_get_failure` tool
- **After all tests:** Disposes the driver
