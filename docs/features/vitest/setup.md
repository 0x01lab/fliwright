---
module: "setup"
package: "@fliwright/vitest"
source: "src/setup.ts"
generated: "2026-06-02"
---

# `setup`

> Lower-level `globalSetup` / `globalTeardown` / `getDriver` helpers for cases where you want to manage the `FliwrightDriver` yourself rather than rely on the `test()` fixture's lazy connection.

## Overview

`src/setup.ts` exposes a tiny module-scoped driver singleton. It's intended for advanced Vitest configurations (e.g. `vitest.config.ts` `globalSetup`) where you need the driver to exist before any test runs and dispose cleanly after all tests finish. Most users should prefer the auto-driver in `createFliwrightTest` instead.

## Signature

```typescript
export interface SetupOptions {
  vmServiceUrl: string;
}

export async function globalSetup(options: SetupOptions): Promise<void>;

export function getDriver(): FliwrightDriver | null;

export async function globalTeardown(): Promise<void>;
```

## Public Methods

### `globalSetup(options): Promise<void>`

Constructs a `FliwrightDriver`, connects it to `options.vmServiceUrl`, and stores it in the module-scoped singleton.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `options.vmServiceUrl` | `string` | Yes | WebSocket URL of the Flutter VM Service. |

**Returns:** `Promise<void>` — resolves once `driver.connect()` completes.

**Example:**

```typescript
// vitest.config.ts globalSetup
import { globalSetup } from '@fliwright/vitest/setup';

export default async () => {
  await globalSetup({ vmServiceUrl: process.env.FLIWRIGHT_VM_URL! });
};
```

---

### `getDriver(): FliwrightDriver | null`

Returns the current module-scoped driver, or `null` if `globalSetup` hasn't run yet (or `globalTeardown` has already disposed it).

**Returns:** `FliwrightDriver | null`

**Example:**

```typescript
import { getDriver } from '@fliwright/vitest/setup';

const driver = getDriver();
if (!driver) throw new Error('globalSetup has not been called');
const page = driver.page;
```

---

### `globalTeardown(): Promise<void>`

Disposes the singleton driver via `driver.dispose()` and clears the reference. Safe to call multiple times — the second call is a no-op.

**Returns:** `Promise<void>`

**Example:**

```typescript
import { globalTeardown } from '@fliwright/vitest/setup';

export default async () => {
  await globalTeardown();
};
```

## Related

- **Depends on:** [`@fliwright/core` FliwrightDriver](../core/FliwrightDriver.md)
- **Used by:** Custom Vitest `globalSetup` files (advanced); most projects use [test.md](./test.md) instead.
- **Source:** `packages/fliwright-vitest/src/setup.ts`
