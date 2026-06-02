---
module: "config"
package: "@fliwright/cli"
source: "src/config.ts"
generated: "2026-06-02"
---

# `config`

> Loads `fliwright.config.ts` from the project root via `jiti`, merges with defaults, and exposes a `defineConfig` helper for type-safe authoring.

## Overview

`@fliwright/cli` ships its own `FliwrightCliConfig` shape (separate from `@fliwright/vitest`'s `FliwrightConfig`) — it adds `testDir` and `reporter` and uses a longer default `timeout` (30s, matching the CLI's per-test timeout rather than the vitest integration's 5s collection timeout). Config loading is opt-in: if `fliwright.config.ts` is absent, `loadConfig` returns the defaults unchanged.

## Signature

```typescript
export interface FliwrightCliConfig {
  vmServiceUrl?: string;
  timeout: number;
  screenshot: 'file' | 'base64' | 'off';
  testDir: string;
  reporter: 'pretty' | 'json' | 'junit';
}

export function defineConfig(overrides?: Partial<FliwrightCliConfig>): FliwrightCliConfig;

export async function loadConfig(projectDir: string): Promise<FliwrightCliConfig>;
```

## Defaults

```typescript
const DEFAULTS: FliwrightCliConfig = {
  timeout: 30000,
  screenshot: 'file',
  testDir: 'tests',
  reporter: 'pretty',
  // vmServiceUrl deliberately defaulted via VM discovery, not here
};
```

## Public Methods

### `defineConfig(overrides?): FliwrightCliConfig`

Merges `overrides` over `DEFAULTS`. Intended for use in `fliwright.config.ts`:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `overrides` | `Partial<FliwrightCliConfig>` | No | Override any subset of fields. |

**Returns:** `FliwrightCliConfig`

**Example:**

```typescript
// fliwright.config.ts
import { defineConfig } from '@fliwright/cli';

export default defineConfig({
  vmServiceUrl: 'ws://127.0.0.1:8181/ws',
  timeout: 60000,
  reporter: 'junit',
});
```

---

### `loadConfig(projectDir): Promise<FliwrightCliConfig>`

Resolves `<projectDir>/fliwright.config.ts`. If the file doesn't exist (stat throws), returns `{ ...DEFAULTS }`. Otherwise loads it via `createJiti(import.meta.url)` and `jiti.import(configPath)`, accepts either the default export or the namespace export, and merges over `DEFAULTS`.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `projectDir` | `string` | Yes | Absolute path to the project root. |

**Returns:** `Promise<FliwrightCliConfig>`

**Throws:** Propagates any jiti/syntax error from a malformed config file (a missing file does not throw).

## Related

- **Depends on:** `jiti` (`^2.0.0`), `node:fs/promises`, `node:path`
- **Used by:** [run command](./run.md) (loads config before resolving VM URL and reporter)
- **Source:** `packages/fliwright-cli/src/config.ts`
