---
module: "initCommand"
package: "@fliwright/cli"
source: "src/commands/init.ts"
generated: "2026-06-02"
---

# `fliwright init`

> Scaffolds a Fliwright project by writing `fliwright.config.ts` (if absent) and a `tests/example.test.ts` smoke test.

## Overview

`initCommand(projectDir)` is idempotent: it checks for the existence of each target file via `stat()` and skips writing if the file already exists. The generated config uses the `@fliwright/cli` `defineConfig` helper with sensible defaults; the example test demonstrates the `test()` / `expect()` flow against a hypothetical counter app.

## Signature

```typescript
export async function initCommand(projectDir: string): Promise<void>;
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `projectDir` | `string` | Yes | Absolute path to the project root where files will be written. |

**Returns:** `Promise<void>` — resolves once all writes are complete.

## Generated Files

### `fliwright.config.ts`

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

### `tests/example.test.ts`

```typescript
import { test, expect } from '@fliwright/vitest';

test('counter increments', async ({ page }) => {
  // Replace with your app's actual widgets
  const counter = page.locator('text=Count: 0');
  await expect(counter).toBeVisible();

  const button = page.locator('text=Increment');
  await button.click();

  await expect(page.locator('text=Count: 1')).toBeVisible();
});
```

Both files are written using `writeFile(..., 'utf8')`. The `tests/` directory is created with `mkdir(..., { recursive: true })`.

## Output

Console output (one line per action):

```
Created fliwright.config.ts
Created tests/example.test.ts

Next steps:
  1. Start your Flutter app: flutter run
  2. Run tests: npx fliwright run
```

If a file already exists:

```
fliwright.config.ts already exists — skipping.
tests/example.test.ts already exists — skipping.
```

## Example

```bash
# Run in current project
npx fliwright init

# Or programmatically
```

```typescript
import { initCommand } from '@fliwright/cli';

await initCommand('/path/to/project');
```

## Related

- **Depends on:** `node:fs/promises`, `node:path`
- **Used by:** New projects bootstrapping Fliwright; also referenced in `doctor`'s hint message.
- **Source:** `packages/fliwright-cli/src/commands/init.ts`
